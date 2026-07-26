// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { formatAge } from './formatAge'

describe('formatAge', () => {
  it('formata idade conhecida', () => {
    expect(formatAge(41)).toBe('41 anos')
    expect(formatAge(1)).toBe('1 ano')
  })

  it('0 = data de nascimento AUSENTE (ageFrom devolve 0) → travessão, não "0 anos"', () => {
    expect(formatAge(0)).toBe('—')
  })

  it('null/undefined também caem no travessão', () => {
    expect(formatAge(null)).toBe('—')
    expect(formatAge(undefined)).toBe('—')
  })

  it('idade negativa (data futura digitada errado) não vaza pra tela', () => {
    expect(formatAge(-3)).toBe('—')
  })
})
