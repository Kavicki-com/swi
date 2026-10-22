import type { TelemetryConditionKind } from '@prisma/client'

import type { CalibrationThresholds } from '../calibration/calibration-thresholds'
import { CALIBRATED_ALERT_PROFILE as PROFILE } from './alert-profile'
import {
  decideAttention,
  decideBandPressure,
  decideBattery,
  decideHeartRate,
  decideOxygenAttention,
  decideOxygenLow,
  decidePressureCrisis,
  decideWearSafety,
  episodesOf,
  heartRateLimits,
  heartRatePoints,
  type BloodPressureReading,
  type Decision,
  type EngineSample,
  type Episode,
  type Point,
  type SafetySource,
  type Threshold,
} from './condition-engine'
import type { SafetyBand } from './safety-limits'

// Decisões da origem REAL pelo perfil calibrado (swi-alert-calibrated-3), em
// duas camadas: Atenção pela faixa de fadiga da pessoa e travas pelo padrão do
// perfil ou pelo valor do admin. Puro como o motor: o serviço lê as linhas e
// grava as decisões. A DEMO não passa por aqui e segue o perfil v2.

type Active = ReadonlySet<TelemetryConditionKind>

const sourceOf = (custom: object | undefined): SafetySource => (custom === undefined ? 'SAFETY_DEFAULT' : 'SAFETY_CUSTOM')

const present = (decisions: ReadonlyArray<Decision | null>): Decision[] =>
  decisions.flatMap((d) => (d === null ? [] : [d]))

/** Atenção e trava de pressão. Uma medição decide as duas. */
export function calibratedPressureDecisions(
  pressure: BloodPressureReading | null,
  thresholds: CalibrationThresholds,
  active: Active,
): Decision[] {
  const custom = thresholds.safety.BLOOD_PRESSURE_HIGH
  const cuts = {
    systolic: thresholds.cuts.SYSTOLIC.fatigue ?? null,
    diastolic: thresholds.cuts.DIASTOLIC.fatigue ?? null,
  }
  return present([
    decideBandPressure(pressure, cuts, active.has('BLOOD_PRESSURE_FATIGUE')),
    decidePressureCrisis(pressure, custom ?? PROFILE.bloodPressureHigh, active.has('BLOOD_PRESSURE_HIGH'), sourceOf(custom)),
  ])
}

/**
 * Trava e Atenção de oxigenação. `readings` são as últimas leituras, a mais
 * nova primeiro: a trava olha só a última, a Atenção as duas. Sem faixa
 * gravada, a Atenção usa o corte de fadiga da partida mínima (abaixo de 92%).
 */
export function calibratedOxygenDecisions(
  readings: readonly Point[],
  thresholds: CalibrationThresholds,
  active: Active,
): Decision[] {
  const [latest = null, previous = null] = readings
  const custom = thresholds.safety.OXYGEN_LOW
  const cut = thresholds.cuts.OXYGEN_SATURATION.fatigue ?? null
  return present([
    decideOxygenLow(
      latest?.value ?? null,
      custom ?? { openAt: PROFILE.oxygenLow.openBelowPercent, closeAt: PROFILE.oxygenLow.recoverAbovePercent },
      active.has('OXYGEN_LOW'),
      sourceOf(custom),
    ),
    cut === null
      ? null
      : decideOxygenAttention(latest, previous, cut, active.has('OXYGEN_FATIGUE'), PROFILE.oxygenAttention.minApartMs),
  ])
}

/** O dia da pulseira que a avaliação esparsa acabou de recalcular. */
export interface BandBatch {
  /** Batimentos do dia, em qualquer ordem. */
  beats: readonly Point[]
  /** Desgaste logo depois de cada batimento, como a fórmula esparsa calculou. */
  wear: readonly Point[]
  /** Fim da avaliação esparsa anterior do mesmo dia; zero sem ela. Até aqui já foi avaliado. */
  sinceMs: number
}

/** Episódio de uma condição da pulseira, com a régua que o decidiu. */
export interface BandEpisode extends Episode {
  kind: TelemetryConditionKind
  threshold: Threshold
}

/**
 * Condições da pulseira (origem REAL), episódio por episódio do lote. As
 * travas são as mesmas do relógio, decididas numa leitura: a pulseira grava a
 * cada poucos minutos, e a persistência de 60 s do relógio não se prova com
 * ela. A Atenção pede 10 min seguidos na faixa, sem vão maior que 10 min.
 */
export function calibratedBandEpisodes(
  batch: BandBatch,
  thresholds: CalibrationThresholds,
  baseline: { maxBpm: number | null; fallbackRestingBpm: number | null },
  active: Active,
): BandEpisode[] {
  const limits = heartRateLimits(PROFILE, {
    maxBpm: baseline.maxBpm,
    restingBpm: thresholds.restingBpm ?? baseline.fallbackRestingBpm,
  })
  const { holdMs, maxGapMs } = PROFILE.sparseAttention
  const episodes = (
    kind: TelemetryConditionKind,
    points: readonly Point[],
    threshold: Threshold,
    opens: (v: number) => boolean,
    recovers: (v: number) => boolean,
    hold: number,
  ): BandEpisode[] =>
    episodesOf(points, opens, recovers, hold, maxGapMs, active.has(kind), batch.sinceMs).map((e) => ({
      kind,
      threshold,
      ...e,
    }))

  // As travas de batimento como no relógio: idade e repouso por padrão; com
  // valor do admin, abrem e recuperam pelos números dele.
  const lock = (custom: SafetyBand | undefined, byAge: Threshold): Threshold =>
    custom === undefined ? { value: byAge.value, rule: 'SAFETY_DEFAULT' } : { value: custom.openAt, rule: 'SAFETY_CUSTOM' }
  const highCustom = thresholds.safety.HEART_RATE_HIGH
  const high = lock(highCustom, limits.high)
  const highRecover = highCustom?.closeAt ?? high.value - PROFILE.heartRateHigh.hysteresisBpm
  const lowCustom = thresholds.safety.HEART_RATE_LOW
  const low = lock(lowCustom, limits.low)
  const lowRecover = lowCustom?.closeAt ?? low.value + PROFILE.heartRateLow.hysteresisBpm
  const wearCustom = thresholds.safety.WEAR_HIGH
  const wearLock = wearCustom ?? { openAt: PROFILE.wearHigh.openAtPercent, closeAt: PROFILE.wearHigh.recoverBelowPercent }
  const wearHigh: Threshold = { value: wearLock.openAt, rule: sourceOf(wearCustom) }

  // Atenção só com corte de fadiga efetivo, e pela mesma régua do relógio: na
  // faixa a partir do corte, fora dela abaixo dele.
  const attention = (kind: TelemetryConditionKind, points: readonly Point[], cut: number | null | undefined) =>
    cut === null || cut === undefined
      ? []
      : episodes(kind, points, { value: cut, rule: 'BAND' }, (v) => v >= cut, (v) => v < cut, holdMs)

  return [
    ...episodes('HEART_RATE_HIGH', batch.beats, high, (v) => v >= high.value, (v) => v < highRecover, 0),
    ...episodes('HEART_RATE_LOW', batch.beats, low, (v) => v <= low.value, (v) => v > lowRecover, 0),
    ...attention('HEART_RATE_FATIGUE', batch.beats, thresholds.cuts.HEART_RATE.fatigue),
    ...episodes('WEAR_HIGH', batch.wear, wearHigh, (v) => v >= wearLock.openAt, (v) => v < wearLock.closeAt, 0),
    ...attention('WEAR_FATIGUE', batch.wear, thresholds.cuts.WEAR.fatigue),
  ]
}

export interface WatchReadings {
  /** Batimento da sessão nos últimos 10 min: a Atenção usa tudo, a trava só o último minuto. */
  samples: readonly EngineSample[]
  /** Desgaste das avaliações da sessão nos últimos 10 min, pelo fim da janela de cada uma. */
  wear: readonly Point[]
  /** Desgaste da última avaliação dentro do prazo da medição, para a trava. */
  latestWear: number | null
  battery: number | null
  maxBpm: number | null
  /** Repouso pelos dias fechados, para quando a calibração ainda não tem o dela. */
  fallbackRestingBpm: number | null
  nowMs: number
}

/** O que o relógio decide a cada evento ao vivo na origem REAL. */
export function calibratedWatchDecisions(
  readings: WatchReadings,
  thresholds: CalibrationThresholds,
  active: Active,
): Decision[] {
  const limits = heartRateLimits(PROFILE, {
    maxBpm: readings.maxBpm,
    restingBpm: thresholds.restingBpm ?? readings.fallbackRestingBpm,
  })
  // A trava de batimento segue a máxima por idade e o repouso, com a janela de
  // 60 s; com valor do admin, abre e recupera pelos números dele.
  const heartRateLock = (kind: 'HEART_RATE_HIGH' | 'HEART_RATE_LOW', custom: SafetyBand | undefined, byAge: Threshold) => {
    const threshold: Threshold =
      custom === undefined ? { value: byAge.value, rule: 'SAFETY_DEFAULT' } : { value: custom.openAt, rule: 'SAFETY_CUSTOM' }
    return decideHeartRate(kind, readings.samples, threshold, active.has(kind), PROFILE, readings.nowMs, custom?.closeAt)
  }
  const heartRateCut = thresholds.cuts.HEART_RATE.fatigue ?? null
  const wearCut = thresholds.cuts.WEAR.fatigue ?? null
  const wearLock = thresholds.safety.WEAR_HIGH

  return present([
    heartRateLock('HEART_RATE_HIGH', thresholds.safety.HEART_RATE_HIGH, limits.high),
    heartRateLock('HEART_RATE_LOW', thresholds.safety.HEART_RATE_LOW, limits.low),
    heartRateCut === null
      ? null
      : decideAttention(
          'HEART_RATE_FATIGUE',
          heartRatePoints(readings.samples),
          heartRateCut,
          'HIGHER_IS_WORSE',
          active.has('HEART_RATE_FATIGUE'),
          PROFILE.attention,
          readings.nowMs,
        ),
    decideBattery(readings.battery, active.has('DEVICE_BATTERY_LOW'), PROFILE),
    decideWearSafety(
      readings.latestWear,
      wearLock ?? { openAt: PROFILE.wearHigh.openAtPercent, closeAt: PROFILE.wearHigh.recoverBelowPercent },
      active.has('WEAR_HIGH'),
      sourceOf(wearLock),
    ),
    wearCut === null
      ? null
      : decideAttention(
          'WEAR_FATIGUE',
          readings.wear,
          wearCut,
          'HIGHER_IS_WORSE',
          active.has('WEAR_FATIGUE'),
          PROFILE.wearAttention,
          readings.nowMs,
        ),
  ])
}
