import { validate } from 'class-validator'
import { IsCalendarDate } from './is-calendar-date'

class Probe {
  @IsCalendarDate() birthDate!: string
}

const check = async (v: string) => {
  const p = new Probe()
  p.birthDate = v
  return (await validate(p)).length === 0 // true = válido
}

describe('IsCalendarDate', () => {
  it('aceita data de calendário real', async () => {
    expect(await check('1990-05-20')).toBe(true)
    expect(await check('2000-02-29')).toBe(true) // bissexto válido
  })
  it('rejeita mês/dia impossíveis', async () => {
    expect(await check('2000-13-45')).toBe(false)
    expect(await check('2000-02-30')).toBe(false) // fev não tem 30
    expect(await check('2001-02-29')).toBe(false) // 2001 não é bissexto
  })
  it('rejeita shape errado', async () => {
    expect(await check('20-05-1990')).toBe(false)
    expect(await check('not-a-date')).toBe(false)
  })
})
