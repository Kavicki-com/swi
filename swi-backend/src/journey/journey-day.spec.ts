import { CARRY_OVER_MAX_MS, carryOverSince, journeyDayOf } from './journey-day'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('journeyDayOf', () => {
  it('20h59 em Brasília ainda é o mesmo dia', () => {
    expect(journeyDayOf(new Date('2026-10-04T23:59:00.000Z'))).toEqual(day('2026-10-04'))
  })

  it('21h em Brasília (meia-noite UTC) NÃO vira o dia', () => {
    expect(journeyDayOf(new Date('2026-10-05T00:00:00.000Z'))).toEqual(day('2026-10-04'))
    expect(journeyDayOf(new Date('2026-10-05T00:30:00.000Z'))).toEqual(day('2026-10-04'))
  })

  it('23h59 em Brasília ainda é o mesmo dia', () => {
    expect(journeyDayOf(new Date('2026-10-05T02:59:59.999Z'))).toEqual(day('2026-10-04'))
  })

  it('meia-noite em Brasília vira o dia', () => {
    expect(journeyDayOf(new Date('2026-10-05T03:00:00.000Z'))).toEqual(day('2026-10-05'))
  })

  it('vira mês e ano pelo calendário de Brasília', () => {
    expect(journeyDayOf(new Date('2027-01-01T01:00:00.000Z'))).toEqual(day('2026-12-31'))
  })
})

describe('carryOverSince', () => {
  it('é 14 h antes de agora', () => {
    expect(CARRY_OVER_MAX_MS).toBe(14 * 60 * 60 * 1000)
    expect(carryOverSince(new Date('2026-10-05T09:00:00.000Z'))).toEqual(new Date('2026-10-04T19:00:00.000Z'))
  })
})
