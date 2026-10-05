import { LIVE_RATE_LIMITS, LiveRateLimit } from './live-rate-limit'

// O limitador global do REST não alcança eventos de socket. Este conta por
// socket e por tipo: ligar, parar e assistir consultam o banco e avisam
// pessoas; o repasse de oferta e candidatos é bem mais frequente.

describe('LiveRateLimit', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    now = 1_000_000
  })

  it('aceita até o teto da janela e recusa o excedente', () => {
    const limit = new LiveRateLimit(clock, { control: { max: 2, windowMs: 1000 }, relay: { max: 3, windowMs: 1000 } })
    expect([limit.take('s1', 'control'), limit.take('s1', 'control'), limit.take('s1', 'control')]).toEqual([true, true, false])
    expect([1, 2, 3, 4].map(() => limit.take('s1', 'relay'))).toEqual([true, true, true, false])
  })

  it('cada socket tem a própria conta', () => {
    const limit = new LiveRateLimit(clock, { control: { max: 1, windowMs: 1000 }, relay: { max: 1, windowMs: 1000 } })
    expect(limit.take('s1', 'control')).toBe(true)
    expect(limit.take('s2', 'control')).toBe(true)
    expect(limit.take('s1', 'control')).toBe(false)
  })

  it('a conta recomeça quando a janela passa', () => {
    const limit = new LiveRateLimit(clock, { control: { max: 1, windowMs: 1000 }, relay: { max: 1, windowMs: 1000 } })
    expect(limit.take('s1', 'control')).toBe(true)
    now += 999
    expect(limit.take('s1', 'control')).toBe(false)
    now += 1
    expect(limit.take('s1', 'control')).toBe(true)
  })

  it('esquecer o socket que caiu libera a memória e a conta', () => {
    const limit = new LiveRateLimit(clock, { control: { max: 1, windowMs: 1000 }, relay: { max: 1, windowMs: 1000 } })
    limit.take('s1', 'control')
    limit.take('s1', 'relay')
    limit.forget('s1')
    expect(limit.size()).toBe(0)
    expect(limit.take('s1', 'control')).toBe(true)
  })

  it('os tetos padrão folgam o uso normal: três espectadores renegociando cabem no repasse', () => {
    expect(LIVE_RATE_LIMITS.control).toEqual({ max: 20, windowMs: 60_000 })
    expect(LIVE_RATE_LIMITS.relay).toEqual({ max: 600, windowMs: 60_000 })
  })
})
