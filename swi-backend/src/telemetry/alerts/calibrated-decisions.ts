import type { TelemetryConditionKind } from '@prisma/client'

import type { CalibrationThresholds } from '../calibration/calibration-thresholds'
import { CALIBRATED_ALERT_PROFILE as PROFILE } from './alert-profile'
import {
  decideAttention,
  decideBandPressure,
  decideBattery,
  decideHeartRate,
  decidePressureCrisis,
  decideWearSafety,
  heartRateLimits,
  heartRatePoints,
  type BloodPressureReading,
  type Decision,
  type EngineSample,
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
