import type { JwtUser } from '../../auth/current-user.decorator'
import { AlertQueueController } from './alert-queue.controller'
import type { AlertQueueService } from './alert-queue.service'

// O que estes casos protegem é de onde vem a identidade e quem pode chamar:
// o roteamento e o escopo de empresa contra banco real estão no e2e.

const ADMIN: JwtUser = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

const serviceDouble = () =>
  ({
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    acknowledge: jest.fn().mockResolvedValue({ id: 'a1' }),
    resolve: jest.fn().mockResolvedValue({ id: 'a1' }),
  }) as unknown as jest.Mocked<AlertQueueService>

describe('AlertQueueController', () => {
  it('a fila inteira é só de administrador', () => {
    expect(Reflect.getMetadata('roles', AlertQueueController)).toEqual(['ADMIN'])
  })

  it('lista com o administrador do token e os filtros da query', async () => {
    const alerts = serviceDouble()
    await new AlertQueueController(alerts).list(ADMIN, { status: ['RESOLVED'], limit: 10 })
    expect(alerts.list).toHaveBeenCalledWith(ADMIN, { status: ['RESOLVED'], limit: 10 })
  })

  it('reconhece em nome do administrador do token', async () => {
    const alerts = serviceDouble()
    await new AlertQueueController(alerts).acknowledge(ADMIN, 'a1')
    expect(alerts.acknowledge).toHaveBeenCalledWith(ADMIN, 'a1')
  })

  it('resolve repassando a nota do corpo', async () => {
    const alerts = serviceDouble()
    await new AlertQueueController(alerts).resolve(ADMIN, 'a1', { note: 'Pausa feita' })
    expect(alerts.resolve).toHaveBeenCalledWith(ADMIN, 'a1', 'Pausa feita')
  })
})
