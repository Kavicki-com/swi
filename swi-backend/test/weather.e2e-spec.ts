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

describe('Weather e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'weather-a@ex.com'
  const cleanup = async () => { await prisma.user.deleteMany({ where: { email } }) }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Weather A', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/weather').expect(401))

  it('com token → 200 + shape (dado real OU fallback canned)', async () => {
    const t = await login()
    const { body } = await request(app.getHttpServer()).get('/weather').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(typeof body.current.tempC).toBe('number')
    expect(typeof body.daily.maxC).toBe('number')
    expect(Array.isArray(body.alerts)).toBe(true)
    expect(typeof body.fetchedAt).toBe('string')
  })
})
