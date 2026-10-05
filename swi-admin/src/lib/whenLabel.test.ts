// Datas no fuso local: o texto sai no relógio do computador de quem olha.
import { whenLabel } from './whenLabel'

const NOW = new Date(2026, 9, 5, 14, 40).getTime()

describe('whenLabel', () => {
  it('de hoje diz só a hora', () => {
    expect(whenLabel(new Date(2026, 9, 5, 9, 5).toISOString(), NOW)).toBe('às 09:05')
  })

  it('de outro dia diz o dia e a hora, para não parecer de hoje', () => {
    expect(whenLabel(new Date(2026, 9, 3, 14, 32).toISOString(), NOW)).toBe('em 03/10 às 14:32')
  })

  it('hora inválida não vira texto', () => {
    expect(whenLabel('não é data', NOW)).toBeNull()
  })
})
