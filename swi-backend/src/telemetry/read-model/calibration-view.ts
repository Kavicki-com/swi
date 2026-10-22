import type { CalibrationMetric } from '@prisma/client'
import {
  CALIBRATION_METRICS,
  CALIBRATION_VERSION,
  FULL_DAYS,
  cutsOf,
  effectiveCuts,
  startCuts,
} from '../calibration/calibration-bands'
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
 * Sempre há calibração: sem linha gravada (quem ainda não teve dia válido, ou
 * só tem demonstração) ela é virtual, na partida mínima e no dia 1. Faixa
 * ausente ou com aprendido ilegível vale a partida, sem a correção; correção
 * ilegível cai no aprendido, como no motor de condições.
 */
export function calibrationViewOf(
  metrics: WorkerMetrics,
  rows: CalibrationRows,
  maxBpmByAge: number | null,
): WorkerCalibrationView {
  const views: Partial<Record<CalibrationMetric, CalibrationMetricView>> = {}
  for (const metric of CALIBRATION_METRICS) {
    const band = rows.bands.find((b) => b.metric === metric)
    const learned = band === undefined ? null : cutsOf(metric, band.learnedCuts)
    const override = band === undefined || learned === null ? null : cutsOf(metric, band.overrideCuts)
    const cuts = effectiveCuts(learned ?? startCuts(metric, maxBpmByAge), override)
    // Faixa sem nenhum corte (atividade antes do 3º dia) não vira linha.
    if (Object.values(cuts).every((v) => v === null)) continue
    views[metric] = {
      zone: zoneOf(metric, VALUE_OF[metric](metrics), cuts),
      cuts,
      source: override !== null ? 'OVERRIDE' : learned !== null ? 'LEARNED' : 'START',
    }
  }

  const calibration = rows.calibration
  return {
    version: calibration?.version ?? CALIBRATION_VERSION,
    phase: calibration !== null && calibration.validDays >= FULL_DAYS ? 'CALIBRATED' : 'CALIBRATING',
    recalibrating: calibration?.recalibrating ?? false,
    day: calibrationDayOf(calibration),
    metrics: views,
  }
}
