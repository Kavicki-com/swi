import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Reports e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'reports-e2e@ex.com'
  // ValidationPipe (whitelist) vem do APP_PIPE global no AppModule.

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }
  const cleanup = async () => {
    const reports = await prisma.report.findMany({ where: { author: { email } }, select: { id: true } })
    const rids = reports.map((r) => r.id)
    if (rids.length) await prisma.notification.deleteMany({ where: { targetId: { in: rids } } })
    await prisma.report.deleteMany({ where: { author: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({
      data: { email, name: 'Reports E2E', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
    })
  })
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('reports sem token → 401', () => request(app.getHttpServer()).get('/reports').expect(401))

  // O presign é PUT, não POST, porque o R2 não implementa presigned POST. Por
  // isso não existe `fields`, que era a policy do form POST: a resposta é
  // url mais key.
  // O contentLength passou a ser obrigatório porque entra na ASSINATURA, então
  // o upload só passa com exatamente aqueles bytes; omiti-lo dá 400 no
  // ValidationPipe, que era o 400 que este teste vinha recebendo.
  it('media presign devolve url + key namespaced', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'image/jpeg', contentLength: 1024 }).expect(201)
    expect(typeof body.url).toBe('string')
    expect(body.fields).toBeUndefined()
    expect(body.key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  it('presign rejeita content-type inválido → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'application/pdf', contentLength: 1024 }).expect(400)
  })

  it('create → list newest-first + get by id', async () => {
    const auth = await login()
    const { body: r1 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R1' }).expect(201)
    const { body: r2 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R2', responsibles: ['Ana'] }).expect(201)
    const { body: list } = await request(app.getHttpServer()).get('/reports').set(auth).expect(200)
    // Ordem relativa (robusto a outros dados no inbox org-wide): R2 antes de R1.
    const i1 = list.findIndex((r: any) => r.id === r1.id)
    const i2 = list.findIndex((r: any) => r.id === r2.id)
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThanOrEqual(0)
    expect(i2).toBeLessThan(i1) // mais recente primeiro
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r2.id}`).set(auth).expect(200)
    expect(one.title).toBe('R2')
    expect(one.responsibles).toEqual(['Ana'])
  })

  it('get inexistente → 404', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/reports/nao-existe').set(auth).expect(404)
  })

  it('whitelist descarta status/authorId (anti mass-assignment)', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'Hack', status: 'accept', authorId: 'outro' }).expect(201)
    expect(body.status).toBe('pending') // default do server, não o enviado
  })

  it('rejeita imageKey fora do padrão reports/<uuid> (400)', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'X', imageKeys: ['../secret.png'] }).expect(400)
  })
})
