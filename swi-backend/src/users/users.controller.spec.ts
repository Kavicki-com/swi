import { UsersController } from './users.controller'
import type { UsersService } from './users.service'
import type { JwtUser } from '../auth/current-user.decorator'

// A decisão real destas rotas é de escopo: TODAS passam o companyId vindo do
// token, nunca um parâmetro de rota ou de query. Sem isso, um admin de uma
// empresa enxergaria e mexeria nos usuários de outra, e os testes de serviço não
// pegariam porque lá o companyId já chega pronto.

const service = () =>
  ({
    create: jest.fn().mockResolvedValue({ id: 'novo' }),
    list: jest.fn().mockResolvedValue([]),
    listPending: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue({ id: 'u1' }),
    approve: jest.fn().mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED', passwordHash: 'nao-vaza' }),
    reject: jest.fn().mockResolvedValue({ id: 'u1', approvalStatus: 'REJECTED', passwordHash: 'nao-vaza' }),
    update: jest.fn().mockResolvedValue({ id: 'u1' }),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<UsersService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as unknown as JwtUser

describe('UsersController', () => {
  it('cria herdando a identidade do admin logado', async () => {
    const s = service()
    await new UsersController(s).create('admin-1', { email: 'novo@ex.com', name: 'N' } as never)
    expect(s.create).toHaveBeenCalledWith('admin-1', { email: 'novo@ex.com', name: 'N' })
  })

  it('lista, lista pendentes e busca um sempre no escopo da empresa do token', async () => {
    const s = service()
    const c = new UsersController(s)

    await c.list(admin, 'WORKER', 'PENDING')
    await c.listPending(admin)
    await c.getOne('u1', admin)

    expect(s.list).toHaveBeenCalledWith('empresa-1', 'WORKER', 'PENDING')
    expect(s.listPending).toHaveBeenCalledWith('empresa-1')
    expect(s.getOne).toHaveBeenCalledWith('u1', 'empresa-1')
  })

  it('lista sem filtros passa undefined em vez de string vazia', async () => {
    const s = service()
    await new UsersController(s).list(admin)
    expect(s.list).toHaveBeenCalledWith('empresa-1', undefined, undefined)
  })

  it('aprovar e rejeitar devolvem só id e status, nunca o registro inteiro', async () => {
    const s = service()
    const c = new UsersController(s)

    await expect(c.approve('u1', admin)).resolves.toEqual({ id: 'u1', approvalStatus: 'APPROVED' })
    await expect(c.reject('u1', admin)).resolves.toEqual({ id: 'u1', approvalStatus: 'REJECTED' })
    expect(s.approve).toHaveBeenCalledWith('u1', 'empresa-1')
    expect(s.reject).toHaveBeenCalledWith('u1', 'empresa-1')
  })

  it('editar e excluir informam quem pediu, para o serviço barrar a ação sobre si mesmo', async () => {
    const s = service()
    const c = new UsersController(s)

    await c.update('u1', { active: false }, admin)
    await c.remove('u1', admin)

    expect(s.update).toHaveBeenCalledWith('u1', { active: false }, 'admin-1', 'empresa-1')
    expect(s.remove).toHaveBeenCalledWith('u1', 'admin-1', 'empresa-1')
  })

  // O PATCH deixou de ser só o toggle de ativação: o corpo inteiro tem que
  // chegar ao serviço, senão editar cadastro continuaria impossível pelo painel.
  it('o patch repassa o corpo inteiro, não apenas o active', async () => {
    const s = service()
    await new UsersController(s).update('u1', { name: 'Ana Maria', bloodType: 'O-' }, admin)
    expect(s.update).toHaveBeenCalledWith('u1', { name: 'Ana Maria', bloodType: 'O-' }, 'admin-1', 'empresa-1')
  })
})
