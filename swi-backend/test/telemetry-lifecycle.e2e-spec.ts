import { randomUUID } from 'node:crypto'
import { PrismaService } from '../src/prisma/prisma.service'
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

  // "Agora" fixo: o dia 2026-09-01 em Brasília termina às 2026-09-02T03:00Z e
  // fecha 48 h depois, em 2026-09-04T03:00Z. Rodar às 12:00Z do dia 4 deixa o
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
    await prisma.telemetryDailySummary.update({
      where: { workerId_day_origin: { workerId, day, origin: 'REAL' } },
      data: { summarizerVersion: 'swi-daily-summary-0', heartRateMax: 999, sampleCount: 0 },
    })

    const result = await lifecycle.summarizeClosedDays(now)

    expect(result.summarized).toBeGreaterThanOrEqual(1)
    const linhas = await prisma.telemetryDailySummary.findMany({ where: { workerId } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0].summarizerVersion).toBe(SUMMARIZER_VERSION)
    expect(linhas[0].heartRateMax).toBe(90)
    expect(linhas[0].sampleCount).toBe(5)
  })

  it('o dia guardado é data pura, sem hora nem fuso', async () => {
    // Se o dia carregasse hora, a chave dependeria de conversão e duas linhas
    // do mesmo dia poderiam coexistir sem o índice único perceber.
    const summary = await storedSummary()

    expect(summary.day.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('movimento por minuto não é do Resumo, e a coluna não existe para inventá-lo', async () => {
    // MPM é derivada de janela e vive na projeção do painel, não no Resumo do
    // dia. A ausência aqui é de propósito: o Resumo guarda o que foi medido, e
    // uma coluna a mais convidaria alguém a recalcular a derivada de outro
    // jeito, com outro resultado.
    const summary = await storedSummary()

    expect(summary).not.toHaveProperty('movementPerMinute')
    expect(summary).not.toHaveProperty('movementPerMinuteAvg')
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
    // Mesma série, mas rodando um milissegundo antes de o dia 2026-09-01
    // fechar. Um dia aberto ainda pode receber evento atrasado, e resumi-lo
    // agora gravaria um número que a chegada seguinte tornaria mentira.
    await prisma.telemetryDailySummary.deleteMany({ where: { workerId } })

    await lifecycle.summarizeClosedDays(new Date('2026-09-04T02:59:59.999Z'))

    expect(await prisma.telemetryDailySummary.count({ where: { workerId } })).toBe(0)
  })

  it('a sessão perdeu as colunas de acumulado, que agora vivem no Resumo', async () => {
    // ADR-0007: as duas colunas saíram por migration nesta entrega. Se elas
    // voltarem, o Resumo passa a ter um concorrente para a mesma verdade.
    const session = await prisma.telemetrySession.findUniqueOrThrow({ where: { id: sessionId } })

    expect(session).not.toHaveProperty('stepsTotal')
    expect(session).not.toHaveProperty('activeEnergyKcalTotal')
  })
})
