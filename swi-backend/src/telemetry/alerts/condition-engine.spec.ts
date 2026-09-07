import { EXPERIMENTAL_ALERT_PROFILE as PROFILE } from './alert-profile'
import { heartRateLimits } from './condition-engine'

// O motor é puro: recebe amostras, limites e um instante, e devolve decisões.
// Nada aqui lê banco nem relógio, e é isso que deixa regra temporal com
// histerese ser provada em instante fixo.

describe('heartRateLimits: cada regra cai no piso pela sua própria falta', () => {
  it('com máxima e repouso, as duas regras são personalizadas', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: 190, restingBpm: 62 })

    expect(limits.high).toEqual({ value: 171, rule: 'PERSONALIZED' })
    expect(limits.low).toEqual({ value: 47, rule: 'PERSONALIZED' })
  })

  it('sem máxima, BPM alto cai no piso e BPM baixo continua personalizado', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: null, restingBpm: 62 })

    expect(limits.high).toEqual({ value: 180, rule: 'FLOOR' })
    expect(limits.low).toEqual({ value: 47, rule: 'PERSONALIZED' })
  })

  it('sem repouso, BPM baixo cai no piso e BPM alto continua personalizado', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: 190, restingBpm: null })

    expect(limits.high).toEqual({ value: 171, rule: 'PERSONALIZED' })
    expect(limits.low).toEqual({ value: 40, rule: 'FLOOR' })
  })

  it('o piso é rede de segurança para quem não tem dado, e segura repouso absurdo', () => {
    // Máxima de alguém de 80 anos é 152; 90% dá 137, abaixo do piso de 180, e
    // fica: o piso não é teto para quem tem dado. Já repouso observado de 40
    // daria BPM baixo em 25, abaixo do piso de 40, e aí o piso segura.
    expect(heartRateLimits(PROFILE, { maxBpm: 152, restingBpm: 40 })).toEqual({
      high: { value: 137, rule: 'PERSONALIZED' },
      low: { value: 40, rule: 'FLOOR' },
    })
  })
})
