import type { JwtUser } from '../../auth/current-user.decorator'
import { ConditionHistoryController } from './condition-history.controller'
import type { ConditionHistoryService } from './condition-history.service'

// De onde vem a identidade e quem pode chamar; o roteamento e o escopo de
// empresa contra banco real estão no e2e.

const ADMIN: JwtUser = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

describe('ConditionHistoryController', () => {
  it('o histórico é da equipe do painel (Administrador e Supervisor)', () => {
    expect(Reflect.getMetadata('roles', ConditionHistoryController.prototype.list)).toEqual(['ADMIN', 'SUPERVISOR'])
  })

  it('lista com quem está no token, o funcionário da URL e o cursor da query', async () => {
    const history = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) }
    await new ConditionHistoryController(history as unknown as ConditionHistoryService).list(ADMIN, 'worker-1', {
      cursor: 'c-1',
    })
    expect(history.list).toHaveBeenCalledWith(ADMIN, 'worker-1', 'c-1')
  })
})
