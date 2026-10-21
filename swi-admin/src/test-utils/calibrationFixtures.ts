// Detalhe de calibração sintético para as suítes da página "Faixas e travas".
import type {
  CalibrationDetail,
  CalibrationMetricDetail,
  SafetyDetail,
} from '@/services/api/calibration'

export const heartRateBand = (
  over: Partial<CalibrationMetricDetail> = {},
): CalibrationMetricDetail => ({
  metric: 'HEART_RATE',
  validDays: 12,
  start: { excellence: 120, fatigue: 150 },
  learned: { excellence: 118, fatigue: 146 },
  override: null,
  effective: { excellence: 118, fatigue: 146 },
  source: 'LEARNED',
  ...over,
})

export const temperatureBand = (
  over: Partial<CalibrationMetricDetail> = {},
): CalibrationMetricDetail => ({
  metric: 'BODY_TEMPERATURE',
  validDays: 12,
  start: { p10: 35.8, p25: 36.1, p75: 36.9, p90: 37.3 },
  learned: { p10: 35.9, p25: 36.2, p75: 36.8, p90: 37.2 },
  override: null,
  effective: { p10: 35.9, p25: 36.2, p75: 36.8, p90: 37.2 },
  source: 'LEARNED',
  ...over,
})

export const oxygenSafety = (over: Partial<SafetyDetail> = {}): SafetyDetail => ({
  rule: 'OXYGEN_LOW',
  defaultLabel: 'abaixo de 90% por 60 s',
  defaultValues: { openAt: 90, closeAt: 92 },
  effective: { openAt: 90, closeAt: 92 },
  custom: false,
  updatedAt: null,
  ...over,
})

export const pressureSafety = (over: Partial<SafetyDetail> = {}): SafetyDetail => ({
  rule: 'BLOOD_PRESSURE_HIGH',
  defaultLabel: 'sistólica 160 ou diastólica 100',
  defaultValues: {
    systolicAt: 160,
    diastolicAt: 100,
    systolicRecoverBelow: 150,
    diastolicRecoverBelow: 95,
  },
  effective: {
    systolicAt: 160,
    diastolicAt: 100,
    systolicRecoverBelow: 150,
    diastolicRecoverBelow: 95,
  },
  custom: false,
  updatedAt: null,
  ...over,
})

export const calibrationDetail = (over: Partial<CalibrationDetail> = {}): CalibrationDetail => ({
  workerId: 'w1',
  version: 'swi-calibration-1',
  phase: 'CALIBRATING',
  day: 12,
  recalibrating: false,
  deviceFamily: 'WATCH',
  ruler: {
    restingBpm: 62,
    peakBpm: 171,
    peakPersonalBpm: 168,
    peakStartBpm: 182,
    maxBpmByAge: 182,
  },
  metrics: [heartRateBand(), temperatureBand()],
  safety: [oxygenSafety(), pressureSafety()],
  ...over,
})
