import { RescueController } from './rescue.controller'
import type { RescueService } from './rescue.service'
import type { JwtUser } from '../auth/current-user.decorator'

// A empresa vem sempre do token; o ferido vem do caminho e o socorrista do
// corpo. Nada no corpo aponta para outra empresa.

const service = () =>
  ({
    dispatch: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue([]),
    arrive: jest.fn().mockResolvedValue({}),
    end: jest.fn().mockResolvedValue({}),
  }) as unknown as jest.Mocked<RescueService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as JwtUser

describe('RescueController', () => {
  it('despachar passa a empresa do token, o ferido do caminho e o socorrista do corpo', async () => {
    const s = service()
    await new RescueController(s).dispatch('ferido-1', admin, { rescuerId: 'socorrista-1' })
    expect(s.dispatch).toHaveBeenCalledWith('empresa-1', 'ferido-1', 'socorrista-1', 'admin-1')
  })

  it('listar o histórico é da empresa do token', async () => {
    const s = service()
    await new RescueController(s).list(admin)
    expect(s.list).toHaveBeenCalledWith('empresa-1')
  })

  it('registrar chegada e encerrar são da empresa do token', async () => {
    const s = service()
    const c = new RescueController(s)
    await c.arrive('rescue-1', admin)
    await c.end('rescue-1', admin)
    expect(s.arrive).toHaveBeenCalledWith('empresa-1', 'rescue-1')
    expect(s.end).toHaveBeenCalledWith('empresa-1', 'rescue-1', 'admin-1')
  })
})
