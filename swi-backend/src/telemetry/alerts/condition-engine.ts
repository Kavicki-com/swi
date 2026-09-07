import type { TelemetryConditionKind } from '@prisma/client'

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

export interface EngineSample {
  atMs: number
  heartRateBpm: number | null
  batteryPercent: number | null
}

export interface Decision {
  kind: TelemetryConditionKind
  action: 'OPEN' | 'RECOVER'
  observedValue: number | null
  threshold: Threshold | null
}

type HeartRateKind = 'HEART_RATE_HIGH' | 'HEART_RATE_LOW'

/**
 * "Contínuo" tem três exigências, e nenhuma delas sozinha basta:
 *
 * 1. Toda amostra de BPM da janela satisfaz o predicado. Uma leitura do outro
 *    lado zera a evidência, então a persistência efetiva é a janela inteira.
 * 2. O trecho entre a primeira e a última cobre o mínimo. É a mesma noção de
 *    cobertura que o projetor usa para a taxa de energia: número sem
 *    denominador é número inventado.
 * 3. Nenhum vão entre amostras consecutivas passa do teto. Sem esta, duas
 *    amostras nas pontas da janela cumpririam a segunda exigência sem haver
 *    dado nenhum entre elas, e duas amostras a 45 s de distância não provam
 *    45 s de nada, pela mesma razão que duas a 5 s não provam um minuto.
 *
 * A fronteira de baixo é fechada, como a do projetor: sem isso, uma amostra
 * por janela caía fora na cadência de 5 s, e o trecho medido era 55 s onde o
 * perfil dizia 60 s.
 */
function sustained(
  samples: readonly EngineSample[],
  nowMs: number,
  profile: AlertProfile,
  holds: (bpm: number) => boolean,
): number[] | null {
  const windowStart = nowMs - profile.persistence.windowMs
  const inWindow = samples
    .filter((s) => s.heartRateBpm !== null && s.atMs >= windowStart && s.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs)
  if (inWindow.length === 0) return null
  const spanMs = inWindow[inWindow.length - 1].atMs - inWindow[0].atMs
  if (spanMs < profile.persistence.minSpanMs) return null
  for (let i = 1; i < inWindow.length; i++) {
    if (inWindow[i].atMs - inWindow[i - 1].atMs > profile.persistence.maxGapMs) return null
  }
  const values = inWindow.map((s) => s.heartRateBpm as number)
  return values.every(holds) ? values : null
}

export function decideHeartRate(
  kind: HeartRateKind,
  samples: readonly EngineSample[],
  threshold: Threshold,
  active: boolean,
  profile: AlertProfile,
  nowMs: number,
): Decision | null {
  const high = kind === 'HEART_RATE_HIGH'
  const band = high ? profile.heartRateHigh.hysteresisBpm : profile.heartRateLow.hysteresisBpm

  if (!active) {
    const values = sustained(samples, nowMs, profile, (bpm) => (high ? bpm >= threshold.value : bpm <= threshold.value))
    if (values === null) return null
    return { kind, action: 'OPEN', observedValue: high ? Math.max(...values) : Math.min(...values), threshold }
  }

  // Recupera pela banda, não pelo mesmo limite: quem oscila em torno dele
  // abriria e fecharia a cada leitura.
  const recoverAt = high ? threshold.value - band : threshold.value + band
  const values = sustained(samples, nowMs, profile, (bpm) => (high ? bpm < recoverAt : bpm > recoverAt))
  if (values === null) return null
  return { kind, action: 'RECOVER', observedValue: high ? Math.max(...values) : Math.min(...values), threshold }
}

/**
 * Bateria chega a cada cinco minutos e cai de forma monótona: uma leitura
 * basta para abrir. A banda de dez pontos é o que evita abre e fecha por
 * leitura imprecisa, e a recuperação durante o turno existe: carregador no
 * almoço é real.
 */
export function decideBattery(percent: number | null, active: boolean, profile: AlertProfile): Decision | null {
  if (percent === null) return null
  const threshold: Threshold = { value: profile.batteryLow.openAtPercent, rule: 'FLOOR' }
  if (!active && percent <= profile.batteryLow.openAtPercent) {
    return { kind: 'DEVICE_BATTERY_LOW', action: 'OPEN', observedValue: percent, threshold }
  }
  if (active && percent > profile.batteryLow.recoverAbovePercent) {
    return { kind: 'DEVICE_BATTERY_LOW', action: 'RECOVER', observedValue: percent, threshold }
  }
  return null
}

export interface BloodPressureReading {
  systolic: number
  diastolic: number
}

/**
 * Pressão é medida à mão e raramente: uma medição abre, e só medição nova
 * recupera. A banda é pequena porque a série já é esparsa; sem ela, 139 e 141
 * alternados abririam e fechariam a cada dia. O valor observado é o que
 * cruzou, sistólica primeiro.
 */
export function decideBloodPressure(
  reading: BloodPressureReading | null,
  active: boolean,
  profile: AlertProfile,
): Decision | null {
  if (reading === null) return null
  const p = profile.bloodPressureReview
  if (!active) {
    if (reading.systolic >= p.systolicAt) {
      return { kind: 'BLOOD_PRESSURE_REVIEW', action: 'OPEN', observedValue: reading.systolic, threshold: null }
    }
    if (reading.diastolic >= p.diastolicAt) {
      return { kind: 'BLOOD_PRESSURE_REVIEW', action: 'OPEN', observedValue: reading.diastolic, threshold: null }
    }
    return null
  }
  if (reading.systolic < p.systolicRecoverBelow && reading.diastolic < p.diastolicRecoverBelow) {
    return { kind: 'BLOOD_PRESSURE_REVIEW', action: 'RECOVER', observedValue: reading.systolic, threshold: null }
  }
  return null
}
