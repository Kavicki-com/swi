import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { MailService } from '../src/mail/mail.service'

// Cadastro pelo painel manda as credenciais por e-mail, de ponta a ponta: a
// resposta carrega credentialsEmailSent, o e-mail sai com login e senha e, para
// quem entra pelo painel, com a URL dele, e a senha enviada é a que entra. O
// transporte é substituído por um espião: o contrato provado é o do serviço de
// e-mail, não o SMTP.
//
// CNPJ EXCLUSIVO deste teste: o cleanup apaga por CNPJ.
const CNPJ = '99000000002002'

type Envio = { to: string; info: Record<string, unknown> }

describe('Credenciais por e-mail no cadastro pelo painel (e2e)', () => {
  let app: INestApplication, prisma: PrismaService
  const enviados: Envio[] = []
  let smtpFora = false
  const mail = {
    sendPanelCredentials: jest.fn(async (to: string, info: Record<string, unknown>) => {
      if (smtpFora) throw new Error('smtp fora do ar')
      enviados.push({ to, info })
    }),
    sendConfirmationCode: jest.fn(async () => undefined),
    sendResetCode: jest.fn(async () => undefined),
    sendAdminPasswordLink: jest.fn(async () => undefined),
    sendMessageReport: jest.fn(async () => undefined),
  }
  const emails = {
    admin: 'credenciais-e2e-admin@ex.com',
    worker: 'credenciais-e2e-worker@ex.com',
    supervisor: 'credenciais-e2e-sup@ex.com',
    semEmail: 'credenciais-e2e-sem-email@ex.com',
  }

  // Perfil antes do usuário: o cadastro pelo POST /users cria Profile (FK).
  const cleanup = async () => {
    await prisma.profile.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService).useValue(mail)
      .compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const companyId = (await prisma.company.create({
      data: { name: 'Credenciais E2E', cnpj: CNPJ, cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })).id
    const bcrypt = await import('bcrypt')
    await prisma.user.create({
      data: { email: emails.admin, name: 'Admin', role: 'ADMIN', passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED', companyId },
    })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  // Devolve a cadeia do supertest em vez de uma Promise comum, para o `.expect`
  // continuar disponível em quem chama.
  const login = (who: string, password = 'test1234') =>
    request(app.getHttpServer()).post('/auth/login').send({ email: who, password })

  const comoAdmin = async () => {
    const { body } = await login(emails.admin).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  it('funcionário: e-mail com login e senha, sem URL do painel, e a senha enviada é a que entra', async () => {
    const a = await comoAdmin()
    const { body } = await request(app.getHttpServer()).post('/users').set(a)
      .send({ name: 'Funcionária Nova', email: emails.worker, password: 'Senha@2026', role: 'WORKER' }).expect(201)
    expect(body.credentialsEmailSent).toBe(true)

    const envio = enviados.find((e) => e.to === emails.worker)
    expect(envio?.info).toEqual({ name: 'Funcionária Nova', email: emails.worker, password: 'Senha@2026' })

    await login(emails.worker, 'Senha@2026').expect(200)
  })

  it('supervisor: o e-mail traz a URL do painel lida de ADMIN_APP_URL', async () => {
    const antes = process.env.ADMIN_APP_URL
    process.env.ADMIN_APP_URL = 'https://painel.e2e'
    try {
      const a = await comoAdmin()
      const { body } = await request(app.getHttpServer()).post('/users').set(a)
        .send({ name: 'Supervisora Nova', email: emails.supervisor, password: 'Senha@2026', role: 'SUPERVISOR' }).expect(201)
      expect(body.credentialsEmailSent).toBe(true)
      expect(enviados.find((e) => e.to === emails.supervisor)?.info).toMatchObject({ panelUrl: 'https://painel.e2e' })
    } finally {
      if (antes === undefined) delete process.env.ADMIN_APP_URL
      else process.env.ADMIN_APP_URL = antes
    }
  })

  it('SMTP fora do ar: o cadastro é concluído mesmo assim, a resposta avisa e a pessoa consegue entrar', async () => {
    smtpFora = true
    try {
      const a = await comoAdmin()
      const { body } = await request(app.getHttpServer()).post('/users').set(a)
        .send({ name: 'Sem E-mail', email: emails.semEmail, password: 'Senha@2026', role: 'WORKER' }).expect(201)
      expect(body.credentialsEmailSent).toBe(false)
      await login(emails.semEmail, 'Senha@2026').expect(200)
    } finally {
      smtpFora = false
    }
  })
})
