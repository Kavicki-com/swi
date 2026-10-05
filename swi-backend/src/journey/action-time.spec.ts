import { BadRequestException, UnprocessableEntityException } from '@nestjs/common'
import { effectiveActionTime, MAX_ACTION_AGE_MS } from './action-time'

// A ação da jornada feita sem sinal vale na hora do toque. O relógio do
// aparelho só serve para medir quanto tempo o envio esperou na fila: o
// servidor desconta essa espera da própria hora.

describe('effectiveActionTime', () => {
  const server = Date.parse('2026-10-04T15:00:00.000Z')
  const MIN = 60_000

  it('sem a hora do toque vale a hora do servidor, com ou sem a hora do envio', () => {
    expect(effectiveActionTime(undefined, undefined, server)).toBe(server)
    expect(effectiveActionTime(undefined, '2026-10-04T10:00:00.000Z', server)).toBe(server)
  })

  it('desconta da hora do servidor o tempo que o envio esperou', () => {
    const at = effectiveActionTime('2026-10-04T14:00:00.000Z', '2026-10-04T14:30:00.000Z', server)
    expect(at).toBe(server - 30 * MIN)
  })

  it('usa só a diferença: relógio do aparelho adiantado em um dia dá o mesmo resultado', () => {
    const at = effectiveActionTime('2026-10-05T14:00:00.000Z', '2026-10-05T14:30:00.000Z', server)
    expect(at).toBe(server - 30 * MIN)
  })

  it('aceita a hora com deslocamento de fuso', () => {
    const at = effectiveActionTime('2026-10-04T11:00:00.000-03:00', '2026-10-04T14:10:00.000Z', server)
    expect(at).toBe(server - 10 * MIN)
  })

  it('toque depois do envio (relógio acertado no meio) vale como agora', () => {
    expect(effectiveActionTime('2026-10-04T14:30:00.000Z', '2026-10-04T14:00:00.000Z', server)).toBe(server)
  })

  it('espera de exatamente 72 h ainda vale', () => {
    const touched = new Date(server - MAX_ACTION_AGE_MS).toISOString()
    expect(effectiveActionTime(touched, new Date(server).toISOString(), server)).toBe(server - MAX_ACTION_AGE_MS)
  })

  it('espera acima de 72 h é recusada com 422', () => {
    const touched = new Date(server - MAX_ACTION_AGE_MS - 1).toISOString()
    expect(() => effectiveActionTime(touched, new Date(server).toISOString(), server)).toThrow(UnprocessableEntityException)
  })

  it('hora do toque sem a hora do envio é 400', () => {
    expect(() => effectiveActionTime('2026-10-04T14:00:00.000Z', undefined, server)).toThrow(BadRequestException)
    expect(() => effectiveActionTime('2026-10-04T14:00:00.000Z', '   ', server)).toThrow(BadRequestException)
  })

  it('hora do envio fora do formato é 400', () => {
    expect(() => effectiveActionTime('2026-10-04T14:00:00.000Z', 'ontem', server)).toThrow(BadRequestException)
    // Cabeçalho repetido chega juntado por vírgula.
    expect(() =>
      effectiveActionTime('2026-10-04T14:00:00.000Z', '2026-10-04T14:30:00.000Z, 2026-10-04T14:31:00.000Z', server),
    ).toThrow(BadRequestException)
  })

  it('hora do toque fora do formato é 400', () => {
    expect(() => effectiveActionTime('ontem', '2026-10-04T14:30:00.000Z', server)).toThrow(BadRequestException)
  })

  it('data sem hora não é instante: 400', () => {
    expect(() => effectiveActionTime('2026-10-04', '2026-10-04T14:30:00.000Z', server)).toThrow(BadRequestException)
    expect(() => effectiveActionTime('2026-10-04T14:00:00.000Z', '2026-10-04', server)).toThrow(BadRequestException)
  })
})
