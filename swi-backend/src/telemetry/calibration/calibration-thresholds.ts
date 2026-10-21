import type { CalibrationMetric, Prisma, SafetyRule } from '@prisma/client'

import { safetyValuesOf, type SafetyValuesFor } from '../alerts/safety-limits'
import { CALIBRATION_METRICS, FULL_DAYS, cutsOf, effectiveCuts, startCutsV1, type Cuts } from './calibration-bands'

// O que o motor de condições lê da calibração de um funcionário: os cortes
// efetivos de cada medição, as travas do admin, o repouso calibrado e o dia da
// calibração que vai para a condição como selo. Leitura desconfiada, como a da
// régua do esforço: JSON torto vira "sem dado", nunca exceção no motor.

export type SafetyLimits = { readonly [R in SafetyRule]?: SafetyValuesFor<R> }

export interface CalibrationThresholds {
  /** Dia da calibração (1 a 30) enquanto ela não fecha; nulo depois do dia 30. */
  calibrationDay: number | null
  /** Corte efetivo por medição: o do gestor, o aprendido ou a partida v1.0. */
  cuts: Readonly<Record<CalibrationMetric, Cuts>>
  /** Só as travas que o admin gravou; sem linha vale o padrão do perfil. */
  safety: SafetyLimits
  restingBpm: number | null
}

/**
 * O dia em que a pessoa está: os dias válidos já fechados mais o de hoje. Sem
 * calibração nenhuma é o primeiro dia; com 30 dias válidos a calibração fechou
 * e o selo some.
 */
export function calibrationDayOf(calibration: { validDays: number } | null): number | null {
  if (calibration === null) return 1
  return calibration.validDays < FULL_DAYS ? calibration.validDays + 1 : null
}

export interface ThresholdRows {
  calibration: { validDays: number; restingBpm: number | null } | null
  bands: ReadonlyArray<{ metric: CalibrationMetric; learnedCuts: unknown; overrideCuts: unknown }>
  safety: ReadonlyArray<{ rule: SafetyRule; values: unknown }>
  maxBpmByAge: number | null
}

/**
 * Sem faixa gravada (ou com o aprendido ilegível) vale a partida v1.0, que é o
 * que a calibração usaria no primeiro dia. A correção do gestor só vale se for
 * legível; ilegível, cai no aprendido.
 */
export function thresholdsOf(rows: ThresholdRows): CalibrationThresholds {
  const byMetric = new Map(rows.bands.map((b) => [b.metric, b]))
  const cuts = Object.fromEntries(
    CALIBRATION_METRICS.map((metric) => {
      const band = byMetric.get(metric)
      const learned = band === undefined ? null : cutsOf(metric, band.learnedCuts)
      if (band === undefined || learned === null) return [metric, startCutsV1(metric, rows.maxBpmByAge)]
      return [metric, effectiveCuts(learned, cutsOf(metric, band.overrideCuts))]
    }),
  ) as Record<CalibrationMetric, Cuts>

  const safety: Record<string, unknown> = {}
  for (const row of rows.safety) {
    const values = safetyValuesOf(row.rule, row.values)
    if (values !== null) safety[row.rule] = values
  }

  return {
    calibrationDay: calibrationDayOf(rows.calibration),
    cuts,
    safety,
    restingBpm: rows.calibration?.restingBpm ?? null,
  }
}

/** Lê a calibração, as faixas e as travas do funcionário. Só faz sentido na origem REAL. */
export async function loadThresholds(
  tx: Prisma.TransactionClient,
  workerId: string,
  maxBpmByAge: number | null,
): Promise<CalibrationThresholds> {
  const [calibration, bands, safety] = await Promise.all([
    tx.workerCalibration.findUnique({ where: { workerId }, select: { validDays: true, restingBpm: true } }),
    tx.workerCalibrationBand.findMany({
      where: { workerId },
      select: { metric: true, learnedCuts: true, overrideCuts: true },
    }),
    tx.workerSafetyLimit.findMany({ where: { workerId }, select: { rule: true, values: true } }),
  ])
  return thresholdsOf({ calibration, bands, safety, maxBpmByAge })
}
