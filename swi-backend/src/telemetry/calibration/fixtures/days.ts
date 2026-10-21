import type { CalibrationDay } from '../calibration-bands'

const HOUR = 60 * 60 * 1000

/** Dia válido de relógio com valores redondos; sobrescrever o que o teste precisa. */
export const day = (over: Partial<CalibrationDay> = {}): CalibrationDay => ({
  day: new Date('2026-10-01T00:00:00Z'),
  deviceFamily: 'WATCH',
  heartRateCoveredMs: 3 * HOUR,
  heartRateMin: 60,
  heartRateMax: 150,
  heartRateP25: 75,
  heartRateP90: 120,
  oxygenSaturationP10: null,
  oxygenSaturationP50: null,
  oxygenSaturationCount: null,
  bodyTemperatureP10: null,
  bodyTemperatureP25: null,
  bodyTemperatureP75: null,
  bodyTemperatureP90: null,
  bodyTemperatureCount: null,
  systolicAvg: null,
  diastolicAvg: null,
  bloodPressureCount: null,
  effortP25: 20,
  effortP90: 60,
  wearMax: 50,
  stepsTotal: 9000,
  distanceTotalM: 6000,
  activeEnergyKcalTotal: 400,
  movementPerMinuteMedian: 40,
  ...over,
})
