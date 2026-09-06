import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { FORMULA_VERSION } from '../src/telemetry/assessment/assessment-profile'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'
import { TelemetryQueryService } from '../src/telemetry/read-model/telemetry-query.service'

// E2E de verdade porque o que a Task 7 promete só existe com HTTP e Postgres
// juntos: o lote entra pela rota, a avaliação nasce na mesma requisição, a
// cadeia é lida da linha anterior, e o read model devolve esforço e desgaste
// como métricas atuais.
describe('Telemetry assessment e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let query: TelemetryQueryService

  const emailWithBaseline = `telemetry-assess-a-${randomUUID()}@ex.com`
  const emailWithoutBaseline = `telemetry-assess-b-${randomUUID()}@ex.com`
  const emails = [emailWithBaseline, emailWithoutBaseline]
  let workerA = ''
  let workerB = ''
  let headersA: Record<string, string> = {}
  let headersB: Record<string, string> = {}

  const post = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(headers).send(body)

  let sequence = 0
  const event = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    monitoringSessionId: randomUUID(),
    sequence: ++sequence,
    eventTime: new Date(Date.now() - 5_000).toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: 118, unit: 'bpm', source: 'APPLE_WATCH' } },
    ...over,
  })

  const enroll = async (workerId: string) => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: hashCredential(secret) },
    })
    return { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    query = app.get(TelemetryQueryService)

    const worker = async (email: string, name: string, birthDate: Date | null) =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role: 'WORKER',
            emailVerified: true,
            approvalStatus: 'APPROVED',
            profile: { create: { birthDate } },
          },
        })
      ).id

    workerA = await worker(emailWithBaseline, 'Telemetry Assess A', new Date('1991-05-10T00:00:00.000Z'))
    workerB = await worker(emailWithoutBaseline, 'Telemetry Assess B', new Date('1991-05-10T00:00:00.000Z'))
    headersA = await enroll(workerA)
    headersB = await enroll(workerB)

    // Um dia fechado com batimento para o funcionário A: é o repouso observado.
    const threeDaysAgo = monitoredDayOf(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    await prisma.telemetryDailySummary.create({
      data: {
        workerId: workerA,
        day: threeDaysAgo,
        origin: 'REAL',
        heartRateMin: 62,
        sampleCount: 10,
        summarizerVersion: SUMMARIZER_VERSION,
        computedAt: new Date(),
      },
    })
  })

  afterAll(async () => {
    // Profile não tem cascade: apagar o funcionário sem apagar o perfil antes
    // viola a chave estrangeira e deixa lixo entre execuções.
    const workers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    await prisma.profile.deleteMany({ where: { userId: { in: workers.map((w) => w.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
    await app.close()
  })

  /**
   * Um lote com dois eventos separados no tempo, que é o formato do lote real
   * do relógio. Um evento sozinho no primeiro lote de uma sessão faria a janela
   * começar e terminar no mesmo instante, e janela sem duração não é avaliada.
   */
  const liveBatch = (session: string) => ({
    events: [
      event({ monitoringSessionId: session, eventTime: new Date(Date.now() - 10_000).toISOString() }),
      event({ monitoringSessionId: session, eventTime: new Date(Date.now() - 5_000).toISOString() }),
    ],
  })

  it('lote ao vivo grava uma avaliação com esforço e desgaste, e o read model a devolve como atual', async () => {
    const session = randomUUID()
    await post(headersA, liveBatch(session)).expect(200)

    const rows = await prisma.telemetryAssessment.findMany({ where: { sessionId: session } })
    expect(rows).toHaveLength(1)
    expect(rows[0].formulaVersion).toBe(FORMULA_VERSION)
    expect(rows[0].effortPercent).not.toBeNull()
    expect(rows[0].wearPercent).not.toBeNull()
    expect((rows[0].inputs as { chain: { reason: string } }).chain.reason).toBe('first_of_session')

    const current = await query.currentForWorker(workerA)
    expect(current.metrics.effort.quality).toBe('CURRENT')
    expect(current.metrics.wear.quality).toBe('CURRENT')
  })

  it('segundo lote em menos de 15 s não grava segunda avaliação', async () => {
    const session = randomUUID()
    await post(headersA, liveBatch(session)).expect(200)
    await post(headersA, { events: [event({ monitoringSessionId: session })] }).expect(200)
    expect(await prisma.telemetryAssessment.count({ where: { sessionId: session } })).toBe(1)
  })

  it('lote de backlog não avalia', async () => {
    const session = randomUUID()
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    await post(headersA, { events: [event({ monitoringSessionId: session, eventTime: threeHoursAgo })] }).expect(200)
    expect(await prisma.telemetryAssessment.count({ where: { sessionId: session } })).toBe(0)
  })

  it('sem dia fechado com batimento, a avaliação existe e diz que está indisponível', async () => {
    const session = randomUUID()
    await post(headersB, liveBatch(session)).expect(200)

    const rows = await prisma.telemetryAssessment.findMany({ where: { sessionId: session } })
    expect(rows).toHaveLength(1)
    expect(rows[0].effortPercent).toBeNull()
    expect((rows[0].inputs as { unavailableReason: string }).unavailableReason).toBe('no_resting_baseline')

    const current = await query.currentForWorker(workerB)
    expect(current.metrics.effort.quality).toBe('UNAVAILABLE')
  })
})
