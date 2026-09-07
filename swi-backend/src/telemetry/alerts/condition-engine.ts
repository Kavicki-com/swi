import type { AlertProfile } from './alert-profile'

// Motor de condições: decide abrir, manter ou recuperar a partir de amostras,
// limites e um instante. Puro de propósito, como a fórmula: "now" entra por
// parâmetro, nada aqui lê banco nem relógio. Quem lê e grava é o serviço.

export type ThresholdRule = 'PERSONALIZED' | 'FLOOR'

/** Limite em vigor e de onde ele veio. `value` na unidade da condição. */
export interface Threshold {
  readonly value: number
  readonly rule: ThresholdRule
}

export interface HeartRateLimits {
  high: Threshold
  low: Threshold
}

export interface HeartRateBaseline {
  /** Máxima por idade. Nula sem data de nascimento. */
  maxBpm: number | null
  /** Repouso observado. Nulo sem 14 dias de Resumo do dia. */
  restingBpm: number | null
}

/**
 * Cada regra cai no piso pela sua própria falta: cadastro completo sem
 * histórico tem BPM alto personalizado e BPM baixo no piso. O piso é rede de
 * segurança para quem não tem dado; para BPM baixo ele também segura um
 * repouso observado absurdo, que produziria limite abaixo do piso.
 */
export function heartRateLimits(profile: AlertProfile, baseline: HeartRateBaseline): HeartRateLimits {
  const high: Threshold =
    baseline.maxBpm === null
      ? { value: profile.heartRateHigh.floorBpm, rule: 'FLOOR' }
      : { value: Math.round(baseline.maxBpm * profile.heartRateHigh.maxFraction), rule: 'PERSONALIZED' }

  // Arredondado como o limite alto: a mediana de um número par de dias fechados
  // é a média dos dois centrais, então repouso observado de 62,5 é possível, e
  // sem isto a casa decimal iria para a coluna da condição e para a tela.
  const personalizedLow =
    baseline.restingBpm === null ? null : Math.round(baseline.restingBpm - profile.heartRateLow.belowRestingBpm)
  const low: Threshold =
    personalizedLow === null || personalizedLow < profile.heartRateLow.floorBpm
      ? { value: profile.heartRateLow.floorBpm, rule: 'FLOOR' }
      : { value: personalizedLow, rule: 'PERSONALIZED' }

  return { high, low }
}
