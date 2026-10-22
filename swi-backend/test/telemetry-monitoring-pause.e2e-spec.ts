import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'

// Pausa dos alertas de um funcionário pelo painel (férias, afastamento), contra
// o banco real: a coluna nova existe depois do migrate deploy, a rota segue a
// matriz, e com a pausa ligada o lote de risco é gravado sem abrir condição,
// alerta nem aviso. Retomar volta ao normal a partir do próximo lote.
//
// CNPJs exclusivos deste spec: o cleanup apaga por CNPJ.
const CNPJ = '99000000000901'
const OUTRO_CNPJ = '99000000000902'

describe('Telemetry monitoring pause e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    admin: `pause-admin-${randomUUID()}@ex.com`,
    supervisor: `pause-sup-${randomUUID()}@ex.com`,
    worker: `pause-worker-${randomUUID()}@ex.com`,
    outroAdmin: `pause-outro-admin-${randomUUID()}@ex.com`,
  }
  let workerId = ''
  let admin = { Authorization: '' }
  let supervisor = { Authorization: '' }
  let worker = { Authorization: '' }
  let outroAdmin = { Authorization: '' }
  let device: Record<string, string> = {}

  const api = () => request(app.getHttpServer())
  const login = async (email: string) => {
    const { body } = await api().post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }
  const pauseUrl = () => `/telemetry/v1/workers/${workerId}/monitoring-pause`

  let sequence = 0
  /** 185 bpm por 60 s, a cada 5 s: passa da trava de batimento alto de quem nasceu em 1991 (165). */
  const sustainedBatch = () => {
    const session = randomUUID()
    const now = Date.now()
    return {
      events: Array.from({ length: 13 }, (_, i) => ({
        eventId: randomUUID(),
        monitoringSessionId: session,
        sequence: ++sequence,
        eventTime: new Date(now - (12 - i) * 5_000).toISOString(),
        origin: 'REAL',
        measurements: { heartRate: { value: 185, unit: 'bpm', source: 'APPLE_WATCH' } },
      })),
    }
  }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    // Perfil e notificação não têm cascade; condição, alerta e amostra caem com o funcionário.
    await prisma.profile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ, OUTRO_CNPJ] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Pausa Co', cnpj: CNPJ, ...endereco } })).id
    const outraId = (await prisma.company.create({ data: { name: 'Outra Co', cnpj: OUTRO_CNPJ, ...endereco } })).id

    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const user = (email: string, name: string, role: 'ADMIN' | 'SUPERVISOR' | 'WORKER', company: string) =>
      prisma.user.create({
        data: { email, name, passwordHash, role, emailVerified: true, approvalStatus: 'APPROVED', companyId: company },
      })
    await user(emails.admin, 'Admin Pausa', 'ADMIN', companyId)
    await user(emails.supervisor, 'Supervisora Pausa', 'SUPERVISOR', companyId)
    await user(emails.outroAdmin, 'Admin Outra', 'ADMIN', outraId)
    workerId = (await user(emails.worker, 'Funcionario Pausa', 'WORKER', companyId)).id
    await prisma.profile.create({ data: { userId: workerId, birthDate: new Date('1991-05-10T00:00:00.000Z') } })

    const secret = randomUUID().replace(/-/g, '')
    const row = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: hashCredential(secret) },
    })
    device = { Authorization: `Device ${encodeCredential(row.id, secret)}` }

    admin = await login(emails.admin)
    supervisor = await login(emails.supervisor)
    worker = await login(emails.worker)
    outroAdmin = await login(emails.outroAdmin)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const conditions = () => prisma.telemetryCondition.findMany({ where: { workerId } })
  const alerts = () => prisma.operationalAlert.findMany({ where: { workerId } })

  it('1. quem não pode mudar a pausa é barrado', async () => {
    await api().put(pauseUrl()).set(worker).expect(403)
    await api().delete(pauseUrl()).set(worker).expect(403)
    // Outra empresa: o funcionário não existe para ela.
    await api().put(pauseUrl()).set(outroAdmin).expect(404)
    const { body } = await api().get(`/users/${workerId}`).set(admin).expect(200)
    expect(body.monitoringPausedAt).toBeNull()
  })

  it('2. o administrador pausa, e a lista e o detalhe de funcionários mostram desde quando', async () => {
    const { body } = await api().put(pauseUrl()).set(admin).expect(200)
    expect(body.workerId).toBe(workerId)
    expect(typeof body.monitoringPausedAt).toBe('string')

    // Pausar de novo mantém o instante original.
    const { body: again } = await api().put(pauseUrl()).set(admin).expect(200)
    expect(again.monitoringPausedAt).toBe(body.monitoringPausedAt)

    const { body: detail } = await api().get(`/users/${workerId}`).set(admin).expect(200)
    expect(detail.monitoringPausedAt).toBe(body.monitoringPausedAt)
    const { body: list } = await api().get('/users?role=WORKER').set(supervisor).expect(200)
    expect(list.find((u: { id: string }) => u.id === workerId).monitoringPausedAt).toBe(body.monitoringPausedAt)
  })

  it('3. pausado, o lote de risco é gravado sem abrir condição, alerta nem aviso', async () => {
    await api().post('/telemetry/v1/batches').set(device).send(sustainedBatch()).expect(200)

    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBeGreaterThan(0)
    expect(await conditions()).toEqual([])
    expect(await alerts()).toEqual([])
    expect(await prisma.notification.count({ where: { workerId, domain: 'health' } })).toBe(0)
  })

  it('4. o supervisor retoma, e o próximo lote de risco abre condição e alerta', async () => {
    const { body } = await api().delete(pauseUrl()).set(supervisor).expect(200)
    expect(body).toEqual({ workerId, monitoringPausedAt: null })

    await api().post('/telemetry/v1/batches').set(device).send(sustainedBatch()).expect(200)

    const rows = await conditions()
    expect(rows.map((c) => [c.kind, c.status])).toEqual([['HEART_RATE_HIGH', 'ACTIVE']])
    expect((await alerts()).map((a) => a.status)).toEqual(['OPEN'])
  })

  it('5. pausar de novo não fecha o que já estava aberto', async () => {
    await api().put(pauseUrl()).set(supervisor).expect(200)

    await api().post('/telemetry/v1/batches').set(device).send(sustainedBatch()).expect(200)

    const rows = await conditions()
    expect(rows.map((c) => [c.kind, c.status])).toEqual([['HEART_RATE_HIGH', 'ACTIVE']])
    expect((await alerts()).map((a) => a.status)).toEqual(['OPEN'])
  })
})
