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

// O nível Supervisor de ponta a ponta, contra o banco real: o valor novo do
// enum existe depois do migrate deploy, entra no token e a matriz vale nas
// rotas. A tabela completa rota a rota fica no route-access.spec; aqui vai uma
// amostra de cada lado da fronteira.
//
// CNPJ EXCLUSIVO deste teste: o cleanup apaga por CNPJ.
const CNPJ = '99000000002001'

describe('Supervisor e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    admin: 'supervisor-e2e-admin@ex.com',
    supervisor: 'supervisor-e2e-sup@ex.com',
    worker: 'supervisor-e2e-worker@ex.com',
    criado: 'supervisor-e2e-criado@ex.com',
  }
  const ids: Record<string, string> = {}

  // Perfil antes do usuário: o cadastro pelo POST /users cria Profile (FK).
  const cleanup = async () => {
    // A ordem anexada pelo supervisor notifica o funcionário responsável.
    await prisma.notification.deleteMany({ where: { worker: { email: { in: Object.values(emails) } } } })
    await prisma.workOrder.deleteMany({ where: { author: { email: { in: Object.values(emails) } } } })
    await prisma.profile.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const companyId = (await prisma.company.create({
      data: { name: 'Supervisor E2E', cnpj: CNPJ, cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const, companyId }
    ids.admin = (await prisma.user.create({ data: { email: emails.admin, name: 'Admin', role: 'ADMIN', ...base } })).id
    ids.supervisor = (await prisma.user.create({ data: { email: emails.supervisor, name: 'Supervisora', role: 'SUPERVISOR', ...base } })).id
    ids.worker = (await prisma.user.create({ data: { email: emails.worker, name: 'Funcionário', role: 'WORKER', ...base } })).id
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  it('/auth/me devolve o nível e as permissões do supervisor', async () => {
    const s = await login(emails.supervisor)
    const { body } = await request(app.getHttpServer()).get('/auth/me').set(s).expect(200)
    expect(body.role).toBe('SUPERVISOR')
    expect(body.permissions).toEqual(expect.arrayContaining(['monitoring.read', 'alerts.operate', 'workOrders.operate']))
    expect(body.permissions).not.toContain('users.manage')
  })

  it('o supervisor lê o diretório e opera, mas não gerencia usuários nem a empresa', async () => {
    const server = app.getHttpServer()
    const s = await login(emails.supervisor)

    const { body: equipe } = await request(server).get('/users?role=ADMIN,SUPERVISOR').set(s).expect(200)
    expect(equipe.map((u: { role: string }) => u.role).sort()).toEqual(['ADMIN', 'SUPERVISOR'])
    await request(server).get(`/users/${ids.worker}`).set(s).expect(200)
    await request(server).get('/telemetry/v1/admin/alerts').set(s).expect(200)
    await request(server).get('/work-orders').set(s).expect(200)

    await request(server).post('/users').set(s)
      .send({ name: 'Novo', email: emails.criado, password: 'Senha@2026', role: 'WORKER' }).expect(403)
    await request(server).patch(`/users/${ids.worker}`).set(s).send({ active: false }).expect(403)
    await request(server).delete(`/users/${ids.worker}`).set(s).expect(403)
    await request(server).put('/weather/location').set(s).send({ lat: -3.1, lng: -60.02 }).expect(403)
    await request(server).post('/cameras').set(s).send({ name: 'X', lat: -3.1, lng: -60.02 }).expect(403)
  })

  it('o administrador cadastra supervisor e troca o nível entre os dois do painel', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)

    const { body: criado } = await request(server).post('/users').set(a)
      .send({ name: 'Supervisor Novo', email: emails.criado, password: 'Senha@2026', role: 'SUPERVISOR' }).expect(201)
    expect(criado.role).toBe('SUPERVISOR')

    const { body: promovido } = await request(server).patch(`/users/${criado.id as string}`).set(a).send({ role: 'ADMIN' }).expect(200)
    expect(promovido.role).toBe('ADMIN')

    await request(server).patch(`/users/${ids.worker}`).set(a).send({ role: 'ADMIN' }).expect(400)
    await request(server).patch(`/users/${ids.admin}`).set(a).send({ role: 'SUPERVISOR' }).expect(400)
  })

  it('o supervisor anexa imagem em ordem de serviço; o funcionário segue barrado', async () => {
    // Operar ordens de serviço inclui anexar: o presign do prefixo order segue
    // a permissão workOrders.operate da matriz, não um papel fixo.
    const server = app.getHttpServer()
    const s = await login(emails.supervisor)
    const { body: presign } = await request(server).post('/media/presign').set(s)
      .send({ contentType: 'image/jpeg', contentLength: 1024, prefix: 'order' }).expect(201)
    expect(presign.key).toMatch(/^order\/[0-9a-f-]{36}\.jpg$/)
    expect(typeof presign.url).toBe('string')

    const { body: ordem } = await request(server).post('/work-orders').set(s)
      .send({ title: 'Ordem do supervisor', responsibleIds: [ids.worker], imageKeys: [presign.key] }).expect(201)
    expect(ordem.imageKeys).toEqual([presign.key])

    const w = await login(emails.worker)
    await request(server).post('/media/presign').set(w)
      .send({ contentType: 'image/jpeg', contentLength: 1024, prefix: 'order' }).expect(403)
  })

  it('o funcionário continua fora do painel', async () => {
    const w = await login(emails.worker)
    await request(app.getHttpServer()).get('/users').set(w).expect(403)
  })
})
