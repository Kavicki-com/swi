import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { TelemetryConditionService } from '../src/telemetry/alerts/condition.service'
import { SparseAssessmentService } from '../src/telemetry/assessment/sparse-assessment.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'

// E2E da pulseira lida pelo Health Connect. O que se promete aqui só existe com
// Postgres: o dia inteiro do funcionário, de qualquer sessão, relido a cada
// sincronização, o lock por funcionário e dia, e o recálculo pulado só quando
// o lote não trouxe batimento novo.
describe('Telemetry Health Connect e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let sparse: SparseAssessmentService

  const emails = {
    a: `telemetry-hc-a-${randomUUID()}@ex.com`,
    b: `telemetry-hc-b-${randomUUID()}@ex.com`,
    c: `telemetry-hc-c-${randomUUID()}@ex.com`,
    d: `telemetry-hc-d-${randomUUID()}@ex.com`,
    e: `telemetry-hc-e-${randomUUID()}@ex.com`,
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

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    sparse = app.get(SparseAssessmentService)

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

    // A sincronização chega em vários lotes de segundos de distância: cada lote
    // com leitura nova recalcula, e só o que não traz nada novo é pulado.
    it('recalcula a cada leitura nova do dia, por perto que venha, e pula quando nada mudou', async () => {
      const session = randomUUID()
      await seedSamples(workerB, deviceB, [
        { session, at: t(0), bpm: 120 },
        { session, at: t(5), bpm: 125 },
      ])
      const now = new Date()
      const after = (ms: number) => new Date(now.getTime() + ms)
      const window = async (assessmentId: string) => {
        const row = await prisma.telemetryAssessment.findUniqueOrThrow({ where: { id: assessmentId } })
        return {
          sampleCount: (row.inputs as { window: { sampleCount: number } }).window.sampleCount,
          windowEnd: row.windowEnd.toISOString(),
        }
      }

      expect((await sparse.assessDay(workerB, 'REAL', day, now)).outcome).toBe('assessed')

      // Segundo lote, 30 s depois, com leitura mais nova.
      await seedSamples(workerB, deviceB, [{ session, at: t(10), bpm: 130 }])
      const second = await sparse.assessDay(workerB, 'REAL', day, after(30_000))
      expect(second.outcome).toBe('assessed')
      if (second.outcome !== 'assessed') return
      expect(await window(second.assessmentId)).toEqual({ sampleCount: 3, windowEnd: t(10).toISOString() })

      // Leitura atrasada no meio do dia: a última não muda, a contagem muda.
      await seedSamples(workerB, deviceB, [{ session, at: t(2), bpm: 122 }])
      const third = await sparse.assessDay(workerB, 'REAL', day, after(40_000))
      expect(third.outcome).toBe('assessed')
      if (third.outcome !== 'assessed') return
      expect(await window(third.assessmentId)).toEqual({ sampleCount: 4, windowEnd: t(10).toISOString() })

      // Nada novo: pulado, perto ou longe do último recálculo.
      expect((await sparse.assessDay(workerB, 'REAL', day, after(45_000))).outcome).toBe('nothing_new')
      expect((await sparse.assessDay(workerB, 'REAL', day, after(10 * 60_000))).outcome).toBe('nothing_new')
      expect(await prisma.telemetryAssessment.count({ where: { workerId: workerB } })).toBe(3)
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

    // Cada evento da pulseira traz uma medição só, com horários espalhados: a
    // oxigenação de antes do último batimento ainda é a oxigenação mais nova.
    it('cada medição entra pelo próprio horário: oxigenação mais velha que o batimento do lote também vale', async () => {
      const session = randomUUID()
      const newest = ago(2 * HOUR - 10 * 60_000)
      const oxygenAt = ago(3 * HOUR)
      const events = [
        event(newest, beat(150), session),
        event(oxygenAt, { oxygenSaturation: { value: 96, unit: '%', source: 'HEALTH_CONNECT' } }, session),
      ]

      const { body } = await post({ events })

      expect(body.acceptedEventIds).toHaveLength(2)
      const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerC } })
      expect(snapshot.heartRateBpm).toBe(150)
      expect(snapshot.heartRateAt?.toISOString()).toBe(newest)
      expect(snapshot.oxygenSaturationPct).toBe(96)
      expect(snapshot.oxygenSaturationAt?.toISOString()).toBe(oxygenAt)
      // Último evento e sessão só andam para a frente.
      expect(snapshot.lastEventTime.toISOString()).toBe(newest)
      measuredUntil = newest
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

    // A rota do próprio funcionário passa pela mesma projeção da do painel; o
    // escopo de empresa do painel é assunto dos unitários da consulta.
    it('a leitura atual diz até quando a pulseira mediu e quando sincronizou', async () => {
      const token = new JwtService({ secret: requireJwtSecret() }).sign({ sub: workerC, role: 'WORKER' })

      const { body } = await request(app.getHttpServer())
        .get('/telemetry/v1/me/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(body.sync.measuredUntil).toBe(measuredUntil)
      expect(Math.abs(Date.parse(body.sync.syncedAt) - Date.now())).toBeLessThan(60_000)
      expect(body.metrics.heartRate).toMatchObject({ value: 150, quality: 'UNAVAILABLE', measuredAt: measuredUntil })
      // Datada pela última leitura do dia avaliado, nunca pela hora do recálculo.
      const latest = await prisma.telemetryAssessment.findFirstOrThrow({
        where: { workerId: workerC },
        orderBy: { computedAt: 'desc' },
      })
      expect(body.metrics.wear.measuredAt).toBe(latest.windowEnd.toISOString())
      expect(body.metrics.wear.measuredAt).not.toBe(latest.computedAt.toISOString())
      expect(body.metrics.fatigueEtaMin.value).toBeNull()
    })

    it('batimento do Apple Watch pelo celular Android é recusado como medição inválida', async () => {
      const watch = event(ago(HOUR), { heartRate: { value: 80, unit: 'bpm', source: 'APPLE_WATCH' } })

      const { body } = await post({ events: [watch] })

      expect(body.acceptedEventIds).toEqual([])
      expect(body.conflicts).toEqual([
        { eventId: watch.eventId, reason: 'invalid_measurement', detail: expect.any(String) },
      ])
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

  describe('varredura de silêncio', () => {
    // Snapshot montado direto no banco: o que importa aqui é só o tipo do
    // aparelho, com o mesmo silêncio dos dois lados.
    const silentFor = async (email: string, kind: 'ANDROID_PHONE' | 'IPHONE') => {
      const workerId = await worker(email)
      const device = await prisma.telemetryDevice.create({
        data: { workerId, kind, credentialHash: hashCredential(randomUUID()) },
      })
      const lastEventTime = new Date(Date.now() - 3 * 60 * 60_000)
      const session = await prisma.telemetrySession.create({
        data: { id: randomUUID(), deviceId: device.id, workerId, origin: 'REAL', startedAt: lastEventTime },
      })
      await prisma.telemetrySnapshot.create({
        data: { workerId, sessionId: session.id, origin: 'REAL', lastEventTime, deviceKind: kind },
      })
      return workerId
    }
    const signalLost = (workerId: string) =>
      prisma.telemetryCondition.count({ where: { workerId, kind: 'DEVICE_SIGNAL_LOST' } })

    it('não abre perda de sinal para a pulseira; o iPhone no mesmo silêncio abre', async () => {
      const band = await silentFor(emails.d, 'ANDROID_PHONE')
      const iphone = await silentFor(emails.e, 'IPHONE')

      await app.get(TelemetryConditionService).sweepSilentSessions(new Date())

      expect(await signalLost(band)).toBe(0)
      expect(await signalLost(iphone)).toBe(1)
    })
  })
})
