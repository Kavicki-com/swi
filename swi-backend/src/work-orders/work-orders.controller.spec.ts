import { WorkOrdersController } from './work-orders.controller'
import type { WorkOrdersService } from './work-orders.service'
import type { JwtUser } from '../auth/current-user.decorator'

// Ordem de serviço é rota ADMIN, e o que o controller garante é que o recorte
// por empresa venha do token em TODAS elas, inclusive na busca por id. Sem isso
// um admin acessaria a ordem de outra empresa só sabendo o uuid.

const service = () =>
  ({
    create: jest.fn().mockResolvedValue({ id: 'o1' }),
    list: jest.fn().mockResolvedValue([]),
    listAssignable: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 'o1' }),
    update: jest.fn().mockResolvedValue({ id: 'o1' }),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<WorkOrdersService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as unknown as JwtUser

describe('WorkOrdersController', () => {
  it('cria registrando o autor e a empresa do token', async () => {
    const s = service()
    await new WorkOrdersController(s).create(admin, { title: 'Ordem' } as never)
    expect(s.create).toHaveBeenCalledWith('admin-1', { title: 'Ordem' }, 'empresa-1')
  })

  it('lista repassa o filtro de status da query junto da empresa', async () => {
    const s = service()
    const c = new WorkOrdersController(s)

    await c.list({ status: 'in_progress' }, admin)
    await c.list({}, admin)

    expect(s.list).toHaveBeenNthCalledWith(1, 'in_progress', 'empresa-1')
    expect(s.list).toHaveBeenNthCalledWith(2, undefined, 'empresa-1')
  })

  it('atribuíveis, detalhe e edição ficam presos à empresa do token', async () => {
    const s = service()
    const c = new WorkOrdersController(s)

    await c.listAssignable(admin)
    await c.get('o1', admin)
    await c.update('o1', { title: 'Nova' }, admin)

    expect(s.listAssignable).toHaveBeenCalledWith('empresa-1')
    expect(s.get).toHaveBeenCalledWith('o1', 'empresa-1')
    expect(s.update).toHaveBeenCalledWith('o1', { title: 'Nova' }, 'empresa-1')
  })

  // Mesma régua das outras rotas: sem a empresa do token, um admin apagaria a
  // ordem de outra empresa sabendo só o uuid, e aqui o estrago é permanente.
  it('excluir também fica preso à empresa do token', async () => {
    const s = service()
    await new WorkOrdersController(s).remove('o1', admin)
    expect(s.remove).toHaveBeenCalledWith('o1', 'empresa-1')
  })
})
