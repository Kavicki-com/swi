import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { MailService } from '../src/mail/mail.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Auth e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const codes: Record<string, string> = {}

  const EMAILS = ['e2e@ex.com', 'admin-e2e@ex.com', 'reject-e2e@ex.com', 'resend-e2e@ex.com']

  // Profile ANTES de User: a relação não declara onDelete Cascade
  // (schema.prisma, model Profile), então apagar o usuário direto viola
  // Profile_userId_fkey. O signup cria o profile, então a suíte sempre deixava
  // um pra trás: o afterAll estourava e o resíduo derrubava o beforeAll da
  // execução seguinte, no mesmo ponto. Rodar duas vezes seguidas era o
  // suficiente pra ver, e é isso que esta ordem conserta.
  const limpar = async () => {
    await prisma.profile.deleteMany({ where: { user: { email: { in: EMAILS } } } })
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
  }

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
    await limpar()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email: 'admin-e2e@ex.com', name: 'A', passwordHash: await bcrypt.hash('admin123', 10),
        role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await limpar(); await app.close() })

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

  // Orçamento explícito porque a duração deste teste é dominada por trabalho
  // criptográfico DELIBERADO, não por lentidão: o login roda um bcrypt compare
  // mesmo com e-mail inexistente (DUMMY_HASH, anti-enumeração em
  // auth.service.ts), e a custo 10 cada compare leva ~110ms. Doze pedidos
  // sequenciais têm piso de ~4s, contra o padrão de 5s do jest. Medido: 3800ms
  // numa máquina ociosa, ou seja, 1,2s de margem, que evapora sob a carga de
  // uma suíte inteira ou de um runner de CI compartilhado.
  //
  // Baixar o custo do bcrypt no ambiente de teste resolveria o relógio e
  // estragaria o teste: ele deixaria de exercitar o mesmo trabalho que a
  // produção faz.
  const ORCAMENTO_DOZE_LOGINS_MS = 30_000

  it('throttle desligado em test-env: 12× /auth/login errado → sempre 401, nunca 429', async () => {
    const http = app.getHttpServer()
    // /auth/login tem @Throttle 10/min: sem o skipIf de test-env, os pedidos #11 e #12 seriam 429.
    // Credencial inexistente → 401 por design (sem usuário semeado), então 401 em TODAS prova o bypass.
    for (let i = 0; i < 12; i++) {
      const r = await request(http).post('/auth/login').send({ email: 'nobody@swi.local', password: 'wrong' })
      expect(r.status).toBe(401)
    }
  }, ORCAMENTO_DOZE_LOGINS_MS)

  it('admin lista pendentes e rejeita', async () => {
    const http = app.getHttpServer()
    const admin = await request(http).post('/auth/login').send({ email: 'admin-e2e@ex.com', password: 'admin123' }).expect(200)
    const token = admin.body.accessToken

    await request(http).post('/auth/signup').send({ email: 'reject-e2e@ex.com', password: 'senha123', name: 'RejectMe' }).expect(201)

    const pending = await request(http).get('/users/pending').set('Authorization', `Bearer ${token}`).expect(200)
    const target = pending.body.find((u: any) => u.email === 'reject-e2e@ex.com')
    expect(target).toBeTruthy()

    const r = await request(http).post(`/users/${target.id}/reject`).set('Authorization', `Bearer ${token}`).expect(200)
    expect(r.body.approvalStatus).toBe('REJECTED')
  })

  it('reenvia o código de confirmação; o novo código confirma a conta', async () => {
    const http = app.getHttpServer()
    await request(http).post('/auth/signup').send({ email: 'resend-e2e@ex.com', password: 'senha123', name: 'Resend' }).expect(201)
    await request(http).post('/auth/confirm/resend').send({ email: 'resend-e2e@ex.com' }).expect(200)
    const resent = codes['resend-e2e@ex.com']
    expect(resent).toBeDefined()
    await request(http).post('/auth/confirm').send({ email: 'resend-e2e@ex.com', code: resent }).expect(200)
    const u = await prisma.user.findUnique({ where: { email: 'resend-e2e@ex.com' } })
    expect(u!.emailVerified).toBe(true)
  })

  it('resend com e-mail inexistente é silencioso (200, anti-enumeração)', async () => {
    const http = app.getHttpServer()
    await request(http).post('/auth/confirm/resend').send({ email: 'ghost-resend@ex.com' }).expect(200)
  })
})
