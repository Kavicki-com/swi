import type { CalibrationMetric } from '@prisma/client'
import { FULL_DAYS, cutsOf, effectiveCuts } from '../calibration/calibration-bands'
import { calibrationDayOf } from '../calibration/calibration-thresholds'
import { zoneOf, type CalibrationMetricView, type WorkerCalibrationView } from '../calibration/calibration-zone'
import type { WorkerMetrics } from './telemetry-projector'

// A calibração como a leitura individual a entrega: a fase da pessoa e, por
// medição, a faixa em vigor e onde o valor de agora cai nela. Puro: quem lê
// as linhas é o serviço de consulta, e o projetor continua sem saber que a
// calibração existe. Leitura desconfiada, como a da régua do esforço: JSON
// torto some em silêncio, nunca derruba a leitura.

export interface CalibrationRows {
  calibration: { version: string; validDays: number; recalibrating: boolean } | null
  bands: ReadonlyArray<{ metric: CalibrationMetric; learnedCuts: unknown; overrideCuts: unknown }>
}

/**
 * O valor de agora que cada faixa classifica. Passos, distância e calorias são
 * totais do dia em andamento, e um dia pela metade não se classifica pelo
 * total: o painel mostra só a faixa habitual. Movimento por minuto é taxa, e
 * taxa se classifica.
 */
const VALUE_OF: Readonly<Record<CalibrationMetric, (m: WorkerMetrics) => number | null>> = {
  HEART_RATE: (m) => m.heartRate.value,
  OXYGEN_SATURATION: (m) => m.oxygenSaturation.value,
  BODY_TEMPERATURE: (m) => m.bodyTemperature.value,
  SYSTOLIC: (m) => m.bloodPressure.value?.systolic ?? null,
  DIASTOLIC: (m) => m.bloodPressure.value?.diastolic ?? null,
  EFFORT: (m) => m.effort.value,
  WEAR: (m) => m.wear.value,
  STEPS: () => null,
  DISTANCE: () => null,
  ACTIVE_ENERGY: () => null,
  MOVEMENT: (m) => m.movementPerMinute.value,
}

/**
 * Nulo sem linha de calibração, que é o caso de quem nunca teve dia válido e
 * de quem só tem demonstração. Faixa com aprendido ilegível fica ausente;
 * correção ilegível cai no aprendido, como no motor de condições.
 */
export function calibrationViewOf(metrics: WorkerMetrics, rows: CalibrationRows): WorkerCalibrationView | null {
  if (rows.calibration === null) return null
  const { version, validDays, recalibrating } = rows.calibration

  const views: Partial<Record<CalibrationMetric, CalibrationMetricView>> = {}
  for (const band of rows.bands) {
    const learned = cutsOf(band.metric, band.learnedCuts)
    if (learned === null) continue
    const override = cutsOf(band.metric, band.overrideCuts)
    const cuts = effectiveCuts(learned, override)
    views[band.metric] = {
      zone: zoneOf(band.metric, VALUE_OF[band.metric](metrics), cuts),
      cuts,
      source: override === null ? 'LEARNED' : 'OVERRIDE',
    }
  }

  return {
    version,
    phase: validDays >= FULL_DAYS ? 'CALIBRATED' : 'CALIBRATING',
    recalibrating,
    day: calibrationDayOf(rows.calibration),
    metrics: views,
  }
}
