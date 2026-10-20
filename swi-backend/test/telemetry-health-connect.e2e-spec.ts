import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { SparseAssessmentService } from '../src/telemetry/assessment/sparse-assessment.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'

// E2E da pulseira lida pelo Health Connect. O que se promete aqui só existe com
// Postgres: o dia inteiro do funcionário, de qualquer sessão, relido a cada
// sincronização, o lock por funcionário e dia, e o corte de um minuto entre
// recálculos.
describe('Telemetry Health Connect e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let sparse: SparseAssessmentService

  const emails = {
    a: `telemetry-hc-a-${randomUUID()}@ex.com`,
    b: `telemetry-hc-b-${randomUUID()}@ex.com`,
    c: `telemetry-hc-c-${randomUUID()}@ex.com`,
  }
  let workerA = ''
  let workerB = ''
  let workerC = ''
  let deviceA = ''
  let deviceB = ''
  let headersC: Record<string, string> = {}

  // O dia de ontem, com as leituras em horário fixo dele: um "agora menos três
  // horas" cairia no dia anterior perto da meia-noite de Brasília, e o teste
  // passaria a depender do relógio de quem roda.
  const DAY_MS = 24 * 60 * 60 * 1000
  const day = monitoredDayOf(new Date(Date.now() - DAY_MS))
  const { start } = monitoredDayWindow(day)
  /** Minutos depois do meio-dia de ontem, em Brasília. */
  const t = (minutes: number) => new Date(start.getTime() + 12 * 60 * 60_000 + minutes * 60_000)

  const sequences = new Map<string, number>()
  const seedSamples = async (
    workerId: string,
    deviceId: string,
    rows: { session: string; at: Date; bpm: number }[],
  ) => {
    for (const row of rows) {
      if (!sequences.has(row.session)) {
        await prisma.telemetrySession.create({
          data: { id: row.session, deviceId, workerId, origin: 'REAL', startedAt: row.at },
        })
        sequences.set(row.session, 0)
      }
      const sequence = (sequences.get(row.session) ?? 0) + 1
      sequences.set(row.session, sequence)
      await prisma.telemetrySample.create({
        data: {
          eventId: randomUUID(),
          sessionId: row.session,
          deviceId,
          workerId,
          origin: 'REAL',
          sequence,
          eventTime: row.at,
          receivedAt: new Date(),
          heartRateBpm: row.bpm,
          payload: {},
          payloadHash: randomUUID(),
        },
      })
    }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    sparse = app.get(SparseAssessmentService)

    const worker = async (email: string) =>
      (
        await prisma.user.create({
          data: {
            email,
            name: email,
            passwordHash: 'nao-usado-neste-spec',
            role: 'WORKER',
            emailVerified: true,
            approvalStatus: 'APPROVED',
            profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } },
          },
        })
      ).id
    const android = async (workerId: string) =>
      (
        await prisma.telemetryDevice.create({
          data: { workerId, kind: 'ANDROID_PHONE', credentialHash: hashCredential(randomUUID()) },
        })
      ).id

    workerA = await worker(emails.a)
    workerB = await worker(emails.b)
    workerC = await worker(emails.c)
    deviceA = await android(workerA)
    deviceB = await android(workerB)

    // O funcionário C fala pela rota: aparelho com credencial de verdade.
    const secret = randomUUID().replace(/-/g, '')
    const deviceC = await prisma.telemetryDevice.create({
      data: { workerId: workerC, kind: 'ANDROID_PHONE', credentialHash: hashCredential(secret) },
    })
    headersC = { Authorization: `Device ${encodeCredential(deviceC.id, secret)}` }

    // Repouso medido: um dia fechado com mínimo de 60.
    const threeDaysAgo = monitoredDayOf(new Date(Date.now() - 3 * DAY_MS))
    for (const workerId of [workerA, workerB, workerC]) {
      await prisma.telemetryDailySummary.create({
        data: {
          workerId,
          day: threeDaysAgo,
          origin: 'REAL',
          heartRateMin: 60,
          sampleCount: 10,
          summarizerVersion: SUMMARIZER_VERSION,
          computedAt: new Date(),
        },
      })
    }
  })

  afterAll(async () => {
    // Profile não tem cascade: sem apagá-lo antes, o funcionário não sai.
    const workers = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    await prisma.profile.deleteMany({ where: { userId: { in: workers.map((w) => w.id) } } })
    // Notificação também não tem cascade, e a revisão de pressão gera uma.
    await prisma.notification.deleteMany({ where: { workerId: { in: workers.map((w) => w.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await app.close()
  })

  describe('SparseAssessmentService', () => {
    it('dia sem leitura não grava nada', async () => {
      const empty = monitoredDayOf(new Date(Date.now() - 5 * DAY_MS))
      expect((await sparse.assessDay(workerA, 'REAL', empty, new Date())).outcome).toBe('nothing_new')
    })

    it('recalcula o dia inteiro, de qualquer sessão, e grava na versão esparsa com o horário da última leitura', async () => {
      // Duas sessões: duas sincronizações do mesmo dia.
      const s1 = randomUUID()
      const s2 = randomUUID()
      await seedSamples(workerA, deviceA, [
        { session: s1, at: t(0), bpm: 150 },
        { session: s1, at: t(5), bpm: 150 },
        { session: s2, at: t(10), bpm: 150 },
        { session: s2, at: t(60), bpm: 140 },
      ])

      const out = await sparse.assessDay(workerA, 'REAL', day, new Date())

      expect(out.outcome).toBe('assessed')
      const row = await prisma.telemetryAssessment.findFirstOrThrow({
        where: { workerId: workerA },
        orderBy: { computedAt: 'desc' },
      })
      expect(row.formulaVersion).toBe('swi-fatigue-sparse-1')
      expect(row.windowStart.toISOString()).toBe(start.toISOString())
      expect(row.windowEnd.toISOString()).toBe(t(60).toISOString())
      expect(row.fatigueEtaMin).toBeNull()
      expect(row.wearPercent).toBeGreaterThan(0)
      expect(row.effortPercent).not.toBeNull()
      expect(row.baselineSource).toBe('MEASURED')
      expect(row.sessionId).toBe(s2)
      expect((row.inputs as { window: { sampleCount: number; gapsOverMax: number } }).window).toMatchObject({
        sampleCount: 4,
        gapsOverMax: 1,
      })
    })

    it('segura o segundo recálculo do mesmo dia dentro de um minuto', async () => {
      await seedSamples(workerB, deviceB, [
        { session: randomUUID(), at: t(0), bpm: 120 },
        { session: randomUUID(), at: t(5), bpm: 125 },
      ])
      const now = new Date()

      expect((await sparse.assessDay(workerB, 'REAL', day, now)).outcome).toBe('assessed')
      expect((await sparse.assessDay(workerB, 'REAL', day, new Date(now.getTime() + 30_000))).outcome).toBe(
        'throttled',
      )
      expect((await sparse.assessDay(workerB, 'REAL', day, new Date(now.getTime() + 61_000))).outcome).toBe(
        'assessed',
      )
      expect(await prisma.telemetryAssessment.count({ where: { workerId: workerB } })).toBe(2)
    })
  })

  // Pela rota, com a credencial do celular Android: a ordem dos casos importa,
  // cada um parte do atual que o anterior deixou.
  describe('lote pela rota', () => {
    const HOUR = 60 * 60_000
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    let sequence = 0
    const event = (eventTime: string, measurements: object, session = randomUUID()) => ({
      eventId: randomUUID(),
      monitoringSessionId: session,
      sequence: ++sequence,
      eventTime,
      origin: 'REAL',
      measurements,
    })
    const beat = (bpm: number) => ({ heartRate: { value: bpm, unit: 'bpm', source: 'HEALTH_CONNECT' } })
    const post = (body: object) =>
      request(app.getHttpServer()).post('/telemetry/v1/batches').set(headersC).send(body).expect(200)

    let measuredUntil = ''

    it('promove o batimento mais recente do lote, avalia o dia e não abre condição de batimento', async () => {
      const session = randomUUID()
      measuredUntil = ago(2 * HOUR)
      const events = [
        event(ago(3 * HOUR), beat(190), session),
        event(ago(2 * HOUR + 10 * 60_000), beat(190), session),
        event(measuredUntil, beat(190), session),
      ]

      const { body } = await post({ events })

      expect(body.acceptedEventIds).toHaveLength(3)
      const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerC } })
      expect(snapshot.heartRateBpm).toBe(190)
      expect(snapshot.lastEventTime.toISOString()).toBe(measuredUntil)
      expect(snapshot.deviceKind).toBe('ANDROID_PHONE')
      expect(Math.abs((snapshot.lastReceivedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000)
      expect(
        await prisma.telemetryAssessment.count({
          where: { workerId: workerC, formulaVersion: 'swi-fatigue-sparse-1' },
        }),
      ).toBeGreaterThanOrEqual(1)
      // 190 bpm ao vivo abriria condição; da pulseira, horas depois, não.
      expect(
        await prisma.telemetryCondition.count({
          where: { workerId: workerC, kind: { in: ['HEART_RATE_HIGH', 'HEART_RATE_LOW'] } },
        }),
      ).toBe(0)
    })

    it('lote com leitura mais velha que o atual é aceito e não mexe no atual', async () => {
      const older = event(ago(4 * HOUR), beat(70))

      const { body } = await post({ events: [older] })

      expect(body.acceptedEventIds).toEqual([older.eventId])
      const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerC } })
      expect(snapshot.heartRateBpm).toBe(190)
      expect(snapshot.lastEventTime.toISOString()).toBe(measuredUntil)
    })

    it('pressão alta de horas atrás abre a revisão de pressão', async () => {
      const pressure = event(ago(5 * HOUR), {
        bloodPressure: { value: { systolic: 165, diastolic: 100 }, unit: 'mmHg', source: 'HEALTH_CONNECT' },
      })

      const { body } = await post({ events: [pressure] })

      expect(body.acceptedEventIds).toEqual([pressure.eventId])
      expect(
        await prisma.telemetryCondition.count({ where: { workerId: workerC, kind: 'BLOOD_PRESSURE_REVIEW' } }),
      ).toBe(1)
    })

    it('bateria vinda do Health Connect é recusada como medição inválida', async () => {
      const battery = event(ago(HOUR), { battery: { value: 80, unit: '%', source: 'HEALTH_CONNECT' } })

      const { body } = await post({ events: [battery] })

      expect(body.acceptedEventIds).toEqual([])
      expect(body.conflicts).toEqual([
        { eventId: battery.eventId, reason: 'invalid_measurement', detail: expect.any(String) },
      ])
    })
  })
})
