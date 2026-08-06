import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { MailService } from '../src/mail/mail.service'
import { PrismaService } from '../src/prisma/prisma.service'

// Matriz de segurança do backend.
//
// As outras suítes E2E provam que cada domínio funciona para quem tem
// permissão. Esta prova o complemento, que é o que costuma faltar: o que
// acontece com quem NÃO tem. Autenticação, autorização por papel, limite de
// requisição, política de upload e vazamento de detalhe interno no erro.
const ADMIN = 'admin-sec-e2e@ex.com'
const WORKER = 'worker-sec-e2e@ex.com'
const SENHA = 'senha123456'
const EMAILS = [ADMIN, WORKER]

describe('Segurança e2e', () => {
  let app: INestApplication, prisma: PrismaService
  let adminToken: string, workerToken: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendConfirmationCode: () => Promise.resolve(), sendResetCode: () => Promise.resolve() })
      .compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    prisma = app.get(PrismaService)

    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash(SENHA, 10)
    await prisma.user.create({
      data: { email: ADMIN, name: 'Admin Sec', passwordHash, role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' },
    })
    await prisma.user.create({
      data: { email: WORKER, name: 'Worker Sec', passwordHash, role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
    })

    const http = app.getHttpServer()
    adminToken = (await request(http).post('/auth/login').send({ email: ADMIN, password: SENHA }).expect(200)).body.accessToken
    workerToken = (await request(http).post('/auth/login').send({ email: WORKER, password: SENHA }).expect(200)).body.accessToken
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
    await app.close()
  })

  describe('autenticação', () => {
    it.each([
      ['sem token', undefined, 401],
      ['token inválido', 'Bearer invalido', 401],
      ['esquema errado', 'Basic YWRtaW46YWRtaW4=', 401],
      // Assinatura estruturalmente plausível, mas não emitida por este servidor.
      ['token de outro emissor', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinatura-invalida', 401],
    ])('protege rota administrativa: %s', async (_nome, auth, status) => {
      const req = request(app.getHttpServer()).get('/users')
      if (auth) req.set('Authorization', auth)
      await req.expect(status)
    })

    it('aceita o token legítimo na mesma rota, provando que o 401 é da credencial', async () => {
      await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${adminToken}`).expect(200)
    })
  })

  describe('autorização por papel', () => {
    it('nega operação ADMIN para WORKER', async () => {
      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${workerToken}`)
        .expect(403)
    })

    it('nega presign no prefixo de ordem de serviço para WORKER', async () => {
      // Autenticado não basta: o namespace 'order' é escrita administrativa.
      await request(app.getHttpServer())
        .post('/media/presign')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ contentType: 'image/png', contentLength: 1024, prefix: 'order' })
        .expect(403)
    })
  })

  describe('política de upload', () => {
    it('nega content-type fora da política do prefixo', async () => {
      // PDF é legítimo em exame e não em relatório: a política é por prefixo.
      await request(app.getHttpServer())
        .post('/media/presign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contentType: 'application/pdf', contentLength: 1024, prefix: 'reports' })
        .expect(400)
    })

    it('nega executável disfarçado mesmo em prefixo permissivo', async () => {
      await request(app.getHttpServer())
        .post('/media/presign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contentType: 'application/x-msdownload', contentLength: 1024, prefix: 'exams' })
        .expect(400)
    })

    it('nega tamanho fora do limite', async () => {
      await request(app.getHttpServer())
        .post('/media/presign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contentType: 'image/png', contentLength: 1024 * 1024 * 1024, prefix: 'reports' })
        .expect(400)
    })

    it('não repassa campo não declarado no corpo', async () => {
      // whitelist do ValidationPipe: campo extra não pode influenciar a
      // assinatura gerada nem aparecer de volta na resposta.
      const r = await request(app.getHttpServer())
        .post('/media/presign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contentType: 'image/png', contentLength: 1024, prefix: 'reports', bucket: 'outro-bucket' })
      if (r.status < 400) expect(JSON.stringify(r.body)).not.toContain('outro-bucket')
    })
  })

  describe('limite de requisição', () => {
    it('aplica rate limit ao login', async () => {
      // O throttler é desligado por NODE_ENV=test (app.module.ts). O skipIf é
      // avaliado a cada requisição, então trocar a env aqui liga o limite real
      // em vez de testar uma configuração paralela que ninguém usa.
      const original = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      try {
        const http = app.getHttpServer()
        let bloqueou = false
        for (let i = 0; i < 120 && !bloqueou; i++) {
          const r = await request(http).post('/auth/login').send({ email: 'ninguem@swi.local', password: 'errada' })
          if (r.status === 429) bloqueou = true
        }
        expect(bloqueou).toBe(true)
      } finally {
        process.env.NODE_ENV = original
      }
    })
  })

  describe('vazamento no erro', () => {
    it('não devolve stack, segredo ou SQL no corpo do erro', async () => {
      const r = await request(app.getHttpServer())
        .get('/users/id-que-nao-existe-e-nem-e-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(r.status).toBeGreaterThanOrEqual(400)
      const corpo = JSON.stringify(r.body)
      expect(corpo).not.toMatch(/at .+\.ts:\d+/) // stack trace
      expect(corpo).not.toMatch(/SELECT |INSERT |prisma\./i) // detalhe de persistência
      expect(corpo).not.toContain(process.env.JWT_SECRET ?? '@@sem-segredo@@')
      expect(corpo).not.toMatch(/postgresql:\/\//) // string de conexão
    })

    it('não confirma existência de conta pela resposta de recuperação de senha', async () => {
      const http = app.getHttpServer()
      const existente = await request(http).post('/auth/forgot-password').send({ email: ADMIN })
      const inexistente = await request(http).post('/auth/forgot-password').send({ email: 'nao-existe-sec@ex.com' })
      // Respostas divergentes transformam o endpoint em oráculo de e-mails.
      expect(existente.status).toBe(inexistente.status)
    })
  })
})
