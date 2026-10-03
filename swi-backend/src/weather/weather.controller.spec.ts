import { WeatherController } from './weather.controller'
import type { WeatherService } from './weather.service'
import type { JwtUser } from '../auth/current-user.decorator'

// A empresa vem sempre do token: é ela que escolhe o local do clima e o local
// que o administrador configura. Nada no corpo aponta para outra empresa.

const service = () =>
  ({
    getSnapshot: jest.fn().mockResolvedValue({}),
    getLocation: jest.fn().mockResolvedValue({}),
    setLocation: jest.fn().mockResolvedValue({}),
    resetLocation: jest.fn().mockResolvedValue({}),
  }) as unknown as jest.Mocked<WeatherService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as JwtUser

describe('WeatherController', () => {
  it('o clima sai do local da empresa do token', async () => {
    const s = service()
    await new WeatherController(s).get(admin)
    expect(s.getSnapshot).toHaveBeenCalledWith('empresa-1')
  })

  it('ler, gravar e limpar o local são da empresa do token', async () => {
    const s = service()
    const c = new WeatherController(s)
    await c.location(admin)
    await c.setLocation(admin, { lat: -3.1, lng: -60.02 })
    await c.resetLocation(admin)
    expect(s.getLocation).toHaveBeenCalledWith('empresa-1')
    expect(s.setLocation).toHaveBeenCalledWith('empresa-1', { lat: -3.1, lng: -60.02 })
    expect(s.resetLocation).toHaveBeenCalledWith('empresa-1')
  })
})
