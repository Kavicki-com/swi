// Datas montadas no fuso local: o texto sai no relógio do computador do admin,
// e o teste não pode depender do fuso da máquina que roda a suíte.
import {
  POSITION_CLOCK_MS,
  STALE_POSITION_MS,
  positionAge,
  stalePinTitle,
  stalePositionNote,
} from './positionAge'

const at = (day: number, hour: number, minute: number, second = 0) =>
  new Date(2026, 9, day, hour, minute, second)
const iso = (d: Date) => d.toISOString()

const NOW = at(5, 14, 40).getTime()

describe('positionAge', () => {
  it('posição conta como velha depois de 5 minutos, e o relógio da tela anda a cada 30 s', () => {
    expect(STALE_POSITION_MS).toBe(5 * 60_000)
    expect(POSITION_CLOCK_MS).toBe(30_000)
  })

  it('posição de até 5 minutos é atual', () => {
    expect(positionAge(iso(at(5, 14, 35)), NOW)).toEqual({ stale: false, when: 'às 14:35' })
  })

  it('posição de hoje com mais de 5 minutos é velha e diz só a hora', () => {
    expect(positionAge(iso(at(5, 14, 34, 59)), NOW)).toEqual({ stale: true, when: 'às 14:34' })
  })

  it('posição de outro dia diz o dia e a hora', () => {
    expect(positionAge(iso(at(3, 14, 32)), NOW)).toEqual({
      stale: true,
      when: 'em 03/10 às 14:32',
    })
  })

  it('hora um pouco à frente do relógio do admin não é velha', () => {
    expect(positionAge(iso(at(5, 14, 41)), NOW)?.stale).toBe(false)
  })

  it('sem hora ou com hora inválida não há o que dizer', () => {
    expect(positionAge(undefined, NOW)).toBeNull()
    expect(positionAge('não é data', NOW)).toBeNull()
  })
})

describe('textos da posição velha', () => {
  it('minimapa: "Última posição às 14:32" hoje e com dia em outra data', () => {
    expect(stalePositionNote(iso(at(5, 14, 32)), NOW)).toBe('Última posição às 14:32')
    expect(stalePositionNote(iso(at(3, 14, 32)), NOW)).toBe('Última posição em 03/10 às 14:32')
  })

  it('pino: "Nome, última posição às 14:32" hoje e com dia em outra data', () => {
    expect(stalePinTitle('Ana Souza', iso(at(5, 14, 32)), NOW)).toBe(
      'Ana Souza, última posição às 14:32',
    )
    expect(stalePinTitle('Ana Souza', iso(at(3, 14, 32)), NOW)).toBe(
      'Ana Souza, última posição em 03/10 às 14:32',
    )
  })

  it('posição atual ou sem hora não ganha texto', () => {
    expect(stalePositionNote(iso(at(5, 14, 38)), NOW)).toBeNull()
    expect(stalePositionNote(undefined, NOW)).toBeNull()
    expect(stalePinTitle('Ana Souza', iso(at(5, 14, 38)), NOW)).toBeUndefined()
    expect(stalePinTitle('Ana Souza', undefined, NOW)).toBeUndefined()
  })
})
