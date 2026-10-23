import { EventEmitter } from 'node:events'
import { Controller, Get, Logger, Post, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { lastValueFrom, of } from 'rxjs'
import { Audit } from './audit.decorator'
import { AuditGuard } from './audit.guard'
import { AuditInterceptor } from './audit.interceptor'
import { AUDIT_CAPTURE } from './audit-request'
import type { AuditService } from './audit.service'

// O que estes casos protegem é a fiação da trilha na requisição: o guard nunca
// barra, só grava quando a resposta termina, com o status final e a rota
// nomeada; sem token não grava; erro no caminho não escapa do listener. O
// interceptor só copia os ids pedidos da resposta.

@Controller('telemetry/v1')
class FakeController {
  @Audit('HEALTH_CURRENT_READ', { subject: { param: 'id' } })
  @Get('workers/:id/current')
  current() { return null }

  @Audit('USER_CREATED', { subject: { response: 'id' }, resource: { type: 'exam', response: 'examId' } })
  @Post()
  create() { return null }

  @Get('livre')
  free() { return null }
}

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

class FakeResponse extends EventEmitter {
  statusCode = 200
}

function setup(handler: keyof FakeController, req: Record<string | symbol, unknown> = {}, type = 'http') {
  const res = new FakeResponse()
  const request: Record<string | symbol, unknown> = {
    method: 'GET',
    headers: { 'user-agent': 'Painel' },
    params: { id: 'worker-1' },
    ip: '203.0.113.7',
    ...req,
  }
  const context = {
    getType: () => type,
    getHandler: () => FakeController.prototype[handler],
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
  } as unknown as ExecutionContext
  const audit = { recordRequest: jest.fn().mockResolvedValue(undefined) }
  const guard = new AuditGuard(new Reflector(), audit as unknown as AuditService)
  return { res, request, context, audit, guard }
}

describe('AuditGuard', () => {
  it('passa sempre e grava só quando a resposta termina, com o status final', () => {
    const { guard, context, res, request, audit } = setup('current')
    expect(guard.canActivate(context)).toBe(true)
    expect(audit.recordRequest).not.toHaveBeenCalled()

    // O JwtAuthGuard do controller preenche o usuário depois deste guard.
    request.user = ADMIN
    res.statusCode = 403
    res.emit('finish')

    expect(audit.recordRequest).toHaveBeenCalledWith({
      meta: { action: 'HEALTH_CURRENT_READ', subject: { param: 'id' } },
      actor: ADMIN,
      params: { id: 'worker-1' },
      body: undefined,
      captured: {},
      method: 'GET',
      route: '/telemetry/v1/workers/:id/current',
      status: 403,
      ip: '203.0.113.7',
      userAgent: 'Painel',
    })
  })

  it('sem token válido não há a quem atribuir, e nada é gravado', () => {
    const { guard, context, res, audit } = setup('current')
    guard.canActivate(context)
    res.emit('finish')
    expect(audit.recordRequest).not.toHaveBeenCalled()
  })

  it('rota sem @Audit e contexto que não é HTTP nem armam a gravação', () => {
    const free = setup('free', { user: ADMIN })
    expect(free.guard.canActivate(free.context)).toBe(true)
    free.res.emit('finish')
    expect(free.audit.recordRequest).not.toHaveBeenCalled()

    const ws = setup('current', { user: ADMIN }, 'ws')
    expect(ws.guard.canActivate(ws.context)).toBe(true)
    expect(ws.res.listenerCount('finish')).toBe(0)
  })

  it('sem parâmetros, sem IP e sem User-Agent grava nulos', () => {
    const { guard, context, res, request, audit } = setup('current', { params: undefined, ip: undefined, headers: {} })
    guard.canActivate(context)
    request.user = ADMIN
    res.emit('finish')
    expect(audit.recordRequest).toHaveBeenCalledWith(expect.objectContaining({ params: {}, ip: null, userAgent: null }))
  })

  it('erro ao montar a linha fica no log e não escapa do listener', () => {
    const { guard, context, res, request, audit } = setup('current')
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    audit.recordRequest.mockImplementation(() => { throw new Error('quebrou') })
    guard.canActivate(context)
    request.user = ADMIN
    expect(() => res.emit('finish')).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quebrou'))
    warn.mockRestore()
  })

  it('grava os ids que o interceptor copiou da resposta', async () => {
    const { guard, context, res, request, audit } = setup('create', { method: 'POST', params: {} })
    guard.canActivate(context)
    const interceptor = new AuditInterceptor(new Reflector())
    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({ id: 'user-new', examId: 'exam-1', name: 'Ana' }) }),
    )
    request.user = ADMIN
    res.statusCode = 201
    res.emit('finish')
    expect(audit.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ captured: { id: 'user-new', examId: 'exam-1' }, route: '/telemetry/v1', status: 201 }),
    )
  })
})

describe('AuditInterceptor', () => {
  it('rota sem id da resposta a guardar passa direto', async () => {
    const { context, request } = setup('current')
    const value = await lastValueFrom(new AuditInterceptor(new Reflector()).intercept(context, { handle: () => of('x') }))
    expect(value).toBe('x')
    expect(request[AUDIT_CAPTURE]).toBeUndefined()
  })

  it('resposta que não é objeto, ou id que não é texto, não guarda nada', async () => {
    const { guard, context, request } = setup('create')
    guard.canActivate(context)
    const interceptor = new AuditInterceptor(new Reflector())
    await lastValueFrom(interceptor.intercept(context, { handle: () => of(null) }))
    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ id: 42 }) }))
    expect(request[AUDIT_CAPTURE]).toEqual({})
  })

  it('sem o guard ter armado a gravação, não guarda nada', async () => {
    const { context, request } = setup('create')
    const value = await lastValueFrom(new AuditInterceptor(new Reflector()).intercept(context, { handle: () => of({ id: 'u' }) }))
    expect(value).toEqual({ id: 'u' })
    expect(request[AUDIT_CAPTURE]).toBeUndefined()
  })
})
