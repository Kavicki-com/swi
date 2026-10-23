import type { JwtUser } from '../auth/current-user.decorator'
import { AUDIT_ACTIONS, auditActionLabel, isReadAction } from './audit-actions'
import { AuditController } from './audit.controller'
import type { AuditService } from './audit.service'

// O que estes casos protegem é de onde vem quem pede e quem pode pedir; o
// recorte por empresa contra banco real está no e2e.

const SUPERVISOR: JwtUser = { userId: 'sup-1', role: 'SUPERVISOR', companyId: 'company-1' }

describe('AuditController', () => {
  it('a trilha é da equipe do painel (Administrador e Supervisor)', () => {
    expect(Reflect.getMetadata('roles', AuditController.prototype.list)).toEqual(['ADMIN', 'SUPERVISOR'])
  })

  it('consulta em nome de quem está no token, com os filtros da query', async () => {
    const audit = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) }
    await new AuditController(audit as unknown as AuditService).list(SUPERVISOR, { subjectUserId: 'worker-1', limit: 10 })
    expect(audit.list).toHaveBeenCalledWith(SUPERVISOR, { subjectUserId: 'worker-1', limit: 10 })
  })
})

describe('ações da trilha', () => {
  it('toda ação tem rótulo em português', () => {
    for (const entry of Object.values(AUDIT_ACTIONS)) expect(entry.label.length).toBeGreaterThan(0)
  })

  it('leitura e escrita se distinguem, e o rótulo sai da tabela', () => {
    expect(isReadAction('USER_DETAIL_READ')).toBe(true)
    expect(isReadAction('USER_DELETED')).toBe(false)
    expect(auditActionLabel('ALERT_RESOLVED')).toBe('Resolveu um alerta')
  })
})
