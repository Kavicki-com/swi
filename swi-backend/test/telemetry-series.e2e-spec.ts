import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { monitoredDayOf } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'
import { PrismaService } from '../src/prisma/prisma.service'

// E2E da série por período: rota, guard, escopo por empresa e as duas fontes
// (Resumo do dia e amostras) contra o Postgres. A conta de cada balde é
// unitária; aqui se prova o caminho inteiro e que real e demonstração nunca se
// misturam no banco de verdade.
//
// CNPJs exclusivos deste spec, para a limpeza nunca alcançar outra empresa.
const CNPJ_A = '99000000000606'
const CNPJ_B = '99000000000607'
const DAY = 24 * 60 * 60 * 1000

describe('Telemetry series e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  const jwt = new JwtService({ secret: requireJwtSecret() })

  const emails = {
    worker: `telemetry-series-w-${randomUUID()}@ex.com`,
    adminA: `telemetry-series-a-${randomUUID()}@ex.com`,
    adminB: `telemetry-series-b-${randomUUID()}@ex.com`,
  }
  let workerId = ''
  const auth: Record<'worker' | 'adminA' | 'adminB', string> = { worker: '', adminA: '', adminB: '' }

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`)

  // Instantes relativos ao momento da suíte, porque a rota lê o relógio de verdade.
  const now = Date.now()
  const today = monitoredDayOf(new Date(now))
  /** Um dia fechado há tempo de sobra: dentro do mês, fora da semana. */
  const closedDay = new Date(today.getTime() - 10 * DAY)

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyA = (await prisma.company.create({ data: { name: 'Series A', cnpj: CNPJ_A, ...endereco } })).id
    const companyB = (await prisma.company.create({ data: { name: 'Series B', cnpj: CNPJ_B, ...endereco } })).id

    const user = async (email: string, role: 'WORKER' | 'ADMIN', companyId: string) =>
      (
        await prisma.user.create({
          data: {
            email,
            name: email.split('@')[0],
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
          },
        })
      ).id

    workerId = await user(emails.worker, 'WORKER', companyA)
    const adminA = await user(emails.adminA, 'ADMIN', companyA)
    const adminB = await user(emails.adminB, 'ADMIN', companyB)
    auth.worker = jwt.sign({ sub: workerId, role: 'WORKER' })
    auth.adminA = jwt.sign({ sub: adminA, role: 'ADMIN' })
    auth.adminB = jwt.sign({ sub: adminB, role: 'ADMIN' })

    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: `hash-${randomUUID()}` },
    })
    const realSession = randomUUID()
    const demoSession = randomUUID()
    await prisma.telemetrySession.createMany({
      data: [
        { id: realSession, deviceId: device.id, workerId, origin: 'REAL', startedAt: new Date(now - 60_000) },
        { id: demoSession, deviceId: device.id, workerId, origin: 'DEMO', startedAt: new Date(now - 60_000) },
      ],
    })

    // O snapshot fixa a origem da série: real.
    await prisma.telemetrySnapshot.create({
      data: { workerId, sessionId: realSession, origin: 'REAL', lastEventTime: new Date(now - 10_000) },
    })

    let sequence = 0
    const sampleRow = (sessionId: string, origin: 'REAL' | 'DEMO', at: number, bpm: number, kcal: number) => ({
      eventId: randomUUID(),
      sessionId,
      deviceId: device.id,
      workerId,
      origin,
      sequence: ++sequence,
      eventTime: new Date(at),
      receivedAt: new Date(at),
      heartRateBpm: bpm,
      activeEnergyKcal: kcal,
      payload: {},
      payloadHash: `hash-${randomUUID()}`,
    })
    await prisma.telemetrySample.createMany({
      data: [
        sampleRow(realSession, 'REAL', now - 30_000, 100, 1.5),
        sampleRow(realSession, 'REAL', now - 10_000, 120, 2.5),
        // Demonstração no mesmo minuto: nunca pode aparecer na série real.
        sampleRow(demoSession, 'DEMO', now - 20_000, 200, 50),
      ],
    })

    const summary = (origin: 'REAL' | 'DEMO', stepsTotal: number) => ({
      workerId,
      day: closedDay,
      origin,
      stepsTotal,
      stepsCount: 3,
      sampleCount: 3,
      coveredMs: 6 * 60 * 60 * 1000,
      summarizerVersion: SUMMARIZER_VERSION,
      computedAt: new Date(now),
    })
    await prisma.telemetryDailySummary.createMany({ data: [summary('REAL', 5000), summary('DEMO', 9999)] })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('me/series de hoje traz as amostras reais em baldes de hora, sem a demonstração', async () => {
    const { body } = await get('/telemetry/v1/me/series?period=day', auth.worker).expect(200)

    expect(body.origin).toBe('REAL')
    expect(body.bucket).toBe('hour')
    // As duas amostras caem num balde só, ou em dois se a suíte rodar na virada
    // da hora; o conjunto é o mesmo nos dois casos, e o 200 da demonstração
    // nunca aparece.
    type Point = { heartRate: { min: number | null; max: number | null }; activeEnergyKcal: number | null }
    const measured: Point[] = body.points.filter((p: Point) => p.heartRate.max !== null)
    expect(Math.min(...measured.map((p) => p.heartRate.min as number))).toBe(100)
    expect(Math.max(...measured.map((p) => p.heartRate.max as number))).toBe(120)
    expect(measured.reduce((sum, p) => sum + (p.activeEnergyKcal ?? 0), 0)).toBe(4)
  })

  it('me/series do mês lê o Resumo do dia fechado, na origem da série', async () => {
    const { body } = await get('/telemetry/v1/me/series?period=month', auth.worker).expect(200)

    expect(body.bucket).toBe('day')
    expect(body.points).toHaveLength(30)
    const closed = body.points.find(
      (p: { start: string }) => p.start === new Date(closedDay.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    )
    expect(closed.steps).toBe(5000)
    // O dia de hoje ainda não tem Resumo e sai das amostras.
    expect(body.points[29].heartRate.max).toBe(120)
  })

  it('a semana não alcança o dia fechado há dez dias', async () => {
    const { body } = await get('/telemetry/v1/me/series?period=week', auth.worker).expect(200)

    expect(body.points).toHaveLength(7)
    expect(body.points.some((p: { steps: number | null }) => p.steps === 5000)).toBe(false)
  })

  it('período ausente ou fora da lista é recusado', async () => {
    await get('/telemetry/v1/me/series', auth.worker).expect(400)
    await get('/telemetry/v1/me/series?period=year', auth.worker).expect(400)
  })

  it('administrador da empresa lê a série do funcionário', async () => {
    const { body } = await get(`/telemetry/v1/workers/${workerId}/series?period=day`, auth.adminA).expect(200)

    expect(body.workerId).toBe(workerId)
    expect(body.origin).toBe('REAL')
  })

  it('administrador de outra empresa recebe 404, igual a funcionário inexistente', async () => {
    await get(`/telemetry/v1/workers/${workerId}/series?period=day`, auth.adminB).expect(404)
  })

  it('funcionário não lê a rota do painel', async () => {
    await get(`/telemetry/v1/workers/${workerId}/series?period=day`, auth.worker).expect(403)
  })
})
