// S3Client é construído na instanciação do MediaService (no app.init); presign
// é puro (não faz rede): POST via createPresignedPost, GET via getSignedUrl.
// Setar MINIO_* dummy ANTES de montar o app deixa a assinatura determinística
// e sem depender de MinIO up.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

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

  it('media presign devolve url + fields + key namespaced', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'image/jpeg' }).expect(201)
    expect(typeof body.url).toBe('string')
    expect(body.fields).toBeDefined()
    expect(body.key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  it('presign rejeita content-type inválido → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'application/pdf' }).expect(400)
  })

  it('create → list paginado (envelope items+total) + get by id', async () => {
    const auth = await login()
    const { body: r1 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R1' }).expect(201)
    const { body: r2 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R2', responsibles: ['Ana'] }).expect(201)
    const { body: page1 } = await request(app.getHttpServer()).get('/reports?page=1&limit=4').set(auth).expect(200)
    expect(Array.isArray(page1.items)).toBe(true)
    expect(typeof page1.total).toBe('number')
    const i1 = page1.items.findIndex((r: any) => r.id === r1.id)
    const i2 = page1.items.findIndex((r: any) => r.id === r2.id)
    expect(i2).toBeGreaterThanOrEqual(0)
    expect(i2).toBeLessThan(i1) // R2 (newer) before R1
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r2.id}`).set(auth).expect(200)
    expect(one.title).toBe('R2')
    expect(one.responsibles).toEqual(['Ana'])
  })

  it('paginação: page/limit fatiam, total conta tudo, página além do fim → vazia', async () => {
    const auth = await login()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const { body } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: `P${i}` }).expect(201)
      ids.push(body.id)
    }
    // Only this suite creates reports (org-wide inbox, but no other suite creates Report).
    // desc by createdAt → the 5 just-created (P4..P0) at the top, P4 newest.
    const { body: p1 } = await request(app.getHttpServer()).get('/reports?page=1&limit=4').set(auth).expect(200)
    expect(p1.items.length).toBe(4)
    expect(p1.total).toBeGreaterThanOrEqual(5)
    expect(p1.items.map((r: any) => r.title)).toEqual(['P4', 'P3', 'P2', 'P1'])
    const { body: p2 } = await request(app.getHttpServer()).get('/reports?page=2&limit=4').set(auth).expect(200)
    expect(p2.items[0].title).toBe('P0') // the 5th falls on page 2
    const { body: far } = await request(app.getHttpServer()).get('/reports?page=999&limit=4').set(auth).expect(200)
    expect(far.items).toEqual([])
    expect(far.total).toBe(p1.total)
  })

  it('query inválida (page=abc / limit=0 / page=-1) → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/reports?page=abc').set(auth).expect(400)
    await request(app.getHttpServer()).get('/reports?limit=0').set(auth).expect(400)
    await request(app.getHttpServer()).get('/reports?page=-1').set(auth).expect(400)
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
