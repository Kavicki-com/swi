import { formatDateShort } from './formatDateShort'

describe('formatDateShort', () => {
  it('converts dd/mm/yyyy to "d mmm yyyy" using PT-BR short month names', () => {
    expect(formatDateShort('13/08/2025')).toBe('13 ago 2025')
    expect(formatDateShort('01/01/2026')).toBe('1 jan 2026')
    expect(formatDateShort('31/12/2024')).toBe('31 dez 2024')
  })

  it('returns the original input when the string is malformed', () => {
    expect(formatDateShort('not-a-date')).toBe('not-a-date')
    expect(formatDateShort('13-08-2025')).toBe('13-08-2025')
    expect(formatDateShort('13/13/2025')).toBe('13/13/2025')
  })
})
