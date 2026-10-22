// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init(), mesmo num teste sem mídia.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// Pedido de ajuda pelo botão "Ajuda urgente" do app, contra o banco real: o
// valor novo do enum existe depois do migrate deploy, o toque duplo e a chave
// de idempotência não abrem dois alertas, o pedido cai na fila de urgentes e
// na lista do painel, o despacho de socorrista o marca atendido, o fim do
// resgate o fecha, e a pausa dos alertas não o cala.
//
// CNPJs exclusivos deste spec: o cleanup apaga por CNPJ.
const CNPJ = '99000000000921'
const OUTRO_CNPJ = '99000000000922'

describe('Help requests e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    admin: `help-admin-${randomUUID()}@ex.com`,
    supervisor: `help-sup-${randomUUID()}@ex.com`,
    ferida: `help-ferida-${randomUUID()}@ex.com`,
    socorrista: `help-socorrista-${randomUUID()}@ex.com`,
    colega: `help-colega-${randomUUID()}@ex.com`,
    outroAdmin: `help-outro-admin-${randomUUID()}@ex.com`,
  }
  const ids: Record<string, string> = {}
  const auth: Record<string, { Authorization: string }> = {}

  const api = () => request(app.getHttpServer())
  const login = async (email: string) => {
    const { body } = await api().post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }
  const helpAlerts = () =>
    prisma.operationalAlert.findMany({
      where: { workerId: ids.ferida, condition: { kind: 'HELP_REQUESTED' } },
      orderBy: { createdAt: 'asc' },
    })
  const entryOf = (body: { workers: Array<{ worker: { id: string }; helpRequest: unknown }> }, workerId: string) =>
    body.workers.find((w) => w.worker.id === workerId)

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    // Resgate, jornada, posição e notificação não têm cascade; condição, alerta
    // e chave de idempotência caem com o funcionário.
    await prisma.rescue.deleteMany({ where: { OR: [{ injuredId: { in: userIds } }, { rescuerId: { in: userIds } }] } })
    await prisma.notification.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.journey.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.workerPosition.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.workerPositionSample.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.profile.deleteMany({ where: { userId: { in: userIds } } })
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
    const companyId = (await prisma.company.create({ data: { name: 'Ajuda Co', cnpj: CNPJ, ...endereco } })).id
    const outraId = (await prisma.company.create({ data: { name: 'Outra Co', cnpj: OUTRO_CNPJ, ...endereco } })).id

    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const user = async (
      key: keyof typeof emails,
      name: string,
      role: 'ADMIN' | 'SUPERVISOR' | 'WORKER',
      company: string,
    ) => {
      ids[key] = (
        await prisma.user.create({
          data: { email: emails[key], name, passwordHash, role, emailVerified: true, approvalStatus: 'APPROVED', companyId: company },
        })
      ).id
      auth[key] = await login(emails[key])
    }
    await user('admin', 'Admin Ajuda', 'ADMIN', companyId)
    await user('supervisor', 'Supervisora Ajuda', 'SUPERVISOR', companyId)
    await user('ferida', 'Ana Ferida', 'WORKER', companyId)
    await user('socorrista', 'Bruno Socorro', 'WORKER', companyId)
    await user('colega', 'Carla Colega', 'WORKER', companyId)
    await user('outroAdmin', 'Admin Outra', 'ADMIN', outraId)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('1. só o funcionário pede ajuda; a equipe do painel recebe 403', async () => {
    await api().post('/help-requests').set(auth.admin).expect(403)
    await api().post('/help-requests').set(auth.supervisor).expect(403)
    await api().get('/help-requests/mine').set(auth.admin).expect(403)
    await api().post('/help-requests').expect(401)
  })

  it('2. com os alertas pausados, o pedido abre alerta urgente na fila, notifica a equipe e aparece na lista do painel', async () => {
    // A pausa cala o motor de condições, nunca o pedido de ajuda.
    await api().put(`/telemetry/v1/workers/${ids.ferida}/monitoring-pause`).set(auth.admin).expect(200)

    const { body } = await api().post('/help-requests').set(auth.ferida).expect(201)
    expect(body).toMatchObject({ status: 'OPEN', attendedAt: null, closedAt: null, rescue: null })
    expect(typeof body.id).toBe('string')

    const { body: fila } = await api().get('/telemetry/v1/admin/alerts').set(auth.supervisor).expect(200)
    const item = fila.items.find((i: { id: string }) => i.id === body.id)
    expect(item).toMatchObject({
      status: 'OPEN',
      worker: { id: ids.ferida, name: 'Ana Ferida' },
      condition: { kind: 'HELP_REQUESTED', category: 'URGENT' },
    })

    const notificacoes = await prisma.notification.findMany({
      where: { title: 'Pedido de ajuda: Ana Ferida', workerId: { in: Object.values(ids) } },
    })
    expect(notificacoes.map((n) => n.workerId).sort()).toEqual([ids.admin, ids.supervisor].sort())
    expect(await prisma.notification.count({ where: { workerId: ids.ferida } })).toBe(0)

    const { body: painel } = await api().get('/telemetry/v1/admin/workers').set(auth.admin).expect(200)
    expect(entryOf(painel, ids.ferida)?.helpRequest).toEqual({
      id: body.id,
      status: 'OPEN',
      createdAt: body.createdAt,
      rescueId: null,
    })
    // Quem pediu ajuda vem primeiro na lista.
    expect(painel.workers[0].worker.id).toBe(ids.ferida)
    expect(entryOf(painel, ids.colega)?.helpRequest).toBeNull()
  })

  it('3. toque duplo e reenvio com a mesma chave devolvem o mesmo pedido', async () => {
    const key = randomUUID()
    const { body: primeiro } = await api().post('/help-requests').set(auth.ferida).expect(201)
    const { body: comChave } = await api().post('/help-requests').set(auth.ferida).set('Idempotency-Key', key).expect(201)
    const { body: reenvio } = await api().post('/help-requests').set(auth.ferida).set('Idempotency-Key', key).expect(201)
    expect(comChave.id).toBe(primeiro.id)
    expect(reenvio.id).toBe(primeiro.id)
    // Dois toques ao mesmo tempo também não abrem dois.
    await Promise.all([
      api().post('/help-requests').set(auth.ferida).expect(201),
      api().post('/help-requests').set(auth.ferida).expect(201),
    ])
    expect(await helpAlerts()).toHaveLength(1)
    await api().post('/help-requests').set(auth.ferida).set('Idempotency-Key', 'nao-e-uuid').expect(400)
  })

  it('4. cada funcionário lê só o próprio pedido', async () => {
    const { body } = await api().get('/help-requests/mine').set(auth.colega).expect(200)
    expect(body).toEqual({ helpRequest: null })
    const { body: dela } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    expect(dela.helpRequest.status).toBe('OPEN')
  })

  let rescueId = ''
  it('5. despachar socorrista marca o pedido atendido e dá à ferida a posição do socorrista', async () => {
    await api().post('/positions/heartbeat').set(auth.socorrista).send({ lat: -3.1, lng: -60.02 }).expect(204)
    const { body: resgate } = await api()
      .post(`/alerts/${ids.ferida}/rescue`)
      .set(auth.supervisor)
      .send({ rescuerId: ids.socorrista })
      .expect(201)
    rescueId = resgate.id as string

    const [alerta] = await helpAlerts()
    expect(alerta).toMatchObject({ status: 'ACKNOWLEDGED', triagedById: ids.supervisor })
    expect(alerta.acknowledgedAt).not.toBeNull()

    const { body } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    expect(body.helpRequest).toMatchObject({
      id: alerta.id,
      status: 'ATTENDED',
      closedAt: null,
      rescue: { id: rescueId, status: 'dispatched', arrivedAt: null, rescuerPosition: { lat: -3.1, lng: -60.02 } },
    })
    // Do socorrista, só a posição: nada de nome nem de id dele.
    expect(Object.keys(body.helpRequest.rescue).sort()).toEqual(['arrivedAt', 'dispatchedAt', 'id', 'rescuerPosition', 'status'])
    expect(Object.keys(body.helpRequest.rescue.rescuerPosition).sort()).toEqual(['lat', 'lng', 'recordedAt'])

    const { body: painel } = await api().get('/telemetry/v1/admin/workers').set(auth.admin).expect(200)
    expect(entryOf(painel, ids.ferida)?.helpRequest).toMatchObject({ status: 'ATTENDED', rescueId })

    // Novo toque com o pedido atendido continua devolvendo o mesmo.
    const { body: toque } = await api().post('/help-requests').set(auth.ferida).expect(201)
    expect(toque.id).toBe(alerta.id)
  })

  it('6. encerrar o resgate fecha o pedido, e o próximo toque abre um novo', async () => {
    await api().post(`/alerts/rescues/${rescueId}/end`).set(auth.admin).expect(200)

    const [alerta] = await helpAlerts()
    expect(alerta).toMatchObject({ status: 'RESOLVED', triagedById: ids.admin, resolutionNote: 'Resgate encerrado.' })

    const { body } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    expect(body.helpRequest).toMatchObject({ status: 'CLOSED', rescue: { status: 'ended', rescuerPosition: null } })
    expect(body.helpRequest.closedAt).not.toBeNull()

    const { body: painel } = await api().get('/telemetry/v1/admin/workers').set(auth.admin).expect(200)
    expect(entryOf(painel, ids.ferida)?.helpRequest).toBeNull()

    const { body: novo } = await api().post('/help-requests').set(auth.ferida).expect(201)
    expect(novo.id).not.toBe(alerta.id)
    expect(novo.status).toBe('OPEN')
  })

  it('7. tratar direto na fila também vale, sem resgate, e outra empresa não vê o pedido', async () => {
    const { body } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    const id = body.helpRequest.id as string

    await api().post(`/telemetry/v1/admin/alerts/${id}/acknowledge`).set(auth.outroAdmin).expect(404)

    await api().post(`/telemetry/v1/admin/alerts/${id}/acknowledge`).set(auth.supervisor).expect(200)
    const { body: atendido } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    expect(atendido.helpRequest.status).toBe('ATTENDED')

    await api()
      .post(`/telemetry/v1/admin/alerts/${id}/resolve`)
      .set(auth.supervisor)
      .send({ note: 'Atendida no local.' })
      .expect(200)
    const { body: depois } = await api().get('/help-requests/mine').set(auth.ferida).expect(200)
    expect(depois.helpRequest).toMatchObject({ id, status: 'CLOSED', rescue: null })
  })
})
