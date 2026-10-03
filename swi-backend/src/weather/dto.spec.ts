import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { WeatherLocationDto } from './dto'

describe('WeatherLocationDto', () => {
  const check = (body: Record<string, unknown>) =>
    validate(plainToInstance(WeatherLocationDto, body), { whitelist: true })

  it('aceita coordenadas válidas, inclusive nos limites', async () => {
    expect(await check({ lat: -3.1, lng: -60.02 })).toHaveLength(0)
    expect(await check({ lat: 90, lng: -180 })).toHaveLength(0)
  })

  it('rejeita fora dos limites geográficos', async () => {
    expect((await check({ lat: 90.1, lng: 0 })).length).toBeGreaterThan(0)
    expect((await check({ lat: 0, lng: 180.1 })).length).toBeGreaterThan(0)
  })

  it('rejeita texto, número não finito e campo ausente', async () => {
    expect((await check({ lat: '-3.1', lng: 0 })).length).toBeGreaterThan(0)
    expect((await check({ lat: Number.NaN, lng: 0 })).length).toBeGreaterThan(0)
    expect((await check({ lat: 0 })).length).toBeGreaterThan(0)
  })
})
