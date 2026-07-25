import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Profile e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'profile-e2e@ex.com'
  // ValidationPipe (whitelist) vem do APP_PIPE global no AppModule — nada de useGlobalPipes aqui.

  const cleanup = async () => {
    await prisma.profile.deleteMany({ where: { user: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Profile E2E', passwordHash: await bcrypt.hash('test1234', 10),
        role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('perfil: 404 → upsert → merge (patch)', async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    const auth = { Authorization: `Bearer ${body.accessToken}` }
    await request(app.getHttpServer()).get('/profile/me').set(auth).expect(404)
    await request(app.getHttpServer()).put('/profile/me').set(auth).send({ city: 'São Paulo' }).expect(200)
    const g1 = await request(app.getHttpServer()).get('/profile/me').set(auth).expect(200)
    expect(g1.body.city).toBe('São Paulo')
    await request(app.getHttpServer()).put('/profile/me').set(auth).send({ uf: 'SP' }).expect(200)
    const g2 = await request(app.getHttpServer()).get('/profile/me').set(auth).expect(200)
    expect(g2.body.city).toBe('São Paulo')
    expect(g2.body.uf).toBe('SP')
  })

  it('perfil: whitelist descarta campo fora do DTO (anti mass-assignment)', async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    const auth = { Authorization: `Bearer ${body.accessToken}` }
    // `sector` virou campo legítimo do DTO no QA F (perfil completo) — o campo
    // perigoso de verdade é a FK: reapontar o Profile pra outro user.
    await request(app.getHttpServer()).put('/profile/me').set(auth).send({ userId: 'hijack-attempt', city: 'Campinas' }).expect(200)
    const g = await request(app.getHttpServer()).get('/profile/me').set(auth).expect(200)
    // O write legítimo do MESMO payload aplicou — ou seja, a FK foi descartada
    // pela whitelist, não o request inteiro.
    expect(g.body.city).toBe('Campinas')
  })

  it('perfil: birthDate inválido → 400 (não 500)', async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    const auth = { Authorization: `Bearer ${body.accessToken}` }
    await request(app.getHttpServer()).put('/profile/me').set(auth).send({ birthDate: '2000-13-45' }).expect(400)
  })

  it('perfil sem token → 401', () => request(app.getHttpServer()).get('/profile/me').expect(401))
})
