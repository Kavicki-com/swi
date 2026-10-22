import { randomUUID } from 'node:crypto'
import type { CalibrationDeviceFamily, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../src/prisma/prisma.service'
import { CALIBRATION_VERSION } from '../src/telemetry/calibration/calibration-bands'
import { CalibrationService } from '../src/telemetry/calibration/calibration.service'
import { TelemetryQueryService } from '../src/telemetry/read-model/telemetry-query.service'

// E2E porque o recálculo é leitura de Resumos e gravação em quatro tabelas
// numa transação: o que importa provar é a migration, os upserts por chave
// composta e que a correção do gestor nunca é tocada pelo job.
describe('Telemetry calibration e2e', () => {
  let prisma: PrismaService
  let calibration: CalibrationService

  const tag = randomUUID()
  const realEmail = `calibration-real-${tag}@ex.com`
  const demoEmail = `calibration-demo-${tag}@ex.com`
  const noneEmail = `calibration-none-${tag}@ex.com`
  const emails = [realEmail, demoEmail, noneEmail]
  let realId = ''
  let demoId = ''
  /** Origem real, mas sem nenhum dia terminado: nunca ganha linha de calibração. */
  let noneId = ''

  const HOUR = 60 * 60 * 1000
  /** Dia como o banco guarda: data pura em meia-noite UTC. */
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
  /** Meio-dia UTC de um dia: em Brasília ainda é o mesmo dia. */
  const noonOf = (iso: string) => new Date(`${iso}T12:00:00.000Z`)
  const october = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

  const summaryRow = (
    workerId: string,
    iso: string,
    over: { origin?: TelemetryOrigin; deviceFamily?: CalibrationDeviceFamily; heartRateP90?: number; provisional?: boolean } = {},
  ) => ({
    workerId,
    day: dayOf(iso),
    origin: over.origin ?? 'REAL',
    heartRateMin: 60,
    heartRateMax: 150,
    heartRateCoveredMs: 3 * HOUR,
    heartRateP25: 75,
    heartRateP90: over.heartRateP90 ?? 128,
    effortP25: 20,
    effortP90: 60,
    wearMax: 50,
    stepsTotal: 9000,
    distanceTotalM: 6000,
    activeEnergyKcalTotal: 400,
    movementPerMinuteMedian: 40,
    deviceFamily: over.deviceFamily ?? 'WATCH',
    sampleCount: 100,
    summarizerVersion: 'swi-daily-summary-4',
    computedAt: noonOf(iso),
    provisional: over.provisional ?? false,
  })

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.$connect()
    calibration = new CalibrationService(prisma)

    const worker = (email: string) =>
      prisma.user.create({
        data: {
          email,
          name: 'Telemetry Calibration',
          passwordHash: 'nao-usado-neste-spec',
          role: 'WORKER',
          emailVerified: true,
          approvalStatus: 'APPROVED',
          // 35 anos em outubro de 2026: máxima por idade 183,5.
          profile: { create: { birthDate: dayOf('1991-01-01') } },
        },
      })
    realId = (await worker(realEmail)).id
    demoId = (await worker(demoEmail)).id
    noneId = (await worker(noneEmail)).id

    // Dez dias terminados de relógio, 11 a 20 de outubro, e o dia 21 ainda em
    // andamento (provisório e com um p90 absurdo, que não pode contar).
    await prisma.telemetryDailySummary.createMany({
      data: [
        ...Array.from({ length: 10 }, (_, i) => summaryRow(realId, october(11 + i))),
        summaryRow(realId, october(21), { heartRateP90: 999, provisional: true }),
        ...Array.from({ length: 10 }, (_, i) => summaryRow(demoId, october(11 + i), { origin: 'DEMO' })),
      ],
    })
  })

  afterAll(async () => {
    // Profile não tem cascade; o resto (Resumos e calibração) cai com o User.
    const workers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    await prisma.profile.deleteMany({ where: { userId: { in: workers.map((w) => w.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
    await prisma.$disconnect()
  })

  const bandOf = (workerId: string, metric: 'HEART_RATE' | 'WEAR') =>
    prisma.workerCalibrationBand.findUniqueOrThrow({ where: { workerId_metric: { workerId, metric } } })

  it('cria a calibração com os dez dias terminados de relógio, sem o dia em andamento', async () => {
    expect(await calibration.recalculateWorker(realId, noonOf(october(21)))).toBe(true)

    const stored = await prisma.workerCalibration.findUniqueOrThrow({ where: { workerId: realId } })
    expect(stored).toMatchObject({
      version: CALIBRATION_VERSION,
      deviceFamily: 'WATCH',
      phaseStartedAt: dayOf(october(11)),
      recalibrating: false,
      validDays: 10,
      restingBpm: 60,
      peakPersonalBpm: 150,
      peakStartBpm: 183.5,
    })
    expect(await prisma.workerCalibrationBand.count({ where: { workerId: realId } })).toBe(11)

    const heartRate = await bandOf(realId, 'HEART_RATE')
    expect(heartRate.validDays).toBe(10)
    expect(heartRate.startCuts).toEqual({ excellence: 0.6 * 183.5, fatigue: 0.9 * 183.5 })
    const learned = heartRate.learnedCuts as { excellence: number; fatigue: number }
    expect(learned.excellence).toBeCloseTo((10 / 30) * 75 + (20 / 30) * 0.6 * 183.5)
    expect(learned.fatigue).toBeCloseTo((10 / 30) * 128 + (20 / 30) * 0.9 * 183.5)
    expect(heartRate.overrideCuts).toBeNull()
  })

  it('a segunda rodada atualiza o aprendido e não toca a correção do gestor', async () => {
    const override = { excellence: 70, fatigue: 140 }
    await prisma.workerCalibrationBand.update({
      where: { workerId_metric: { workerId: realId, metric: 'HEART_RATE' } },
      data: { overrideCuts: override, overrideById: realId, overrideAt: noonOf(october(21)) },
    })
    const before = (await bandOf(realId, 'HEART_RATE')).learnedCuts

    // O dia 21 termina: vira definitivo e conta, com um p90 mais alto.
    await prisma.telemetryDailySummary.update({
      where: { workerId_day_origin: { workerId: realId, day: dayOf(october(21)), origin: 'REAL' } },
      data: { heartRateP90: 140, provisional: false },
    })
    expect(await calibration.recalculateWorker(realId, noonOf(october(22)))).toBe(true)

    const heartRate = await bandOf(realId, 'HEART_RATE')
    expect(heartRate.validDays).toBe(11)
    expect(heartRate.learnedCuts).not.toEqual(before)
    expect(heartRate.overrideCuts).toEqual(override)
  })

  it('dias novos de pulseira abrem uma fase de recalibração e ficam no histórico', async () => {
    await prisma.telemetryDailySummary.createMany({
      data: [summaryRow(realId, october(22), { deviceFamily: 'BAND' }), summaryRow(realId, october(23), { deviceFamily: 'BAND' })],
    })
    expect(await calibration.recalculateWorker(realId, noonOf(october(24)))).toBe(true)

    const stored = await prisma.workerCalibration.findUniqueOrThrow({ where: { workerId: realId } })
    expect(stored).toMatchObject({ deviceFamily: 'BAND', phaseStartedAt: dayOf(october(22)), recalibrating: true, validDays: 2 })

    const changes = await prisma.workerCalibrationChange.findMany({ where: { workerId: realId } })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      action: 'RECALIBRATE_DEVICE',
      actorId: null,
      from: { deviceFamily: 'WATCH' },
      to: { deviceFamily: 'BAND' },
    })
    // A correção do gestor atravessa a troca de aparelho.
    expect((await bandOf(realId, 'HEART_RATE')).overrideCuts).toEqual({ excellence: 70, fatigue: 140 })
  })

  it('funcionário só com dado DEMO não ganha calibração, nem pela rodada geral', async () => {
    expect(await calibration.recalculateWorker(demoId, noonOf(october(21)))).toBe(false)

    const run = await calibration.recalculateAll(noonOf(october(24)))
    expect(run.failed).toBe(0)
    expect(run.recalculated).toBeGreaterThanOrEqual(1)
    expect(await prisma.workerCalibration.findUnique({ where: { workerId: demoId } })).toBeNull()
    expect(await prisma.workerCalibrationBand.count({ where: { workerId: demoId } })).toBe(0)
  })

  // A leitura individual lê o que o recálculo gravou acima: a fase de pulseira
  // com dois dias válidos, a correção do gestor no batimento e o aprendido no
  // resto. Depois dos casos anteriores de propósito, para não mexer no que
  // eles esperam do banco.
  describe('leitura individual (current)', () => {
    let query: TelemetryQueryService

    const snapshotOf = (workerId: string, origin: TelemetryOrigin, now: Date) =>
      prisma.telemetrySnapshot.create({
        data: { workerId, origin, lastEventTime: now, heartRateBpm: 150, heartRateAt: now },
      })

    beforeAll(() => {
      query = new TelemetryQueryService(prisma)
    })

    it('na origem real traz a fase, o dia e cada faixa com a zona do valor atual', async () => {
      const now = new Date()
      await snapshotOf(realId, 'REAL', now)

      const current = await query.currentForWorker(realId, now)

      expect(current.calibration).toMatchObject({
        version: CALIBRATION_VERSION,
        phase: 'CALIBRATING',
        recalibrating: true,
        day: 3,
      })
      const metrics = current.calibration!.metrics
      expect(Object.keys(metrics)).toHaveLength(11)
      // 150 bpm contra a correção do gestor (fadiga a partir de 140).
      expect(metrics.HEART_RATE).toEqual({ zone: 'FATIGUE', cuts: { excellence: 70, fatigue: 140 }, source: 'OVERRIDE' })
      // Sem avaliação não há desgaste atual: faixa aprendida, zona nula.
      expect(metrics.WEAR).toMatchObject({ zone: null, source: 'LEARNED' })
      expect(metrics.WEAR!.cuts.fatigue).not.toBeNull()
      // Total do dia nunca ganha zona; a faixa habitual vem mesmo assim.
      expect(metrics.STEPS).toMatchObject({ zone: null, source: 'LEARNED' })
    })

    it('na demonstração mostra a partida, mesmo com dias de demonstração resumidos', async () => {
      const now = new Date()
      await snapshotOf(demoId, 'DEMO', now)

      const current = await query.currentForWorker(demoId, now)

      expect(current.origin).toBe('DEMO')
      expect(current.calibration).toMatchObject({ version: CALIBRATION_VERSION, phase: 'CALIBRATING', day: 1 })
      expect(current.calibration!.metrics.OXYGEN_SATURATION).toMatchObject({ source: 'START' })
    })

    it('na origem real sem linha de calibração traz a partida no dia 1, pela idade', async () => {
      const now = new Date()
      await snapshotOf(noneId, 'REAL', now)

      const current = await query.currentForWorker(noneId, now)

      expect(current.origin).toBe('REAL')
      expect(current.calibration).toMatchObject({ phase: 'CALIBRATING', recalibrating: false, day: 1 })
      const metrics = current.calibration!.metrics
      expect(metrics.OXYGEN_SATURATION).toEqual({ zone: null, cuts: { excellence: 95, fatigue: 92 }, source: 'START' })
      // 150 bpm entre 60% e 90% da máxima por idade (183,5).
      expect(metrics.HEART_RATE).toMatchObject({ zone: 'NORMAL', source: 'START' })
      expect(metrics.HEART_RATE!.cuts.fatigue).toBeCloseTo(0.9 * 183.5)
      // Atividade não tem partida.
      expect(metrics.STEPS).toBeUndefined()
    })

    it('quem nunca reportou responde a partida com zona nula', async () => {
      const current = await query.currentForWorker(randomUUID())
      expect(current.origin).toBeNull()
      expect(current.calibration).toMatchObject({ day: 1 })
      expect(Object.values(current.calibration!.metrics).every((m) => m.source === 'START' && m.zone === null)).toBe(true)
    })
  })
})
