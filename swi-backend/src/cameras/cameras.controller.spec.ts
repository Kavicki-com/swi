import { CamerasController } from './cameras.controller'
import type { CamerasService } from './cameras.service'
import type { JwtUser } from '../auth/current-user.decorator'

// A empresa e o cargo vêm sempre do token: nada no corpo aponta para outra
// empresa, e o cargo decide se o endereço da câmera vai na leitura.

const service = () =>
  ({
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<CamerasService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as JwtUser
const worker = { userId: 'worker-1', companyId: 'empresa-1', role: 'WORKER' } as JwtUser

describe('CamerasController', () => {
  it('a leitura passa a empresa e o cargo do token', async () => {
    const s = service()
    const c = new CamerasController(s)
    await c.list(admin)
    await c.list(worker)
    expect(s.list).toHaveBeenNthCalledWith(1, 'empresa-1', 'ADMIN')
    expect(s.list).toHaveBeenNthCalledWith(2, 'empresa-1', 'WORKER')
  })

  it('criar, alterar e excluir são da empresa do token', async () => {
    const s = service()
    const c = new CamerasController(s)
    const body = { name: 'Portaria', lat: -3.1, lng: -60.02 }
    await c.create(admin, body)
    await c.update('cam-1', admin, { name: 'Pátio' })
    await c.remove('cam-1', admin)
    expect(s.create).toHaveBeenCalledWith('empresa-1', body)
    expect(s.update).toHaveBeenCalledWith('cam-1', 'empresa-1', { name: 'Pátio' })
    expect(s.remove).toHaveBeenCalledWith('cam-1', 'empresa-1')
  })
})
