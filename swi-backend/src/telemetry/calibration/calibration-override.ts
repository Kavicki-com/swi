import type { CalibrationMetric } from '@prisma/client'
import { CUT_KEYS, HIGHER_IS_WORSE, cutsOf } from './calibration-bands'

// Conferência da correção do gestor antes de gravar. Puro: a rota chama daqui
// e responde 400 com o texto. A regra é a do recálculo (faixa normal nunca
// vazia), só que aqui o corte fora de ordem recusa em vez de ser descartado.

/** Medições em porcentagem: o corte fica entre 0 e 100. */
const PERCENT_METRICS: ReadonlySet<CalibrationMetric> = new Set<CalibrationMetric>(['OXYGEN_SATURATION', 'EFFORT', 'WEAR'])

/** Texto do erro para a rota, ou nulo quando os cortes servem para a medição. */
export function validateCuts(metric: CalibrationMetric, json: unknown): string | null {
  const keys = CUT_KEYS[metric]
  const cuts = cutsOf(metric, json)
  if (cuts === null) return `Cortes incompletos: informe ${keys.join(', ')} (número ou nulo).`
  const values = keys.map((k) => cuts[k])
  const set = values.filter((v): v is number => v !== null)
  if (set.length === 0) return 'Informe ao menos um corte. Para voltar ao aprendido, remova a correção.'
  if (PERCENT_METRICS.has(metric)) {
    if (set.some((v) => v < 0 || v > 100)) return 'Os cortes desta medição ficam entre 0 e 100.'
  } else if (set.some((v) => v < 0)) {
    return 'Os cortes não podem ser negativos.'
  }

  if (metric === 'BODY_TEMPERATURE') {
    // p10 <= p25 < p75 <= p90 entre os que vieram: a faixa normal (p25 a p75) não fica vazia.
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const a = values[i]
        const b = values[j]
        if (a === null || b === null) continue
        const strict = i < 2 && j >= 2
        if (strict ? a >= b : a > b) return 'Os cortes da temperatura devem seguir p10 <= p25 < p75 <= p90.'
      }
    }
    return null
  }
  if (keys[0] === 'below') {
    const { below, above } = cuts
    if (below !== null && above !== null && below >= above) return 'O corte de abaixo do habitual deve ficar abaixo do de acima.'
    return null
  }
  const { excellence, fatigue } = cuts
  if (excellence === null || fatigue === null) return null
  if (HIGHER_IS_WORSE.has(metric)) {
    if (excellence >= fatigue) return 'O corte de excelência deve ficar abaixo do de fadiga.'
  } else if (fatigue >= excellence) {
    return 'O corte de fadiga deve ficar abaixo do de excelência.'
  }
  return null
}
