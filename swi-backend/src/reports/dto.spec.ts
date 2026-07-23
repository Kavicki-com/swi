import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { UpdateReportDto } from './dto'

const titleErrs = async (body: object) => {
  const errs = await validate(plainToInstance(UpdateReportDto, body))
  return errs.filter((e) => e.property === 'title').length
}

describe('UpdateReportDto', () => {
  it('rejeita title vazio (coluna obrigatória não pode ser apagada)', async () => {
    expect(await titleErrs({ title: '' })).toBeGreaterThan(0)
  })
  it('aceita title preenchido', async () => {
    expect(await titleErrs({ title: 'X' })).toBe(0)
  })
  it('aceita ausência de title (patch parcial)', async () => {
    expect(await titleErrs({})).toBe(0)
  })
})
