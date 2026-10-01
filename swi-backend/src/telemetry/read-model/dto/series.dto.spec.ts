// Os decoradores do DTO precisam do Reflect estendido, como no DTO do histórico.
import 'reflect-metadata'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { SeriesQueryDto } from './series.dto'

const periodErrs = async (query: object) => {
  const errs = await validate(plainToInstance(SeriesQueryDto, query))
  return errs.filter((e) => e.property === 'period').length
}

describe('SeriesQueryDto', () => {
  it.each(['day', 'week', 'month'])('aceita %s', async (period) => {
    expect(await periodErrs({ period })).toBe(0)
  })

  // Período ausente não vira "hoje" por padrão: o gráfico sempre diz qual pediu,
  // e um padrão silencioso trocaria o mês pelo dia sem ninguém perceber.
  it('recusa período ausente', async () => {
    expect(await periodErrs({})).toBeGreaterThan(0)
  })

  it('recusa período fora da lista', async () => {
    expect(await periodErrs({ period: 'year' })).toBeGreaterThan(0)
  })
})
