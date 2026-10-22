import { randomUUID } from 'node:crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { SPARSE_FORMULA_VERSION } from '../src/telemetry/assessment/sparse-profile'
import { monitoredDayWindow } from '../src/telemetry/domain/metric-state'
import { TelemetryLifecycleService } from '../src/telemetry/lifecycle/telemetry-lifecycle.service'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'

// E2E e não unitário de propósito: o que esta camada precisa provar mora no
// Postgres. A varredura agrupa por dia monitorado dentro do banco, a gravação
// é upsert por índice único e a tabela nasce de uma migration. Um Prisma
// mockado provaria apenas que o código chama o método que o autor imaginou, e
// é por isso que a migration é verificada aqui, e não por spec própria.
describe('Telemetry lifecycle e2e', () => {
  let prisma: PrismaService
  let lifecycle: TelemetryLifecycleService

  const email = `telemetry-lifecycle-${randomUUID()}@ex.com`
  let workerId = ''
  let deviceId = ''
  const sessionId = `lifecycle-${randomUUID()}`

  // "Agora" fixo: o dia `2026-09-01` em Brasília termina às `2026-09-02T03:00Z` e
  // fecha 48 h depois, em `2026-09-04T03:00Z`. Rodar às 12:00Z do dia 4 deixa o
  // dia 1 fechado, sem depender da hora em que a suíte roda.
  const now = new Date('2026-09-04T12:00:00.000Z')
  /** O dia como o banco o guarda: data pura, sem hora nem fuso. */
  const day = new Date('2026-09-01T00:00:00.000Z')
  const at = (clock: string) => new Date(`2026-09-01T${clock}.000Z`)

  let sequence = 0
  const sampleRow = (
    eventTime: Date,
    measures: {
      heartRateBpm?: number
      stepDelta?: number
      activeEnergyKcal?: number
      batteryPercent?: number
      systolicMmHg?: number
      diastolicMmHg?: number
      bloodPressureSource?: 'EXTERNAL_CUFF'
    },
  ) => ({
    eventId: randomUUID(),
    sessionId,
    deviceId,
    workerId,
    origin: 'REAL' as const,
    sequence: ++sequence,
    eventTime,
    receivedAt: eventTime,
    heartRateBpm: measures.heartRateBpm ?? null,
    stepDelta: measures.stepDelta ?? null,
    activeEnergyKcal: measures.activeEnergyKcal ?? null,
    batteryPercent: measures.batteryPercent ?? null,
    systolicMmHg: measures.systolicMmHg ?? null,
    diastolicMmHg: measures.diastolicMmHg ?? null,
    bloodPressureSource: measures.bloodPressureSource ?? null,
    payload: {},
    payloadHash: `hash-${randomUUID()}`,
  })

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.$connect()
    lifecycle = new TelemetryLifecycleService(prisma)

    const worker = await prisma.user.create({
      data: {
        email,
        name: 'Telemetry Lifecycle',
        passwordHash: 'nao-usado-neste-spec',
        role: 'WORKER',
        emailVerified: true,
        approvalStatus: 'APPROVED',
      },
    })
    workerId = worker.id

    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'APPLE_WATCH', credentialHash: 'hash-de-credencial-de-teste' },
    })
    deviceId = device.id

    await prisma.telemetrySession.create({
      data: { id: sessionId, deviceId, workerId, origin: 'REAL', startedAt: at('12:00:00') },
    })

    // Série do dia fechado: BPM de 30 em 30 segundos, mais uma leitura de
    // passos no fim. Todos os intervalos ficam abaixo do limite de lacuna,
    // então a cobertura é conhecida de antemão.
    await prisma.telemetrySample.createMany({
      data: [
        sampleRow(at('12:00:00'), { heartRateBpm: 60, activeEnergyKcal: 1.5, batteryPercent: 80 }),
        sampleRow(at('12:00:30'), { heartRateBpm: 90, activeEnergyKcal: 2.25, batteryPercent: 61 }),
        sampleRow(at('12:01:00'), { heartRateBpm: 72 }),
        sampleRow(at('12:01:30'), { stepDelta: 40 }),
        sampleRow(at('13:00:00'), {
          systolicMmHg: 128,
          diastolicMmHg: 82,
          bloodPressureSource: 'EXTERNAL_CUFF',
        }),
      ],
    })

    // Avaliações do mesmo dia: duas seguidas acima de 80 por cento de esforço,
    // de 30 em 30 segundos, e uma abaixo depois.
    await prisma.telemetryAssessment.createMany({
      data: [
        {
          workerId,
          sessionId,
          origin: 'REAL',
          computedAt: at('12:00:00'),
          windowStart: at('11:59:45'),
          windowEnd: at('12:00:00'),
          effortPercent: 85,
          wearPercent: 30,
          formulaVersion: 'swi-fatigue-experimental',
          inputs: {},
        },
        {
          workerId,
          sessionId,
          origin: 'REAL',
          computedAt: at('12:00:30'),
          windowStart: at('12:00:15'),
          windowEnd: at('12:00:30'),
          effortPercent: 95,
          wearPercent: 40,
          formulaVersion: 'swi-fatigue-experimental',
          inputs: {},
        },
        {
          workerId,
          sessionId,
          origin: 'REAL',
          computedAt: at('12:01:00'),
          windowStart: at('12:00:45'),
          windowEnd: at('12:01:00'),
          effortPercent: 30,
          // Sem desgaste de propósito: esforço e desgaste não compartilham
          // denominador, e a linha precisa provar isso contra o banco.
          wearPercent: null,
          formulaVersion: 'swi-fatigue-experimental',
          inputs: {},
        },
      ],
    })
  })

  afterAll(async () => {
    // Cascade a partir do User leva dispositivo, sessão, amostras e Resumo. É a
    // mesma cascata que a história de apagar a conta do funcionário exige.
    await prisma.user.deleteMany({ where: { email } })
    await prisma.$disconnect()
  })

  const storedSummary = () =>
    prisma.telemetryDailySummary.findUniqueOrThrow({
      where: { workerId_day_origin: { workerId, day, origin: 'REAL' } },
    })

  it('resume o dia fechado com os valores da série', async () => {
    const result = await lifecycle.summarizeClosedDays(now)

    expect(result.failed).toBe(0)
    expect(result.summarized).toBeGreaterThanOrEqual(1)

    const summary = await storedSummary()

    expect(summary.heartRateMin).toBe(60)
    expect(summary.heartRateMax).toBe(90)
    expect(summary.heartRateAvg).toBe(74)
    expect(summary.heartRateCount).toBe(3)
    // Dois intervalos de 30 s entre as três leituras de BPM.
    expect(summary.heartRateCoveredMs).toBe(60_000)
    expect(summary.stepsTotal).toBe(40)
    expect(summary.stepsCount).toBe(1)
    expect(summary.sampleCount).toBe(5)
    expect(summary.sessionCount).toBe(1)
    expect(summary.firstSampleAt).toEqual(at('12:00:00'))
    expect(summary.lastSampleAt).toEqual(at('13:00:00'))
    // Três intervalos de 30 s entre as quatro primeiras leituras. A aferição de
    // pressão vem uma hora depois: lacuna, não cobertura.
    expect(summary.coveredMs).toBe(90_000)
    expect(summary.summarizerVersion).toBe(SUMMARIZER_VERSION)
  })

  it('resume energia, bateria, esforço, desgaste e pressão do mesmo dia', async () => {
    const summary = await storedSummary()

    expect(summary.activeEnergyKcalTotal).toBe(3.75)
    expect(summary.activeEnergyCount).toBe(2)
    expect(summary.batteryMin).toBe(61)

    expect(summary.effortMax).toBe(95)
    expect(summary.effortCount).toBe(3)
    // Só as duas avaliações acima de 80, separadas por 30 s.
    expect(summary.effortAbove80Ms).toBe(30_000)
    expect(summary.wearMax).toBe(40)
    // Uma das três avaliações não trouxe desgaste: o denominador é dele, não
    // do esforço, e o banco guarda os dois separados.
    expect(summary.wearCount).toBe(2)
    // Nenhum desgaste chegou a 80: tempo alto é zero apurado, não nulo.
    expect(summary.wearAbove80Ms).toBe(0)

    expect(summary.bloodPressureCount).toBe(1)
    expect(summary.lastSystolicMmHg).toBe(128)
    expect(summary.lastDiastolicMmHg).toBe(82)
    expect(summary.lastBloodPressureSource).toBe('EXTERNAL_CUFF')
    expect(summary.lastBloodPressureAt).toEqual(at('13:00:00'))
  })

  it('Resumo de outra versão do resumidor é recalculado e sobrescrito pela mesma chave', async () => {
    // Subir a conta precisa alcançar o histórico. Sem a versão no filtro da
    // varredura, o dia já resumido nunca voltaria, e o painel mostraria linhas
    // vizinhas produzidas por regras diferentes.
    // A v2 é a que está gravada em produção quando a v3 sobe: sem percentis.
    await prisma.telemetryDailySummary.update({
      where: { workerId_day_origin: { workerId, day, origin: 'REAL' } },
      data: { summarizerVersion: 'swi-daily-summary-2', heartRateMax: 999, sampleCount: 0, heartRateP25: null },
    })

    const result = await lifecycle.summarizeClosedDays(now)

    expect(result.summarized).toBeGreaterThanOrEqual(1)
    const linhas = await prisma.telemetryDailySummary.findMany({ where: { workerId } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].summarizerVersion).toBe(SUMMARIZER_VERSION)
    expect(linhas[0].heartRateMax).toBe(90)
    expect(linhas[0].sampleCount).toBe(5)
    // O dia refeito ganha o que a calibração lê: é assim que os 30 dias de
    // bruto guardado viram dias válidos no deploy, sem script de backfill.
    expect(linhas[0].heartRateP25).toBe(60)
  })

  it('o dia guardado é data pura, sem hora nem fuso', async () => {
    // Se o dia carregasse hora, a chave dependeria de conversão e duas linhas
    // do mesmo dia poderiam coexistir sem o índice único perceber.
    const summary = await storedSummary()

    expect(summary.day.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('o movimento por minuto ao vivo não é do Resumo; só a mediana do dia, para a calibração', async () => {
    // MPM é derivada de janela e vive na projeção do painel. O Resumo guarda
    // outra coisa, com outro nome: a mediana entre os minutos com leitura da
    // soma de movimento do minuto, que é o "habitual" que a calibração compara.
    // Sem coluna `movementPerMinute`, ninguém confunde as duas.
    const summary = await storedSummary()

    expect(summary).not.toHaveProperty('movementPerMinute')
    expect(summary).not.toHaveProperty('movementPerMinuteAvg')
    // Esta série não tem contagem de movimento: mediana desconhecida, não zero.
    expect(summary.movementPerMinuteMedian).toBeNull()
  })

  it('rodar de novo não duplica a linha nem muda os valores', async () => {
    const antes = await storedSummary()

    // O dia já tem Resumo, então ele não volta como candidata: a rodada não
    // encontra nada a fazer para este funcionário.
    const result = await lifecycle.summarizeClosedDays(now)

    const depois = await prisma.telemetryDailySummary.findMany({ where: { workerId } })
    expect(depois).toHaveLength(1)
    expect(depois[0]).toEqual(antes)
    expect(result.failed).toBe(0)
  })

  it('não resume dia que ainda não fechou', async () => {
    // Mesma série, mas rodando um milissegundo antes de o dia `2026-09-01`
    // fechar. Um dia aberto ainda pode receber evento atrasado, e resumi-lo
    // agora gravaria um número que a chegada seguinte tornaria mentira.
    await prisma.telemetryDailySummary.deleteMany({ where: { workerId } })

    await lifecycle.summarizeClosedDays(new Date('2026-09-04T02:59:59.999Z'))

    expect(await prisma.telemetryDailySummary.count({ where: { workerId } })).toBe(0)
  })

  it('dia aberto ganha Resumo provisório, que o fechamento sobrescreve como definitivo pela mesma chave', async () => {
    await prisma.telemetryDailySummary.deleteMany({ where: { workerId } })

    // Um milissegundo antes de `2026-09-01` fechar o dia ainda está aberto: a
    // rodada parcial o resume como provisório, para a linha de base existir.
    const aberto = await lifecycle.summarizeOpenDays(new Date('2026-09-04T02:59:59.999Z'))
    expect(aberto).toEqual({ summarized: 1, failed: 0 })
    const provisorio = await prisma.telemetryDailySummary.findMany({ where: { workerId } })
    expect(provisorio).toHaveLength(1)
    expect(provisorio[0].provisional).toBe(true)

    // Fechado o dia, a rodada fechada recandidata a tripla apesar da linha
    // existente e grava por cima: mesma chave, mesma linha, agora definitiva.
    const fechado = await lifecycle.summarizeClosedDays(now)
    expect(fechado).toEqual({ summarized: 1, failed: 0 })
    const definitivo = await prisma.telemetryDailySummary.findMany({ where: { workerId } })
    expect(definitivo).toHaveLength(1)
    expect(definitivo[0].id).toBe(provisorio[0].id)
    expect(definitivo[0].provisional).toBe(false)
  })

  describe('retenção', () => {
    // Um dia bem além da janela de 30 dias e outro dentro dela, os dois já
    // fechados. Só o antigo pode perder a Leitura bruta.
    const antigo = new Date('2026-06-01T00:00:00.000Z')
    const antigoAt = (clock: string) => new Date(`2026-06-01T${clock}.000Z`)

    beforeAll(async () => {
      await prisma.telemetrySample.createMany({
        data: [
          { ...sampleRow(antigoAt('12:00:00'), { heartRateBpm: 66 }) },
          { ...sampleRow(antigoAt('12:00:30'), { heartRateBpm: 70 }) },
        ],
      })
      await prisma.telemetryCondition.create({
        data: {
          workerId,
          sessionId,
          origin: 'REAL',
          kind: 'HEART_RATE_HIGH',
          firstSeenAt: antigoAt('12:00:00'),
          lastSeenAt: antigoAt('12:00:30'),
          thresholdProfile: 'swi-limites-experimental',
          observedValue: 70,
        },
      })
      await prisma.telemetrySnapshot.create({
        data: { workerId, sessionId, origin: 'REAL', lastEventTime: at('13:00:00') },
      })
    })

    it('apaga a Leitura do dia antigo e mantém a do dia dentro da janela', async () => {
      // Primeiro resume os dois dias, senão o antigo não tem Resumo e a
      // retenção não pode tocá-lo.
      await lifecycle.summarizeClosedDays(now)

      const result = await lifecycle.purgeRetainedData(now)

      expect(result.samplesDeleted).toBe(2)
      expect(result.daysPurged).toBe(1)
      expect(
        await prisma.telemetrySample.count({
          where: { workerId, eventTime: { gte: antigoAt('00:00:00'), lt: at('00:00:00') } },
        }),
      ).toBe(0)
      // O dia recente continua inteiro: cinco leituras e três avaliações.
      expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(5)
      expect(await prisma.telemetryAssessment.count({ where: { workerId } })).toBe(3)
    })

    it('o Resumo do dia antigo sobrevive ao apagar, que é o motivo de tudo', async () => {
      const summary = await prisma.telemetryDailySummary.findUniqueOrThrow({
        where: { workerId_day_origin: { workerId, day: antigo, origin: 'REAL' } },
      })

      expect(summary.heartRateMin).toBe(66)
      expect(summary.heartRateMax).toBe(70)
      expect(summary.sampleCount).toBe(2)
    })

    it('não toca sessão, snapshot nem condição', async () => {
      // A retenção apaga trilha bruta. Condição é a memória clínica, e sessão e
      // snapshot são a prova de que houve monitoramento.
      expect(await prisma.telemetrySession.count({ where: { workerId } })).toBe(1)
      expect(await prisma.telemetrySnapshot.count({ where: { workerId } })).toBe(1)
      expect(await prisma.telemetryCondition.count({ where: { workerId } })).toBe(1)
    })

    it('segunda execução apaga zero e deixa o Resumo idêntico', async () => {
      const antes = await prisma.telemetryDailySummary.findMany({
        where: { workerId },
        orderBy: { day: 'asc' },
      })

      const result = await lifecycle.purgeRetainedData(now)

      expect(result.samplesDeleted).toBe(0)
      expect(result.assessmentsDeleted).toBe(0)
      expect(
        await prisma.telemetryDailySummary.findMany({ where: { workerId }, orderBy: { day: 'asc' } }),
      ).toEqual(antes)
    })

    it('dia sem Resumo nunca perde a Leitura', async () => {
      // Apaga o Resumo do dia antigo e roda de novo: sem linha, o gate fecha.
      // É o invariante que impede a retenção de destruir o que ninguém apurou.
      await prisma.telemetryDailySummary.deleteMany({ where: { workerId, day: antigo } })
      await prisma.telemetrySample.create({
        data: sampleRow(antigoAt('12:01:00'), { heartRateBpm: 68 }),
      })

      const result = await lifecycle.purgeRetainedData(now)

      expect(result.samplesDeleted).toBe(0)
      expect(
        await prisma.telemetrySample.count({ where: { workerId, eventTime: antigoAt('12:01:00') } }),
      ).toBe(1)
    })
  })

  describe('Resumo v3 para a calibração', () => {
    // Funcionários próprios: os casos acima contam as linhas do funcionário
    // principal, e um dia a mais ali mudaria todas as contas.
    const watchEmail = `telemetry-lifecycle-watch-${randomUUID()}@ex.com`
    const bandEmail = `telemetry-lifecycle-band-${randomUUID()}@ex.com`

    interface Seeded {
      workerId: string
      deviceId: string
      sessionId: string
    }
    let watch: Seeded
    let band: Seeded

    const seedWorker = async (mail: string, kind: 'APPLE_WATCH' | 'ANDROID_PHONE'): Promise<Seeded> => {
      const user = await prisma.user.create({
        data: {
          email: mail,
          name: 'Telemetry Lifecycle Calibração',
          passwordHash: 'nao-usado-neste-spec',
          role: 'WORKER',
          emailVerified: true,
          approvalStatus: 'APPROVED',
        },
      })
      const device = await prisma.telemetryDevice.create({
        data: { workerId: user.id, kind, credentialHash: 'hash-de-credencial-de-teste' },
      })
      const session = await prisma.telemetrySession.create({
        data: {
          id: `lifecycle-cal-${randomUUID()}`,
          deviceId: device.id,
          workerId: user.id,
          origin: 'REAL',
          startedAt: at('12:00:00'),
        },
      })
      return { workerId: user.id, deviceId: device.id, sessionId: session.id }
    }

    let calSequence = 0
    const calRow = (
      who: Seeded,
      eventTime: Date,
      measures: {
        heartRateBpm?: number
        motionCount?: number
        oxygenSaturationPct?: number
        bodyTemperatureC?: number
        systolicMmHg?: number
        diastolicMmHg?: number
      },
    ) => ({
      eventId: randomUUID(),
      sessionId: who.sessionId,
      deviceId: who.deviceId,
      workerId: who.workerId,
      origin: 'REAL' as const,
      sequence: ++calSequence,
      eventTime,
      receivedAt: eventTime,
      ...measures,
      payload: {},
      payloadHash: `hash-${randomUUID()}`,
    })

    beforeAll(async () => {
      watch = await seedWorker(watchEmail, 'APPLE_WATCH')
      band = await seedWorker(bandEmail, 'ANDROID_PHONE')

      await prisma.telemetrySample.createMany({
        data: [
          calRow(watch, at('12:00:00'), { heartRateBpm: 60, motionCount: 10 }),
          calRow(watch, at('12:00:30'), { heartRateBpm: 70, motionCount: 20 }),
          calRow(watch, at('12:01:10'), { heartRateBpm: 80, motionCount: 5, oxygenSaturationPct: 97 }),
          calRow(watch, at('12:30:00'), { oxygenSaturationPct: 95, bodyTemperatureC: 34 }),
          calRow(watch, at('13:00:00'), {
            oxygenSaturationPct: 98,
            bodyTemperatureC: 34.5,
            systolicMmHg: 120,
            diastolicMmHg: 80,
          }),
          calRow(watch, at('14:00:00'), { bodyTemperatureC: 35, systolicMmHg: 130, diastolicMmHg: 90 }),
          calRow(band, at('12:00:00'), { heartRateBpm: 70 }),
          calRow(band, at('12:05:00'), { heartRateBpm: 75 }),
        ],
      })

      // A esparsa refaz o dia a cada sincronização e é carimbada na hora do
      // recálculo, aqui dois dias depois. O Resumo acha a do dia pelo começo da
      // janela e lê a mais recente; a anterior, de pico menor, não pode vencer.
      const { start } = monitoredDayWindow(day)
      const sparse = (windowEnd: Date, computedAt: Date, wearMax: number) => ({
        workerId: band.workerId,
        sessionId: band.sessionId,
        origin: 'REAL' as const,
        computedAt,
        windowStart: start,
        windowEnd,
        effortPercent: 20,
        wearPercent: 30,
        formulaVersion: SPARSE_FORMULA_VERSION,
        inputs: { dayStats: { wearMax, effortP25: 10, effortP90: 60 } },
      })
      await prisma.telemetryAssessment.createMany({
        data: [
          sparse(at('12:00:00'), new Date('2026-09-03T09:00:00.000Z'), 25),
          sparse(at('12:05:00'), new Date('2026-09-03T10:00:00.000Z'), 40),
        ],
      })
    })

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: [watchEmail, bandEmail] } } })
    })

    const summaryOf = (who: Seeded) =>
      prisma.telemetryDailySummary.findUniqueOrThrow({
        where: { workerId_day_origin: { workerId: who.workerId, day, origin: 'REAL' } },
      })

    it('dia de relógio: percentis, oxigenação, temperatura, pressão média, movimento e família', async () => {
      const result = await lifecycle.summarizeClosedDays(now)
      expect(result.failed).toBe(0)

      const summary = await summaryOf(watch)

      expect(summary.summarizerVersion).toBe('swi-daily-summary-4')
      expect(summary.heartRateP25).toBe(60)
      expect(summary.heartRateP90).toBe(80)
      expect(summary.oxygenSaturationP10).toBe(95)
      expect(summary.oxygenSaturationP50).toBe(97)
      expect(summary.oxygenSaturationCount).toBe(3)
      expect(summary.bodyTemperatureP10).toBe(34)
      expect(summary.bodyTemperatureP25).toBe(34)
      expect(summary.bodyTemperatureP75).toBe(35)
      expect(summary.bodyTemperatureP90).toBe(35)
      expect(summary.bodyTemperatureCount).toBe(3)
      expect(summary.systolicAvg).toBe(125)
      expect(summary.diastolicAvg).toBe(85)
      // Minutos 12:00 (10 + 20) e 12:01 (5): mediana 17,5.
      expect(summary.movementPerMinuteMedian).toBe(17.5)
      expect(summary.deviceFamily).toBe('WATCH')
    })

    it('dia de pulseira: pico de desgaste e esforço da última avaliação esparsa do dia', async () => {
      const summary = await summaryOf(band)

      expect(summary.deviceFamily).toBe('BAND')
      expect(summary.wearMax).toBe(40)
      expect(summary.effortP25).toBe(10)
      expect(summary.effortP90).toBe(60)
      // A esparsa segue fora das contagens por avaliação: carimbada no dia do
      // recálculo, ela cairia no dia errado e se repetiria a cada lote.
      expect(summary.effortCount).toBeNull()
      expect(summary.wearCount).toBeNull()
    })
  })

  it('a sessão perdeu as colunas de acumulado, que agora vivem no Resumo', async () => {
    // ADR-0007: as duas colunas saíram por migration nesta entrega. Se elas
    // voltarem, o Resumo passa a ter um concorrente para a mesma verdade.
    const session = await prisma.telemetrySession.findUniqueOrThrow({ where: { id: sessionId } })

    expect(session).not.toHaveProperty('stepsTotal')
    expect(session).not.toHaveProperty('activeEnergyKcalTotal')
  })
})
