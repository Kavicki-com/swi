import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { SparseAssessmentService } from '../src/telemetry/assessment/sparse-assessment.service'
import { hashCredential } from '../src/telemetry/devices/device-auth.service'
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
  }
  let workerA = ''
  let workerB = ''
  let deviceA = ''
  let deviceB = ''

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
    deviceA = await android(workerA)
    deviceB = await android(workerB)

    // Repouso medido: um dia fechado com mínimo de 60.
    const threeDaysAgo = monitoredDayOf(new Date(Date.now() - 3 * DAY_MS))
    for (const workerId of [workerA, workerB]) {
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
})
