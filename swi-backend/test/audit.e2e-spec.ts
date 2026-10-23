import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'

// Trilha de auditoria de ponta a ponta, contra o banco real: a leitura do
// painel grava uma linha depois da resposta, a repetição em 5 minutos não grava
// outra, a tentativa recusada pelo RolesGuard também conta, o funcionário
// lendo os próprios dados não entra, e a consulta mostra só a empresa de quem
// pede. A gravação é assíncrona: cada caso espera `settled()` em vez de tempo.
//
// CNPJs EXCLUSIVOS deste teste: o cleanup apaga por CNPJ.
const CNPJ_A = '99000000002901'
const CNPJ_B = '99000000002902'

describe('Trilha de auditoria e2e', () => {
  let app: INestApplication, prisma: PrismaService, audit: AuditService
  const emails = {
    admin: 'audit-e2e-admin@ex.com',
    supervisor: 'audit-e2e-sup@ex.com',
    worker: 'audit-e2e-worker@ex.com',
    other: 'audit-e2e-other@ex.com',
    adminB: 'audit-e2e-admin-b@ex.com',
    workerB: 'audit-e2e-worker-b@ex.com',
  }
  const ids: Record<string, string> = {}
  const companies: Record<'a' | 'b', string> = { a: '', b: '' }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { subjectUserId: { in: userIds } }] } })
    await prisma.profile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  const company = (name: string, cnpj: string) =>
    prisma.company.create({
      data: { name, cnpj, cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    audit = app.get(AuditService)
    await cleanup()
    companies.a = (await company('Auditoria E2E A', CNPJ_A)).id
    companies.b = (await company('Auditoria E2E B', CNPJ_B)).id
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const base = (companyId: string) => ({ passwordHash, emailVerified: true, approvalStatus: 'APPROVED' as const, companyId })
    ids.admin = (await prisma.user.create({ data: { email: emails.admin, name: 'Admin', role: 'ADMIN', ...base(companies.a) } })).id
    ids.supervisor = (await prisma.user.create({ data: { email: emails.supervisor, name: 'Supervisora', role: 'SUPERVISOR', ...base(companies.a) } })).id
    ids.worker = (await prisma.user.create({ data: { email: emails.worker, name: 'Funcionária', role: 'WORKER', ...base(companies.a) } })).id
    ids.other = (await prisma.user.create({ data: { email: emails.other, name: 'Colega', role: 'WORKER', ...base(companies.a) } })).id
    ids.adminB = (await prisma.user.create({ data: { email: emails.adminB, name: 'Admin B', role: 'ADMIN', ...base(companies.b) } })).id
    ids.workerB = (await prisma.user.create({ data: { email: emails.workerB, name: 'Funcionário B', role: 'WORKER', ...base(companies.b) } })).id
  })
  afterAll(async () => { await audit.settled(); await cleanup(); await app.close() })

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  const rowsBy = async (actorId: string) => {
    await audit.settled()
    return prisma.auditEvent.findMany({ where: { actorId }, orderBy: { createdAt: 'asc' } })
  }

  it('a leitura do detalhe pelo painel grava uma linha, e a repetição em 5 minutos não grava outra', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    await request(server).get(`/users/${ids.worker}`).set(a).set('User-Agent', 'painel-e2e').expect(200)
    await request(server).get(`/users/${ids.worker}`).set(a).expect(200)

    const rows = await rowsBy(ids.admin)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.objectContaining({
      companyId: companies.a,
      actorRole: 'ADMIN',
      subjectUserId: ids.worker,
      action: 'USER_DETAIL_READ',
      method: 'GET',
      route: '/users/:id',
      status: 200,
      userAgent: 'painel-e2e',
    }))
    expect(typeof rows[0].ip).toBe('string')
  })

  it('a escrita grava toda vez, sem o corpo enviado', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    await request(server).patch(`/users/${ids.other}`).set(a).send({ name: 'Colega Renomeada' }).expect(200)
    await request(server).patch(`/users/${ids.other}`).set(a).send({ name: 'Colega' }).expect(200)

    const writes = (await rowsBy(ids.admin)).filter((r) => r.action === 'USER_UPDATED')
    expect(writes).toHaveLength(2)
    expect(writes.every((r) => r.subjectUserId === ids.other && r.route === '/users/:id')).toBe(true)
    expect(JSON.stringify(writes)).not.toContain('Renomeada')
  })

  it('o funcionário lendo os próprios dados não grava; tentando ler os de outro, grava a recusa', async () => {
    const server = app.getHttpServer()
    const w = await login(emails.worker)
    await request(server).get('/telemetry/v1/me/current').set(w)
    await request(server).get('/telemetry/v1/me/series').set(w)
    expect(await rowsBy(ids.worker)).toEqual([])

    await request(server).get(`/telemetry/v1/workers/${ids.other}/current`).set(w).expect(403)
    const rows = await rowsBy(ids.worker)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.objectContaining({
      actorRole: 'WORKER',
      subjectUserId: ids.other,
      action: 'HEALTH_CURRENT_READ',
      route: '/telemetry/v1/workers/:id/current',
      status: 403,
    }))
  })

  it('supervisor e administrador consultam a trilha da empresa; ler a trilha não gera linha', async () => {
    const server = app.getHttpServer()
    const s = await login(emails.supervisor)
    const a = await login(emails.admin)
    await request(server).get(`/telemetry/v1/workers/${ids.worker}/calibration`).set(s).expect(200)
    await audit.settled()
    const before = await prisma.auditEvent.count({ where: { companyId: companies.a } })

    const { body: bySup } = await request(server).get('/audit/events').set(s).expect(200)
    const { body: byAdmin } = await request(server).get(`/audit/events?subjectUserId=${ids.worker}`).set(a).expect(200)

    expect(bySup.items.map((i: { action: string }) => i.action)).toEqual(
      expect.arrayContaining(['CALIBRATION_READ', 'USER_DETAIL_READ', 'USER_UPDATED', 'HEALTH_CURRENT_READ']),
    )
    expect(bySup.items[0]).toEqual(expect.objectContaining({ actionLabel: expect.any(String), createdAt: expect.any(String) }))
    expect(byAdmin.items.every((i: { subjectUserId: string }) => i.subjectUserId === ids.worker)).toBe(true)
    expect(byAdmin.items.map((i: { actorId: string }) => i.actorId)).toEqual(expect.arrayContaining([ids.admin, ids.supervisor]))

    await audit.settled()
    expect(await prisma.auditEvent.count({ where: { companyId: companies.a } })).toBe(before)
  })

  it('filtra por ação e pagina por cursor', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const { body: writes } = await request(server).get('/audit/events?action=USER_UPDATED&limit=1').set(a).expect(200)
    expect(writes.items).toHaveLength(1)
    expect(writes.items[0].action).toBe('USER_UPDATED')
    expect(writes.nextCursor).toBe(writes.items[0].id)

    const { body: next } = await request(server)
      .get(`/audit/events?action=USER_UPDATED&limit=1&cursor=${writes.nextCursor as string}`).set(a).expect(200)
    expect(next.items).toHaveLength(1)
    expect(next.items[0].id).not.toBe(writes.items[0].id)
    expect(next.nextCursor).toBeNull()

    await request(server).get('/audit/events?action=NAO_EXISTE').set(a).expect(400)
    await request(server).get('/audit/events?limit=1000').set(a).expect(400)
  })

  it('o funcionário não consulta a trilha', async () => {
    const w = await login(emails.worker)
    await request(app.getHttpServer()).get('/audit/events').set(w).expect(403)
  })

  it('a trilha de outra empresa não aparece', async () => {
    const server = app.getHttpServer()
    const b = await login(emails.adminB)
    await request(server).get(`/users/${ids.workerB}`).set(b).expect(200)
    await audit.settled()

    const a = await login(emails.admin)
    const { body: fromA } = await request(server).get(`/audit/events?subjectUserId=${ids.workerB}`).set(a).expect(200)
    expect(fromA.items).toEqual([])
    const { body: allA } = await request(server).get('/audit/events?limit=100').set(a).expect(200)
    expect(allA.items.some((i: { actorId: string }) => i.actorId === ids.adminB)).toBe(false)

    const { body: fromB } = await request(server).get('/audit/events').set(b).expect(200)
    expect(fromB.items.map((i: { subjectUserId: string }) => i.subjectUserId)).toEqual([ids.workerB])
  })
})
