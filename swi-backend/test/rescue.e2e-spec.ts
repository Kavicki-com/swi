// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init(), mesmo num teste sem mídia.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// CNPJs EXCLUSIVOS deste teste: o cleanup apaga por CNPJ, e um valor do seed ou
// de outra suíte apagaria a empresa de lá.
const CNPJ_A = '99000000002001'
const CNPJ_B = '99000000002002'

describe('Rescue (resgate) e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    injured: 'resgate-ferido@ex.com',
    rescuer: 'resgate-socorrista@ex.com',
    admin: 'resgate-admin@ex.com',
    otherAdmin: 'resgate-admin-b@ex.com',
    otherWorker: 'resgate-worker-b@ex.com',
    supervisor: 'resgate-supervisor@ex.com',
    colleague: 'resgate-colega@ex.com',
    bystander: 'resgate-alheio@ex.com',
  }
  let injuredId: string, rescuerId: string, otherWorkerId: string, colleagueId: string

  const cleanup = async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.rescue.deleteMany({ where: { OR: [{ injuredId: { in: ids } }, { rescuerId: { in: ids } }] } })
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
      await prisma.journey.deleteMany({ where: { workerId: { in: ids } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Resgate A', cnpj: CNPJ_A, ...addr } })).id
    const otherCompanyId = (await prisma.company.create({ data: { name: 'Resgate B', cnpj: CNPJ_B, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    injuredId = (await prisma.user.create({ data: { email: emails.injured, name: 'Ana Ferida', role: 'WORKER', companyId, ...base } })).id
    rescuerId = (await prisma.user.create({ data: { email: emails.rescuer, name: 'Bruno Socorro', role: 'WORKER', companyId, ...base } })).id
    await prisma.user.create({ data: { email: emails.admin, name: 'Admin Resgate', role: 'ADMIN', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.supervisor, name: 'Supervisor Resgate', role: 'SUPERVISOR', companyId, ...base } })
    colleagueId = (await prisma.user.create({ data: { email: emails.colleague, name: 'Carla Colega', role: 'WORKER', companyId, ...base } })).id
    await prisma.user.create({ data: { email: emails.bystander, name: 'Davi Alheio', role: 'WORKER', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.otherAdmin, name: 'Admin B', role: 'ADMIN', companyId: otherCompanyId, ...base } })
    otherWorkerId = (await prisma.user.create({ data: { email: emails.otherWorker, name: 'Worker B', role: 'WORKER', companyId: otherCompanyId, ...base } })).id
  })
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/alerts/rescues').expect(401))

  it('funcionário lê o histórico (200) mas não despacha, não registra chegada nem encerra (403)', async () => {
    const server = app.getHttpServer()
    const w = await login(emails.injured)
    await request(server).get('/alerts/rescues').set(w).expect(200)
    await request(server).post(`/alerts/${injuredId}/rescue`).set(w).send({ rescuerId }).expect(403)
    await request(server).post(`/alerts/rescues/qualquer/arrive`).set(w).expect(403)
    await request(server).post(`/alerts/rescues/qualquer/end`).set(w).expect(403)
  })

  it('ciclo: despacha (pausa a jornada do socorrista e o notifica) → chega (retoma) → encerra', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)

    const { body: rescue } = await request(server).post(`/alerts/${injuredId}/rescue`).set(a).send({ rescuerId }).expect(201)
    expect(typeof rescue.id).toBe('string')
    expect(typeof rescue.number).toBe('number')
    expect(rescue.status).toBe('dispatched')
    expect(rescue.injured).toEqual({ id: injuredId, name: 'Ana Ferida' })
    expect(rescue.rescuer).toEqual({ id: rescuerId, name: 'Bruno Socorro' })
    expect(rescue.arrivedAt).toBeNull()
    expect(rescue.endedAt).toBeNull()

    // A jornada do socorrista ficou pausada e ele foi notificado (domínio rescue,
    // apontando para o resgate). O fan-out roda inline em NODE_ENV=test.
    const paused = await prisma.journey.findFirst({ where: { workerId: rescuerId } })
    expect(paused?.state).toBe('paused')
    const note = await prisma.notification.findFirst({ where: { workerId: rescuerId, domain: 'rescue' } })
    expect(note?.targetId).toBe(rescue.id)

    const { body: arrived } = await request(server).post(`/alerts/rescues/${rescue.id as string}/arrive`).set(a).expect(200)
    expect(arrived.status).toBe('arrived')
    expect(arrived.arrivedAt).not.toBeNull()
    const resumed = await prisma.journey.findFirst({ where: { workerId: rescuerId } })
    expect(resumed?.state).toBe('ongoing')

    const { body: ended } = await request(server).post(`/alerts/rescues/${rescue.id as string}/end`).set(a).expect(200)
    expect(ended.status).toBe('ended')
    expect(ended.endedAt).not.toBeNull()

    // Encerrar de novo não é permitido.
    await request(server).post(`/alerts/rescues/${rescue.id as string}/end`).set(a).expect(409)
    await request(server).post(`/alerts/rescues/${rescue.id as string}/arrive`).set(a).expect(409)

    const { body: list } = await request(server).get('/alerts/rescues').set(a).expect(200)
    expect(list.map((r: { id: string }) => r.id)).toContain(rescue.id)
  })

  it('validações: a si mesmo (400), socorrista de outra empresa (404), outra empresa não encerra (404)', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const b = await login(emails.otherAdmin)

    await request(server).post(`/alerts/${injuredId}/rescue`).set(a).send({ rescuerId: injuredId }).expect(400)
    await request(server).post(`/alerts/${injuredId}/rescue`).set(a).send({ rescuerId: otherWorkerId }).expect(404)

    const { body: rescue } = await request(server).post(`/alerts/${injuredId}/rescue`).set(a).send({ rescuerId }).expect(201)
    await request(server).post(`/alerts/rescues/${rescue.id as string}/arrive`).set(b).expect(404)
    await request(server).post(`/alerts/rescues/${rescue.id as string}/end`).set(b).expect(404)
  })

  // Funcionário só vê os resgates em que é o ferido ou o socorrista: a lista
  // traz os nomes das duas pontas. Administrador e Supervisor veem todos os da
  // empresa; outra empresa não vê nenhum.
  it('funcionário vê só os resgates em que é ferido ou socorrista; painel vê todos; outra empresa não vê', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const { body: doFerido } = await request(server).post(`/alerts/${injuredId}/rescue`).set(a).send({ rescuerId }).expect(201)
    const { body: daColega } = await request(server).post(`/alerts/${colleagueId}/rescue`).set(a).send({ rescuerId }).expect(201)
    const ids = async (who: string) => {
      const { body } = await request(server).get('/alerts/rescues').set(await login(who)).expect(200)
      return (body as { id: string }[]).map((r) => r.id)
    }

    const ferido = await ids(emails.injured)
    expect(ferido).toContain(doFerido.id)
    expect(ferido).not.toContain(daColega.id)

    const socorrista = await ids(emails.rescuer)
    expect(socorrista).toEqual(expect.arrayContaining([doFerido.id, daColega.id]))

    const colega = await ids(emails.colleague)
    expect(colega).toContain(daColega.id)
    expect(colega).not.toContain(doFerido.id)

    expect(await ids(emails.bystander)).toEqual([])

    expect(await ids(emails.admin)).toEqual(expect.arrayContaining([doFerido.id, daColega.id]))
    expect(await ids(emails.supervisor)).toEqual(expect.arrayContaining([doFerido.id, daColega.id]))

    const outraEmpresa = await ids(emails.otherAdmin)
    expect(outraEmpresa).not.toContain(doFerido.id)
    expect(outraEmpresa).not.toContain(daColega.id)
    expect(await ids(emails.otherWorker)).toEqual([])
  })
})
