import { ForbiddenException, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { JwtUser } from '../auth/current-user.decorator'
import type { PrismaService } from '../prisma/prisma.service'
import type { AuditMetadata } from './audit.decorator'
import { AUDIT_EVENTS_MAX_LIMIT, AuditService, READ_DEDUPE_WINDOW_MS, type AuditRequestFacts } from './audit.service'

// O que estes casos protegem é o que entra na linha (e o que nunca entra), a
// deduplicação das leituras, de onde sai a pessoa e que falha ao gravar não
// escapa. Prisma é dublê; o banco real e a rota inteira estão no e2e.

const ADMIN: JwtUser = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }
const NOW = new Date('2026-10-01T15:00:00.000Z')

const prismaDouble = () =>
  ({
    auditEvent: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    telemetrySession: { findFirst: jest.fn().mockResolvedValue(null) },
    operationalAlert: { findFirst: jest.fn().mockResolvedValue(null) },
    telemetryDevice: { findFirst: jest.fn().mockResolvedValue(null) },
    rescue: { findFirst: jest.fn().mockResolvedValue(null) },
  }) as any

const service = (prisma: any) => new AuditService(prisma as PrismaService)

const facts = (meta: AuditMetadata, over: Partial<AuditRequestFacts> = {}): AuditRequestFacts => ({
  meta,
  actor: ADMIN,
  params: { id: 'worker-1' },
  body: undefined,
  captured: {},
  method: 'GET',
  route: '/telemetry/v1/workers/:id/current',
  status: 200,
  ip: '203.0.113.7',
  userAgent: 'Painel',
  ...over,
})

const CURRENT: AuditMetadata = { action: 'HEALTH_CURRENT_READ', subject: { param: 'id' } }

const created = (prisma: any) => prisma.auditEvent.create.mock.calls[0][0].data

describe('AuditService.recordRequest', () => {
  it('grava quem agiu, sobre quem, a rota nomeada e o status, sem o corpo', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts(CURRENT, { body: { bloodType: 'O+' }, status: 404 }),
      NOW,
    )
    expect(created(prisma)).toEqual({
      createdAt: NOW,
      companyId: 'company-1',
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      subjectUserId: 'worker-1',
      action: 'HEALTH_CURRENT_READ',
      resourceType: null,
      resourceId: null,
      method: 'GET',
      route: '/telemetry/v1/workers/:id/current',
      status: 404,
      ip: '203.0.113.7',
      userAgent: 'Painel',
    })
    expect(JSON.stringify(created(prisma))).not.toContain('O+')
  })

  it('corta o User-Agent em 256 caracteres', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(facts(CURRENT, { userAgent: 'x'.repeat(1000) }), NOW)
    expect(created(prisma).userAgent).toHaveLength(256)
  })

  it('a mesma leitura do mesmo operador sobre a mesma pessoa em 5 minutos não grava outra linha', async () => {
    const prisma = prismaDouble()
    prisma.auditEvent.findFirst.mockResolvedValue({ id: 'ev-1' })
    await service(prisma).recordRequest(facts(CURRENT), NOW)
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
    expect(prisma.auditEvent.findFirst).toHaveBeenCalledWith({
      where: {
        actorId: 'admin-1',
        subjectUserId: 'worker-1',
        action: 'HEALTH_CURRENT_READ',
        createdAt: { gte: new Date(NOW.getTime() - READ_DEDUPE_WINDOW_MS) },
      },
      select: { id: true },
    })
  })

  it('escrita não é deduplicada', async () => {
    const prisma = prismaDouble()
    prisma.auditEvent.findFirst.mockResolvedValue({ id: 'ev-1' })
    await service(prisma).recordRequest(
      facts({ action: 'USER_UPDATED', subject: { param: 'id' } }, { method: 'PATCH', route: '/users/:id' }),
      NOW,
    )
    expect(prisma.auditEvent.findFirst).not.toHaveBeenCalled()
    expect(created(prisma).action).toBe('USER_UPDATED')
  })

  it('quem lê os próprios dados não entra na trilha', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(facts(CURRENT, { params: { id: 'admin-1' } }), NOW)
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('falha ao gravar vai para o log descrita sem o dado e não rejeita', async () => {
    const prisma = prismaDouble()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    prisma.auditEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Invalid `create` com subjectUserId worker-1', { code: 'P1017', clientVersion: 'x' }),
    )
    await expect(service(prisma).recordRequest(facts(CURRENT), NOW)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('P1017')
    expect(warn.mock.calls[0][0]).not.toContain('worker-1')
    warn.mockRestore()
  })

  it('settled espera as gravações em andamento', async () => {
    const prisma = prismaDouble()
    let release!: () => void
    prisma.auditEvent.create.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const audit = service(prisma)
    let done = false
    void audit.recordRequest(facts({ action: 'USER_DELETED', subject: { param: 'id' } }), NOW)
    const waiting = audit.settled().then(() => { done = true })
    await new Promise(setImmediate)
    expect(done).toBe(false)
    release()
    await waiting
    expect(done).toBe(true)
  })
})

describe('AuditService: de onde vem a pessoa', () => {
  it('do campo do corpo, só o id', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts({ action: 'PAUSE_REQUESTED', subject: { body: 'workerId' } }, { params: {}, body: { workerId: 'worker-9' } }),
      NOW,
    )
    expect(created(prisma).subjectUserId).toBe('worker-9')
  })

  it('corpo sem o campo deixa a pessoa nula, e id comprido é cortado', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts({ action: 'PAUSE_REQUESTED', subject: { body: 'workerId' } }, { params: {}, body: null }),
      NOW,
    )
    await service(prisma).recordRequest(
      facts({ action: 'USER_DELETED', subject: { param: 'id' } }, { params: { id: 'a'.repeat(500) } }),
      NOW,
    )
    expect(prisma.auditEvent.create.mock.calls[0][0].data.subjectUserId).toBeNull()
    expect(prisma.auditEvent.create.mock.calls[1][0].data.subjectUserId).toHaveLength(128)
  })

  it('da resposta, quando a rota cria a pessoa, com o recurso também da resposta', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts(
        { action: 'RESCUE_STARTED', subject: { param: 'injuredId' }, resource: { type: 'rescue', response: 'id' } },
        { params: { injuredId: 'worker-2' }, captured: { id: 'rescue-7' } },
      ),
      NOW,
    )
    await service(prisma).recordRequest(
      facts({ action: 'USER_CREATED', subject: { response: 'id' } }, { params: {}, captured: { id: 'user-new' } }),
      NOW,
    )
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ subjectUserId: 'worker-2', resourceType: 'rescue', resourceId: 'rescue-7' }),
    )
    expect(prisma.auditEvent.create.mock.calls[1][0].data.subjectUserId).toBe('user-new')
  })

  it('recurso do caminho ao lado da pessoa (exame, faixa)', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts(
        { action: 'EXAM_REMOVED', subject: { param: 'id' }, resource: { type: 'exam', param: 'examId' } },
        { params: { id: 'worker-1', examId: 'exam-3' }, method: 'DELETE' },
      ),
      NOW,
    )
    expect(created(prisma)).toEqual(expect.objectContaining({ subjectUserId: 'worker-1', resourceType: 'exam', resourceId: 'exam-3' }))
  })

  it.each([
    ['session', 'telemetrySession', { workerId: 'worker-5' }],
    ['alert', 'operationalAlert', { workerId: 'worker-5' }],
    ['device', 'telemetryDevice', { workerId: 'worker-5' }],
  ] as const)('resolve o dono de %s com um select dentro da empresa de quem pede', async (kind, model, row) => {
    const prisma = prismaDouble()
    prisma[model].findFirst.mockResolvedValue(row)
    await service(prisma).recordRequest(
      facts({ action: 'ALERT_ACKNOWLEDGED', subject: { resource: kind, param: 'id' } }, { params: { id: 'r-1' }, method: 'POST' }),
      NOW,
    )
    expect(prisma[model].findFirst).toHaveBeenCalledWith({
      where: { id: 'r-1', worker: { companyId: 'company-1' } },
      select: { workerId: true },
    })
    expect(created(prisma)).toEqual(expect.objectContaining({ subjectUserId: 'worker-5', resourceType: kind, resourceId: 'r-1' }))
  })

  it('resolve o ferido do resgate pela empresa do resgate', async () => {
    const prisma = prismaDouble()
    prisma.rescue.findFirst.mockResolvedValue({ injuredId: 'worker-8' })
    await service(prisma).recordRequest(
      facts({ action: 'RESCUE_ENDED', subject: { resource: 'rescue', param: 'id' } }, { params: { id: 'res-1' }, method: 'POST' }),
      NOW,
    )
    expect(prisma.rescue.findFirst).toHaveBeenCalledWith({ where: { id: 'res-1', companyId: 'company-1' }, select: { injuredId: true } })
    expect(created(prisma).subjectUserId).toBe('worker-8')
  })

  it('recurso de outra empresa ou inexistente grava a tentativa sem dono', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts({ action: 'DEVICE_REVOKED', subject: { resource: 'device', param: 'id' } }, { params: { id: 'dev-x' }, status: 404 }),
      NOW,
    )
    expect(created(prisma)).toEqual(expect.objectContaining({ subjectUserId: null, resourceId: 'dev-x', status: 404 }))
  })

  it('sem o parâmetro do recurso, nem procura o dono', async () => {
    const prisma = prismaDouble()
    await service(prisma).recordRequest(
      facts({ action: 'SESSION_HISTORY_READ', subject: { resource: 'session', param: 'id' } }, { params: {} }),
      NOW,
    )
    expect(prisma.telemetrySession.findFirst).not.toHaveBeenCalled()
    expect(created(prisma).subjectUserId).toBeNull()
  })

  it('o dono da sessão lendo a própria sessão não grava', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findFirst.mockResolvedValue({ workerId: 'worker-1' })
    const worker: JwtUser = { userId: 'worker-1', role: 'WORKER', companyId: 'company-1' }
    await service(prisma).recordRequest(
      facts({ action: 'SESSION_HISTORY_READ', subject: { resource: 'session', param: 'id' } }, { actor: worker, params: { id: 's-1' } }),
      NOW,
    )
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })
})

describe('AuditService.list', () => {
  const row = (id: string) => ({
    id,
    createdAt: NOW,
    companyId: 'company-1',
    actorId: 'admin-1',
    actorRole: 'ADMIN',
    subjectUserId: 'worker-1',
    action: 'HEALTH_CURRENT_READ',
    resourceType: null,
    resourceId: null,
    method: 'GET',
    route: '/telemetry/v1/workers/:id/current',
    status: 200,
    ip: null,
    userAgent: null,
  })

  it('recorta pela empresa do token, aplica os filtros e devolve o rótulo da ação', async () => {
    const prisma = prismaDouble()
    prisma.auditEvent.findMany.mockResolvedValue([row('ev-1')])
    const page = await service(prisma).list(ADMIN, {
      subjectUserId: 'worker-1',
      actorId: 'admin-1',
      action: 'HEALTH_CURRENT_READ',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
    })
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        subjectUserId: 'worker-1',
        actorId: 'admin-1',
        action: 'HEALTH_CURRENT_READ',
        createdAt: { gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-02T00:00:00.000Z') },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
    expect(page).toEqual({
      items: [expect.objectContaining({ id: 'ev-1', createdAt: NOW.toISOString(), actionLabel: 'Leu o estado atual de saúde' })],
      nextCursor: null,
    })
  })

  it('pagina por cursor com um a mais, e o limite tem teto', async () => {
    const prisma = prismaDouble()
    prisma.auditEvent.findMany.mockResolvedValue([row('ev-1'), row('ev-2'), row('ev-3')])
    const page = await service(prisma).list(ADMIN, { limit: 2, cursor: 'ev-0', to: '2026-10-02T00:00:00.000Z' })
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, cursor: { id: 'ev-0' }, skip: 1 }),
    )
    expect(page.items.map((i) => i.id)).toEqual(['ev-1', 'ev-2'])
    expect(page.nextCursor).toBe('ev-2')

    await service(prisma).list(ADMIN, { limit: 1000 })
    expect(prisma.auditEvent.findMany.mock.calls[1][0].take).toBe(AUDIT_EVENTS_MAX_LIMIT + 1)
  })

  it('quem não tem empresa não tem trilha', async () => {
    await expect(service(prismaDouble()).list({ ...ADMIN, companyId: null }, {})).rejects.toBeInstanceOf(ForbiddenException)
  })
})
