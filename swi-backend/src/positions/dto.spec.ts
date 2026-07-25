import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { HeartbeatDto } from './dto'

describe('HeartbeatDto', () => {
  const check = async (body: Record<string, unknown>) => {
    const errors = await validate(plainToInstance(HeartbeatDto, body), { whitelist: true })
    return errors
  }

  it('aceita coordenadas válidas', async () => {
    expect(await check({ lat: -23.55, lng: -46.63 })).toHaveLength(0)
  })

  it('rejeita fora dos limites geográficos', async () => {
    expect((await check({ lat: 91, lng: 0 })).length).toBeGreaterThan(0)
    expect((await check({ lat: 0, lng: 181 })).length).toBeGreaterThan(0)
    expect((await check({ lat: -91, lng: 0 })).length).toBeGreaterThan(0)
  })

  it('rejeita não-número e campos ausentes', async () => {
    expect((await check({ lat: 'x', lng: 0 })).length).toBeGreaterThan(0)
    expect((await check({})).length).toBeGreaterThan(0)
  })
})
