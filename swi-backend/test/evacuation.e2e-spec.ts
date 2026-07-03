// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init().
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Evacuation e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'evac-a@ex.com'
  const cleanup = async () => { await prisma.user.deleteMany({ where: { email } }) }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Evac A', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/evacuation/route').expect(401))

  it('com token → 200 + shape (rota real OU canned)', async () => {
    const t = await login()
    const { body } = await request(app.getHttpServer()).get('/evacuation/route').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(Array.isArray(body.waypoints)).toBe(true)
    expect(body.waypoints.length).toBeGreaterThan(0)
    expect(Array.isArray(body.waypoints[0])).toBe(true)
    expect(typeof body.waypoints[0][0]).toBe('number')
    expect(typeof body.durationSec).toBe('number')
    expect(typeof body.distanceM).toBe('number')
    expect(typeof body.fetchedAt).toBe('string')
  }, 15000)
})
