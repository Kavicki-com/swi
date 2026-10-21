import type { CalibrationDeviceFamily, CalibrationMetric } from '@prisma/client'
import { median, percentile } from './percentile'

// Modelo das faixas da calibração individual (revisão 2.0 das regras,
// aprovada pelo cliente em 20/10/2026, com a partida mínima de 21/10/2026).
// Puro: o job lê os Resumos, chama daqui e grava. Mudar número aqui sem mudar
// CALIBRATION_VERSION é proibido.

export const CALIBRATION_VERSION = 'swi-calibration-2'
/** Dias válidos para a faixa ser só da pessoa. */
export const FULL_DAYS = 30
/** A parte pessoal entra na mistura a partir deste dia válido. */
export const PERSONAL_FROM_DAY = 3
/** Corte sem partida (só atividade) aparece a partir deste dia válido. */
export const NO_START_FROM_DAY = 3
/** Máxima de quem não tem data de nascimento: 208 - 0,7 x 40 anos. */
export const FALLBACK_MAX_BPM = 180
/** Depois dos 30 dias, quanto um corte anda por recálculo diário (cerca de 3% por semana). */
export const SLOW_STEP_FRACTION = 0.005
export const VALID_DAY_HEART_RATE_MS = 2 * 60 * 60 * 1000
export const MIN_SPOT_READINGS = 3
/** O pico habitual: o máximo que a pessoa atinge em 19 de cada 20 dias. */
export const PEAK_PERCENTILE = 95
/** Partida do corte de fadiga do desgaste e previsão sem banda: 80%. */
export const WEAR_FATIGUE_START = 80

export const CALIBRATION_METRICS = [
  'HEART_RATE',
  'OXYGEN_SATURATION',
  'BODY_TEMPERATURE',
  'SYSTOLIC',
  'DIASTOLIC',
  'EFFORT',
  'WEAR',
  'STEPS',
  'DISTANCE',
  'ACTIVE_ENERGY',
  'MOVEMENT',
] as const satisfies readonly CalibrationMetric[]

export type Cuts = Readonly<Record<string, number | null>>

export const CUT_KEYS: Readonly<Record<CalibrationMetric, readonly string[]>> = {
  HEART_RATE: ['excellence', 'fatigue'],
  OXYGEN_SATURATION: ['excellence', 'fatigue'],
  BODY_TEMPERATURE: ['p10', 'p25', 'p75', 'p90'],
  SYSTOLIC: ['excellence', 'fatigue'],
  DIASTOLIC: ['excellence', 'fatigue'],
  EFFORT: ['excellence', 'fatigue'],
  WEAR: ['excellence', 'fatigue'],
  STEPS: ['below', 'above'],
  DISTANCE: ['below', 'above'],
  ACTIVE_ENERGY: ['below', 'above'],
  MOVEMENT: ['below', 'above'],
}

/** Quanto maior, pior: excelência abaixo, fadiga acima. */
export const HIGHER_IS_WORSE: ReadonlySet<CalibrationMetric> = new Set<CalibrationMetric>([
  'HEART_RATE',
  'SYSTOLIC',
  'DIASTOLIC',
  'EFFORT',
  'WEAR',
])

/** O que o recálculo lê de um Resumo. Espelha as colunas do Resumo v3. */
export interface CalibrationDay {
  day: Date
  deviceFamily: CalibrationDeviceFamily | null
  heartRateCoveredMs: number | null
  heartRateMin: number | null
  heartRateMax: number | null
  heartRateP25: number | null
  heartRateP90: number | null
  oxygenSaturationP10: number | null
  oxygenSaturationP50: number | null
  oxygenSaturationCount: number | null
  bodyTemperatureP10: number | null
  bodyTemperatureP25: number | null
  bodyTemperatureP75: number | null
  bodyTemperatureP90: number | null
  bodyTemperatureCount: number | null
  systolicAvg: number | null
  diastolicAvg: number | null
  bloodPressureCount: number | null
  effortP25: number | null
  effortP90: number | null
  wearMax: number | null
  stepsTotal: number | null
  distanceTotalM: number | null
  activeEnergyKcalTotal: number | null
  movementPerMinuteMedian: number | null
}

const present = (...xs: (number | null)[]) => xs.every((x) => x !== null)

/** O dia tem a estatística que a medição usa. */
const HAS_STAT: Readonly<Record<CalibrationMetric, (d: CalibrationDay) => boolean>> = {
  HEART_RATE: (d) => present(d.heartRateP25, d.heartRateP90),
  OXYGEN_SATURATION: (d) => present(d.oxygenSaturationP10, d.oxygenSaturationP50),
  BODY_TEMPERATURE: (d) => present(d.bodyTemperatureP10, d.bodyTemperatureP25, d.bodyTemperatureP75, d.bodyTemperatureP90),
  SYSTOLIC: (d) => present(d.systolicAvg),
  DIASTOLIC: (d) => present(d.diastolicAvg),
  EFFORT: (d) => present(d.effortP25, d.effortP90),
  WEAR: (d) => present(d.wearMax),
  STEPS: (d) => present(d.stepsTotal),
  DISTANCE: (d) => present(d.distanceTotalM),
  ACTIVE_ENERGY: (d) => present(d.activeEnergyKcalTotal),
  MOVEMENT: (d) => present(d.movementPerMinuteMedian),
}

export function isValidDay(metric: CalibrationMetric, d: CalibrationDay): boolean {
  if (!HAS_STAT[metric](d)) return false
  switch (metric) {
    case 'SYSTOLIC':
    case 'DIASTOLIC':
      return (d.bloodPressureCount ?? 0) >= 1
    case 'OXYGEN_SATURATION':
      return (d.oxygenSaturationCount ?? 0) >= MIN_SPOT_READINGS
    case 'BODY_TEMPERATURE':
      return (d.bodyTemperatureCount ?? 0) >= MIN_SPOT_READINGS
    default:
      return (d.heartRateCoveredMs ?? 0) >= VALID_DAY_HEART_RATE_MS
  }
}

const col = (days: readonly CalibrationDay[], pick: (d: CalibrationDay) => number | null) =>
  days.flatMap((d) => {
    const v = pick(d)
    return v === null ? [] : [v]
  })

const ACTIVITY_TOTAL: Readonly<Partial<Record<CalibrationMetric, (d: CalibrationDay) => number | null>>> = {
  STEPS: (d) => d.stepsTotal,
  DISTANCE: (d) => d.distanceTotalM,
  ACTIVE_ENERGY: (d) => d.activeEnergyKcalTotal,
  MOVEMENT: (d) => d.movementPerMinuteMedian,
}

/** Valor pessoal dos dias válidos da janela (só os dias válidos da medição). */
export function personalCuts(metric: CalibrationMetric, days: readonly CalibrationDay[]): Cuts {
  switch (metric) {
    case 'HEART_RATE':
      return { excellence: median(col(days, (d) => d.heartRateP25)), fatigue: median(col(days, (d) => d.heartRateP90)) }
    case 'OXYGEN_SATURATION':
      return {
        excellence: median(col(days, (d) => d.oxygenSaturationP50)),
        fatigue: median(col(days, (d) => d.oxygenSaturationP10)),
      }
    case 'BODY_TEMPERATURE':
      return {
        p10: median(col(days, (d) => d.bodyTemperatureP10)),
        p25: median(col(days, (d) => d.bodyTemperatureP25)),
        p75: median(col(days, (d) => d.bodyTemperatureP75)),
        p90: median(col(days, (d) => d.bodyTemperatureP90)),
      }
    case 'SYSTOLIC':
    case 'DIASTOLIC': {
      const avgs = col(days, (d) => (metric === 'SYSTOLIC' ? d.systolicAvg : d.diastolicAvg))
      return { excellence: percentile(avgs, 25), fatigue: percentile(avgs, 90) }
    }
    case 'EFFORT':
      return { excellence: median(col(days, (d) => d.effortP25)), fatigue: median(col(days, (d) => d.effortP90)) }
    case 'WEAR': {
      const maxes = col(days, (d) => d.wearMax)
      return { excellence: percentile(maxes, 25), fatigue: percentile(maxes, 90) }
    }
    case 'STEPS':
    case 'DISTANCE':
    case 'ACTIVE_ENERGY':
    case 'MOVEMENT': {
      const totals = col(days, ACTIVITY_TOTAL[metric]!)
      return { below: percentile(totals, 25), above: percentile(totals, 75) }
    }
  }
}

export const nullCuts = (metric: CalibrationMetric): Cuts => Object.fromEntries(CUT_KEYS[metric].map((k) => [k, null]))

/**
 * Partida mínima (revisão 2.0, aprovada em 21/10/2026): referência geral de
 * adulto para todas as medições de estado, para a pessoa ter faixa desde a
 * primeira leitura. Atividade não tem habitual geral e fica sem partida.
 */
export function startCuts(metric: CalibrationMetric, maxBpmByAge: number | null): Cuts {
  const maxBpm = maxBpmByAge ?? FALLBACK_MAX_BPM
  switch (metric) {
    case 'HEART_RATE':
      return { excellence: 0.6 * maxBpm, fatigue: 0.9 * maxBpm }
    case 'OXYGEN_SATURATION':
      return { excellence: 95, fatigue: 92 }
    case 'BODY_TEMPERATURE':
      return { p10: 35.5, p25: 36.1, p75: 37.2, p90: 37.8 }
    case 'SYSTOLIC':
      return { excellence: 120, fatigue: 140 }
    case 'DIASTOLIC':
      return { excellence: 80, fatigue: 90 }
    case 'EFFORT':
      return { excellence: 40, fatigue: 80 }
    case 'WEAR':
      return { excellence: 40, fatigue: WEAR_FATIGUE_START }
    default:
      return nullCuts(metric)
  }
}

export function slowStep(previous: number | null, target: number): number {
  if (previous === null) return target
  const max = Math.abs(previous) * SLOW_STEP_FRACTION
  return Math.min(previous + max, Math.max(previous - max, target))
}

/**
 * Um corte no recálculo de hoje.
 * `validDays`: dias válidos da medição na fase. `personal`: valor da janela.
 * `start`: partida da fase (mínima ou faixa anterior à troca de aparelho), nula
 * quando não há. `previous`: o aprendido de ontem, nulo na primeira vez.
 */
export function nextCut(validDays: number, personal: number | null, start: number | null, previous: number | null): number | null {
  if (validDays >= FULL_DAYS) return personal === null ? previous : slowStep(previous, personal)
  if (start !== null) {
    if (validDays < PERSONAL_FROM_DAY || personal === null) return start
    const w = validDays / FULL_DAYS
    return w * personal + (1 - w) * start
  }
  return validDays >= NO_START_FROM_DAY ? personal : null
}

/** A faixa normal nunca fica vazia; corte fora de ordem não vale ainda. */
function guardOrder(metric: CalibrationMetric, c: Record<string, number | null>): Cuts {
  if (metric === 'BODY_TEMPERATURE') {
    const { p10, p25, p75, p90 } = c
    const ordered =
      p10 !== null && p25 !== null && p75 !== null && p90 !== null && p10 <= p25 && p25 <= p75 && p75 <= p90
    return ordered ? c : nullCuts(metric)
  }
  if (CUT_KEYS[metric][0] === 'below') {
    const { below, above } = c
    if (below !== null && above !== null && below > above) return { below: above, above: below }
    return c
  }
  const { excellence, fatigue } = c
  if (excellence === null || fatigue === null) return c
  const inverted = HIGHER_IS_WORSE.has(metric) ? excellence >= fatigue : excellence <= fatigue
  return inverted ? { ...c, excellence: null } : c
}

export function nextCuts(metric: CalibrationMetric, validDays: number, personal: Cuts, start: Cuts, previous: Cuts | null): Cuts {
  const out: Record<string, number | null> = {}
  for (const k of CUT_KEYS[metric]) {
    out[k] = nextCut(validDays, personal[k] ?? null, start[k] ?? null, previous?.[k] ?? null)
  }
  return guardOrder(metric, out)
}

/** Corte efetivo: o do gestor, se houver; senão o aprendido. */
export function effectiveCuts(learned: Cuts, override: Cuts | null): Cuts {
  return override ?? learned
}

/**
 * Corte de fadiga do desgaste que a previsão de fadiga mira. Fora de (0, 100]
 * volta para a partida: a previsão faz log(1 - alvo/100) e daria NaN.
 */
export function wearFatigueCutOf(band: { learned: Cuts; override: Cuts | null } | null): number {
  const fatigue = band === null ? null : effectiveCuts(band.learned, band.override).fatigue
  return fatigue !== null && fatigue !== undefined && fatigue > 0 && fatigue <= 100 ? fatigue : WEAR_FATIGUE_START
}

/** Parser defensivo do JSON de cortes gravado no banco. Chave ausente reprova. */
export function cutsOf(metric: CalibrationMetric, json: unknown): Cuts | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const raw = json as Record<string, unknown>
  const out: Record<string, number | null> = {}
  for (const k of CUT_KEYS[metric]) {
    if (!(k in raw)) return null
    const v = raw[k]
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return null
    out[k] = v
  }
  return out
}
