import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { HeartbeatDto, HeatQueryDto } from './dto'

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

describe('HeatQueryDto', () => {
  const check = async (query: Record<string, unknown>) =>
    validate(plainToInstance(HeatQueryDto, query), { whitelist: true, forbidNonWhitelisted: true })

  it('sem nada é válido: janela e origem têm padrão', async () => {
    expect(await check({})).toHaveLength(0)
  })

  it('aceita janela em ISO-8601 e origem real ou all', async () => {
    expect(await check({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T12:00:00.000Z', source: 'real' })).toHaveLength(0)
    expect(await check({ source: 'all' })).toHaveLength(0)
  })

  it('recusa data fora do formato e origem desconhecida', async () => {
    expect((await check({ from: 'ontem' })).length).toBeGreaterThan(0)
    expect((await check({ source: 'sim' })).length).toBeGreaterThan(0)
  })
})
