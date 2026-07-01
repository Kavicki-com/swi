import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { MailService } from '../src/mail/mail.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Auth e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const codes: Record<string, string> = {}

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService).useValue({
        sendConfirmationCode: (to: string, c: string) => { codes[to] = c; return Promise.resolve() },
        sendResetCode: () => Promise.resolve(),
      }).compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    prisma = app.get(PrismaService)
    await prisma.user.deleteMany({ where: { email: { in: ['e2e@ex.com','admin-e2e@ex.com'] } } })
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email: 'admin-e2e@ex.com', name: 'A', passwordHash: await bcrypt.hash('admin123', 10),
        role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await prisma.user.deleteMany({ where: { email: { in: ['e2e@ex.com','admin-e2e@ex.com'] } } }); await app.close() })

  it('fluxo completo até /me', async () => {
    const http = app.getHttpServer()
    await request(http).post('/auth/signup').send({ email: 'e2e@ex.com', password: 'senha123', name: 'E2E' }).expect(201)
    await request(http).post('/auth/confirm').send({ email: 'e2e@ex.com', code: codes['e2e@ex.com'] }).expect(200)
    await request(http).post('/auth/login').send({ email: 'e2e@ex.com', password: 'senha123' }).expect(403)  // não aprovado

    const admin = await request(http).post('/auth/login').send({ email: 'admin-e2e@ex.com', password: 'admin123' }).expect(200)
    const created = await prisma.user.findUnique({ where: { email: 'e2e@ex.com' } })
    await request(http).post(`/users/${created!.id}/approve`).set('Authorization', `Bearer ${admin.body.accessToken}`).expect(200)

    const login = await request(http).post('/auth/login').send({ email: 'e2e@ex.com', password: 'senha123' }).expect(200)
    expect(login.body.accessToken).toBeDefined()
    const me = await request(http).get('/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200)
    expect(me.body.email).toBe('e2e@ex.com')
  })
})
