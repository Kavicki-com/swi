import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// CNPJ EXCLUSIVO deste teste. Não reutilizar valores do seed: a suíte roda
// contra o banco de DEV e o cleanup apaga por CNPJ, o que desvincularia os
// usuários da empresa demo (User.companyId é opcional, logo SetNull).
const CNPJ = '99000000000303'

// Rota da tela de evacuação: sai de onde a pessoa está (GPS no `from`, senão a
// última posição real que o app mandou) e vai ao ponto de encontro da
// evacuação ativa da empresa dela. Sem evacuação ativa com ponto não há rota.
describe('Evacuation route e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    loner: 'evac-a@ex.com',
    admin: 'evac-route-admin@ex.com',
    worker: 'evac-route-w1@ex.com',
  }
  let workerId: string

  const cleanup = async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    })
    const userIds = users.map((u) => u.id)
    await prisma.workerPosition.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.evacuationAck.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.evacuation.deleteMany({ where: { startedById: { in: userIds } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const base = { passwordHash, emailVerified: true, approvalStatus: 'APPROVED' as const }
    const companyId = (await prisma.company.create({
      data: { name: 'Evac Route Co', cnpj: CNPJ, cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })).id
    // Sem empresa de propósito: é o caso "ninguém evacuando" do 404.
    await prisma.user.create({ data: { email: emails.loner, name: 'Evac A', role: 'WORKER', ...base } })
    await prisma.user.create({ data: { email: emails.admin, name: 'Evac Route Admin', role: 'ADMIN', companyId, ...base } })
    workerId = (await prisma.user.create({ data: { email: emails.worker, name: 'Evac Route W1', role: 'WORKER', companyId, ...base } })).id
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/evacuation/route').expect(401))

  it('sem evacuação ativa com ponto de encontro → 404 (sem traçado inventado)', async () => {
    const loner = await login(emails.loner)
    await request(app.getHttpServer()).get('/evacuation/route').set(loner).expect(404)
  })

  it('com evacuação ativa: rota da posição enviada até o ponto de encontro', async () => {
    const admin = await login(emails.admin)
    const worker = await login(emails.worker)
    const musterPoint: [number, number] = [-46.62, -23.544]
    const from: [number, number] = [-46.632, -23.552]

    await request(app.getHttpServer())
      .post('/evacuations')
      .set(admin)
      .send({ musterPoint })
      .expect(201)

    // `from` malformado → 400 antes de qualquer consulta.
    await request(app.getHttpServer()).get('/evacuation/route?from=x').set(worker).expect(400)

    // Sem `from` e sem posição real gravada → 409: o servidor não adivinha
    // onde a pessoa está.
    await request(app.getHttpServer()).get('/evacuation/route').set(worker).expect(409)

    // Com `from`: origem e destino são exatamente os pedidos. O traçado pode
    // ser o do roteador ou a linha reta aproximada, conforme a rede da CI.
    const { body } = await request(app.getHttpServer())
      .get(`/evacuation/route?from=${from[0]},${from[1]}`)
      .set(worker)
      .expect(200)
    expect(body.origin).toEqual(from)
    expect(body.destination).toEqual(musterPoint)
    expect(typeof body.approximate).toBe('boolean')
    expect(Array.isArray(body.waypoints)).toBe(true)
    expect(body.waypoints.length).toBeGreaterThan(0)
    expect(typeof body.waypoints[0][0]).toBe('number')
    expect(typeof body.durationSec).toBe('number')
    expect(typeof body.distanceM).toBe('number')
    expect(typeof body.fetchedAt).toBe('string')

    // Depois do heartbeat real do app, a rota sem `from` sai da posição gravada.
    await request(app.getHttpServer())
      .post('/positions/heartbeat')
      .set(worker)
      .send({ lat: from[1], lng: from[0] })
      .expect(204)
    const saved = await prisma.workerPosition.findFirst({ where: { workerId }, select: { source: true } })
    expect(saved?.source).toBe('real')
    const { body: noFrom } = await request(app.getHttpServer()).get('/evacuation/route').set(worker).expect(200)
    expect(noFrom.origin).toEqual(from)
    expect(noFrom.destination).toEqual(musterPoint)
  }, 30000)
})
