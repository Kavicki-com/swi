import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { ALERT_PROFILE_VERSION } from '../src/telemetry/alerts/alert-profile'

// E2E da fila de alertas do painel. O que só o banco prova: o escopo de
// empresa pelo funcionário do alerta, a origem real como filtro, e a
// transição condicional ao estado gravado. As condições e os alertas entram
// direto pelo Prisma: quem os cria de verdade é o motor, que tem suíte própria.
//
// CNPJs exclusivos deste spec, pelo mesmo motivo do spec de condições: reusar o
// do seed apagaria a empresa demo.
const CNPJ_A = '99000000000404'
const CNPJ_B = '99000000000405'

describe('Telemetry alert queue e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    adminA: `alert-queue-admin-a-${randomUUID()}@ex.com`,
    adminB: `alert-queue-admin-b-${randomUUID()}@ex.com`,
    worker: `alert-queue-worker-${randomUUID()}@ex.com`,
  }
  let workerId = ''
  let adminA = { Authorization: '' }
  let adminB = { Authorization: '' }
  let workerAuth = { Authorization: '' }
  let realAlert = ''
  let demoAlert = ''
  let healthAlert = ''

  const api = () => request(app.getHttpServer())
  const login = async (email: string) => {
    const { body } = await api().post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  const alertFor = async (kind: TelemetryConditionKind, origin: TelemetryOrigin, minutesAgo: number) => {
    const at = new Date(Date.now() - minutesAgo * 60_000)
    const condition = await prisma.telemetryCondition.create({
      data: {
        workerId,
        origin,
        kind,
        firstSeenAt: at,
        lastSeenAt: at,
        thresholdProfile: ALERT_PROFILE_VERSION,
        observedValue: 185,
        thresholdValue: 165,
      },
    })
    return (
      await prisma.operationalAlert.create({
        data: { conditionId: condition.id, workerId, origin, status: 'OPEN', createdAt: at },
      })
    ).id
  }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    // Condição e alerta caem em cascata com o funcionário; perfil não tem
    // cascade e precisa sair antes.
    await prisma.profile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyA = (await prisma.company.create({ data: { name: 'Fila A', cnpj: CNPJ_A, ...endereco } })).id
    const companyB = (await prisma.company.create({ data: { name: 'Fila B', cnpj: CNPJ_B, ...endereco } })).id

    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const user = (email: string, name: string, role: 'ADMIN' | 'WORKER', companyId: string) =>
      prisma.user.create({
        data: { email, name, passwordHash, role, emailVerified: true, approvalStatus: 'APPROVED', companyId },
      })

    await user(emails.adminA, 'Admin A', 'ADMIN', companyA)
    await user(emails.adminB, 'Admin B', 'ADMIN', companyB)
    workerId = (await user(emails.worker, 'Funcionaria Fila', 'WORKER', companyA)).id
    await prisma.profile.create({ data: { userId: workerId, fullName: 'Funcionaria Fila', sector: 'Leste' } })

    realAlert = await alertFor('HEART_RATE_HIGH', 'REAL', 10)
    healthAlert = await alertFor('WEAR_HIGH', 'REAL', 5)
    demoAlert = await alertFor('HEART_RATE_HIGH', 'DEMO', 1)

    adminA = await login(emails.adminA)
    adminB = await login(emails.adminB)
    workerAuth = await login(emails.worker)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('1. lista o que falta resolver, real, da empresa, mais novo primeiro', async () => {
    const { body } = await api().get('/telemetry/v1/admin/alerts').set(adminA).expect(200)
    const ids = body.items.map((i: { id: string }) => i.id)
    expect(ids).toEqual([healthAlert, realAlert])
    expect(ids).not.toContain(demoAlert)
    expect(body.items[1]).toMatchObject({
      origin: 'REAL',
      status: 'OPEN',
      worker: { id: workerId, name: 'Funcionaria Fila', sector: 'Leste' },
      condition: { kind: 'HEART_RATE_HIGH', category: 'URGENT', observedValue: 185, thresholdValue: 165 },
      triagedBy: null,
    })
    expect(body.items[0].condition.category).toBe('HEALTH')
  })

  it('2. administrador de outra empresa não vê a fila nem consegue triá-la', async () => {
    const { body } = await api().get('/telemetry/v1/admin/alerts').set(adminB).expect(200)
    expect(body.items).toEqual([])
    await api().post(`/telemetry/v1/admin/alerts/${realAlert}/acknowledge`).set(adminB).expect(404)
    await api().post(`/telemetry/v1/admin/alerts/${realAlert}/resolve`).set(adminB).send({}).expect(404)
  })

  it('3. funcionário não acessa a fila', async () => {
    await api().get('/telemetry/v1/admin/alerts').set(workerAuth).expect(403)
    await api().post(`/telemetry/v1/admin/alerts/${realAlert}/acknowledge`).set(workerAuth).expect(403)
  })

  it('4. alerta de demonstração não é triável: responde como inexistente', async () => {
    await api().post(`/telemetry/v1/admin/alerts/${demoAlert}/acknowledge`).set(adminA).expect(404)
  })

  it('5. reconhecer grava quem e quando, e repetir devolve o mesmo estado', async () => {
    const first = await api().post(`/telemetry/v1/admin/alerts/${realAlert}/acknowledge`).set(adminA).expect(200)
    expect(first.body.status).toBe('ACKNOWLEDGED')
    expect(first.body.triagedBy.name).toBe('Admin A')
    expect(first.body.acknowledgedAt).not.toBeNull()

    const again = await api().post(`/telemetry/v1/admin/alerts/${realAlert}/acknowledge`).set(adminA).expect(200)
    expect(again.body.acknowledgedAt).toBe(first.body.acknowledgedAt)
  })

  it('6. resolver encerra com nota; repetir não troca a nota; reconhecer depois é conflito', async () => {
    const resolved = await api()
      .post(`/telemetry/v1/admin/alerts/${realAlert}/resolve`)
      .set(adminA)
      .send({ note: 'Pausa de 15 minutos' })
      .expect(200)
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Pausa de 15 minutos' })

    const again = await api()
      .post(`/telemetry/v1/admin/alerts/${realAlert}/resolve`)
      .set(adminA)
      .send({ note: 'outra' })
      .expect(200)
    expect(again.body.resolutionNote).toBe('Pausa de 15 minutos')

    await api().post(`/telemetry/v1/admin/alerts/${realAlert}/acknowledge`).set(adminA).expect(409)
  })

  it('7. resolvido sai da fila padrão e aparece pelo filtro de estado', async () => {
    const pending = await api().get('/telemetry/v1/admin/alerts').set(adminA).expect(200)
    expect(pending.body.items.map((i: { id: string }) => i.id)).toEqual([healthAlert])

    const resolved = await api().get('/telemetry/v1/admin/alerts?status=RESOLVED').set(adminA).expect(200)
    expect(resolved.body.items.map((i: { id: string }) => i.id)).toEqual([realAlert])
  })

  it('8. pagina pelo cursor', async () => {
    const first = await api().get('/telemetry/v1/admin/alerts?status=OPEN,RESOLVED&limit=1').set(adminA).expect(200)
    expect(first.body.items).toHaveLength(1)
    expect(first.body.nextCursor).toBe(healthAlert)
    const second = await api()
      .get(`/telemetry/v1/admin/alerts?status=OPEN,RESOLVED&limit=1&cursor=${first.body.nextCursor}`)
      .set(adminA)
      .expect(200)
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual([realAlert])
    expect(second.body.nextCursor).toBeNull()
  })

  // Homologação liga a flag para o roteiro de aceite ver o alerta que o injetor
  // de demonstração abre. A flag é lida a cada pedido, então basta ligá-la aqui
  // e devolver o valor anterior no fim, para não vazar para os outros casos.
  it('10. com TELEMETRY_ALERTS_INCLUDE_DEMO=1, demonstração entra na fila e pode ser triada', async () => {
    const original = process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
    process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = '1'
    try {
      const { body } = await api().get('/telemetry/v1/admin/alerts').set(adminA).expect(200)
      const demo = body.items.find((i: { id: string }) => i.id === demoAlert)
      expect(demo).toMatchObject({ origin: 'DEMO', status: 'OPEN' })

      const acked = await api().post(`/telemetry/v1/admin/alerts/${demoAlert}/acknowledge`).set(adminA).expect(200)
      expect(acked.body).toMatchObject({ origin: 'DEMO', status: 'ACKNOWLEDGED' })

      // Outra empresa continua sem enxergar, com ou sem a flag.
      await api().post(`/telemetry/v1/admin/alerts/${demoAlert}/resolve`).set(adminB).send({}).expect(404)
    } finally {
      if (original === undefined) delete process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
      else process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = original
    }

    // Desligada de novo: o mesmo alerta volta a responder como inexistente.
    await api().post(`/telemetry/v1/admin/alerts/${demoAlert}/resolve`).set(adminA).send({}).expect(404)
  })

  it('9. estado e nota inválidos são recusados', async () => {
    await api().get('/telemetry/v1/admin/alerts?status=BOGUS').set(adminA).expect(400)
    await api()
      .post(`/telemetry/v1/admin/alerts/${healthAlert}/resolve`)
      .set(adminA)
      .send({ note: 'x'.repeat(501) })
      .expect(400)
  })
})
