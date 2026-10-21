// Campos, rótulos e conversões da página "Faixas e travas". Funções puras: o
// texto digitado vira corte (vírgula ou ponto como decimal), os cortes viram
// texto para o campo, e o JSON livre do histórico vira frase legível. A
// conferência local espelha o backend só na ordem dos cortes; o resto
// (limites plausíveis, faixa de 0 a 100) fica com a recusa do servidor.
import type {
  CalibrationChangeAction,
  CalibrationHistoryItem,
  CalibrationMetric,
  Cuts,
  SafetyRule,
  SafetyValues,
} from '@/services/api/calibration'
import { limitsLabelOf } from '@/services/vitals/calibrationView'

export const METRIC_TITLES: Record<CalibrationMetric, string> = {
  HEART_RATE: 'Batimento cardíaco',
  OXYGEN_SATURATION: 'Oxigenação',
  BODY_TEMPERATURE: 'Temperatura corporal',
  SYSTOLIC: 'Pressão sistólica',
  DIASTOLIC: 'Pressão diastólica',
  EFFORT: 'Esforço',
  WEAR: 'Desgaste',
  STEPS: 'Passos',
  DISTANCE: 'Distância',
  ACTIVE_ENERGY: 'Gasto calórico',
  MOVEMENT: 'Movimento por minuto',
}

const METRIC_UNITS: Record<CalibrationMetric, string> = {
  HEART_RATE: 'bpm',
  OXYGEN_SATURATION: '%',
  BODY_TEMPERATURE: '°C',
  SYSTOLIC: 'mmHg',
  DIASTOLIC: 'mmHg',
  EFFORT: '%',
  WEAR: '%',
  STEPS: 'passos',
  // O campo fala em km, como o perfil; a API guarda metros (ver SCALES).
  DISTANCE: 'km',
  ACTIVE_ENERGY: 'kcal',
  MOVEMENT: 'por minuto',
}

/**
 * Quantas unidades da API cabem numa unidade do campo. Só a distância muda de
 * escala: o gestor digita km e a API recebe e devolve metros. A conversão
 * mora só aqui, na fronteira entre o campo e o corte.
 */
const SCALES: Partial<Record<CalibrationMetric, { factor: number; digits: number }>> = {
  // Três casas em km preservam o metro inteiro na volta.
  DISTANCE: { factor: 1000, digits: 3 },
}

const scaleOf = (metric: CalibrationMetric) => SCALES[metric] ?? { factor: 1, digits: 2 }

/** Do campo para a API, sem ruído de ponto flutuante (1,1 km = 1100 m). */
const toApi = (metric: CalibrationMetric, value: number) => {
  const { factor } = scaleOf(metric)
  return factor === 1 ? value : Math.round(value * factor * 1000) / 1000
}

export type Field = { key: string; label: string }

type Family = 'rising' | 'falling' | 'temperature' | 'activity'

const familyOf = (metric: CalibrationMetric): Family => {
  switch (metric) {
    case 'OXYGEN_SATURATION':
      return 'falling'
    case 'BODY_TEMPERATURE':
      return 'temperature'
    case 'STEPS':
    case 'DISTANCE':
    case 'ACTIVE_ENERGY':
    case 'MOVEMENT':
      return 'activity'
    default:
      return 'rising'
  }
}

// Ordem das chaves igual à do backend (CUT_KEYS): o PUT manda todas.
const FAMILY_FIELDS: Record<Family, Field[]> = {
  rising: [
    { key: 'excellence', label: 'Excelência até' },
    { key: 'fatigue', label: 'Fadiga a partir de' },
  ],
  falling: [
    { key: 'excellence', label: 'Excelência a partir de' },
    { key: 'fatigue', label: 'Fadiga abaixo de' },
  ],
  // Fora de p10..p90 é fadiga; dentro de p25..p75, excelência.
  temperature: [
    { key: 'p10', label: 'Fadiga abaixo de (p10)' },
    { key: 'p25', label: 'Excelência a partir de (p25)' },
    { key: 'p75', label: 'Excelência até (p75)' },
    { key: 'p90', label: 'Fadiga acima de (p90)' },
  ],
  activity: [
    { key: 'below', label: 'Habitual a partir de' },
    { key: 'above', label: 'Habitual até' },
  ],
}

export function cutFieldsOf(metric: CalibrationMetric): Field[] {
  const unit = METRIC_UNITS[metric]
  return FAMILY_FIELDS[familyOf(metric)].map((f) => ({ ...f, label: `${f.label} (${unit})` }))
}

/** Texto do campo: vazio é nulo; vírgula ou ponto separam o decimal. */
export function parseDecimal(text: string): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) return 'invalid'
  return Number(trimmed.replace(',', '.'))
}

/** Número para o campo: vírgula decimal, sem ponto de milhar (que viraria decimal na volta). */
export function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: digits })
}

export type Draft = Record<string, string>
export type Errors = Record<string, string>

/** Cortes da API (metros na distância) como o campo mostra (km). */
export function draftOfCuts(metric: CalibrationMetric, cuts: Cuts): Draft {
  const { factor, digits } = scaleOf(metric)
  return Object.fromEntries(
    cutFieldsOf(metric).map((f) => {
      const value = cuts[f.key]
      const shown = typeof value === 'number' ? value / factor : value
      return [f.key, formatDecimal(shown, digits)]
    }),
  )
}

const NOT_A_NUMBER = 'Informe um número, ou deixe em branco para desligar o corte.'
const TEMPERATURE_KEYS = ['p10', 'p25', 'p75', 'p90'] as const

/** A primeira quebra de ordem, no campo de baixo do par; nula quando a ordem serve. */
function orderError(metric: CalibrationMetric, cuts: Record<string, number | null>): Errors | null {
  const family = familyOf(metric)
  if (family === 'temperature') {
    // p10 <= p25 < p75 <= p90 entre os informados: a faixa normal não fica vazia.
    for (let i = 0; i < TEMPERATURE_KEYS.length; i++) {
      for (let j = i + 1; j < TEMPERATURE_KEYS.length; j++) {
        const a = cuts[TEMPERATURE_KEYS[i]!] ?? null
        const b = cuts[TEMPERATURE_KEYS[j]!] ?? null
        if (a === null || b === null) continue
        const strict = i < 2 && j >= 2
        if (strict ? a >= b : a > b) {
          return {
            [TEMPERATURE_KEYS[j]!]:
              'Os cortes da temperatura devem seguir p10 <= p25 < p75 <= p90.',
          }
        }
      }
    }
    return null
  }
  if (family === 'activity') {
    const below = cuts.below ?? null
    const above = cuts.above ?? null
    if (below !== null && above !== null && below >= above) {
      return { above: 'O começo do habitual deve ficar abaixo do fim.' }
    }
    return null
  }
  const excellence = cuts.excellence ?? null
  const fatigue = cuts.fatigue ?? null
  if (excellence === null || fatigue === null) return null
  if (family === 'rising' && excellence >= fatigue) {
    return { fatigue: 'O corte de excelência deve ficar abaixo do de fadiga.' }
  }
  if (family === 'falling' && fatigue >= excellence) {
    return { fatigue: 'O corte de fadiga deve ficar abaixo do de excelência.' }
  }
  return null
}

export function cutsFromDraft(
  metric: CalibrationMetric,
  draft: Draft,
): { cuts: Cuts } | { errors: Errors } {
  const cuts: Record<string, number | null> = {}
  const errors: Errors = {}
  for (const { key } of cutFieldsOf(metric)) {
    const value = parseDecimal(draft[key] ?? '')
    if (value === 'invalid') errors[key] = NOT_A_NUMBER
    else cuts[key] = value === null ? null : toApi(metric, value)
  }
  if (Object.keys(errors).length > 0) return { errors }
  const order = orderError(metric, cuts)
  return order === null ? { cuts } : { errors: order }
}

// Travas

export const SAFETY_TITLES: Record<SafetyRule, string> = {
  HEART_RATE_HIGH: 'Batimento alto',
  HEART_RATE_LOW: 'Batimento baixo',
  OXYGEN_LOW: 'Oxigenação baixa',
  BLOOD_PRESSURE_HIGH: 'Pressão alta',
  WEAR_HIGH: 'Desgaste alto',
}

const SAFETY_UNITS: Record<Exclude<SafetyRule, 'BLOOD_PRESSURE_HIGH'>, string> = {
  HEART_RATE_HIGH: 'bpm',
  HEART_RATE_LOW: 'bpm',
  OXYGEN_LOW: '%',
  WEAR_HIGH: '%',
}

const PRESSURE_FIELDS: Field[] = [
  { key: 'systolicAt', label: 'Abre com sistólica a partir de (mmHg)' },
  { key: 'diastolicAt', label: 'Abre com diastólica a partir de (mmHg)' },
  { key: 'systolicRecoverBelow', label: 'Fecha com sistólica abaixo de (mmHg)' },
  { key: 'diastolicRecoverBelow', label: 'Fecha com diastólica abaixo de (mmHg)' },
]

export function safetyFieldsOf(rule: SafetyRule): Field[] {
  if (rule === 'BLOOD_PRESSURE_HIGH') return PRESSURE_FIELDS
  const unit = SAFETY_UNITS[rule]
  return [
    { key: 'openAt', label: `Abre em (${unit})` },
    { key: 'closeAt', label: `Fecha em (${unit})` },
  ]
}

export function draftOfSafety(rule: SafetyRule, values: SafetyValues): Draft {
  const record = values as unknown as Record<string, number | null>
  return Object.fromEntries(safetyFieldsOf(rule).map((f) => [f.key, formatDecimal(record[f.key])]))
}

/** A trava precisa de todos os valores; a plausibilidade fica com o backend. */
export function safetyFromDraft(
  rule: SafetyRule,
  draft: Draft,
): { values: SafetyValues } | { errors: Errors } {
  const out: Record<string, number> = {}
  const errors: Errors = {}
  for (const { key } of safetyFieldsOf(rule)) {
    const value = parseDecimal(draft[key] ?? '')
    if (typeof value === 'number') out[key] = value
    else errors[key] = 'Informe um número.'
  }
  if (Object.keys(errors).length > 0) return { errors }
  return { values: out as unknown as SafetyValues }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const numbersOf = (json: unknown, keys: string[]): number[] | null => {
  if (!isRecord(json)) return null
  const values = keys.map((k) => json[k])
  return values.every((v): v is number => typeof v === 'number' && Number.isFinite(v))
    ? values
    : null
}

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Valores de uma trava em frase; nulo quando o JSON não tem o formato da regra. */
export function safetyValuesLabel(rule: SafetyRule, values: unknown): string | null {
  if (rule === 'BLOOD_PRESSURE_HIGH') {
    const p = numbersOf(
      values,
      PRESSURE_FIELDS.map((f) => f.key),
    )
    if (p === null) return null
    const [sys, dia, sysBelow, diaBelow] = p.map(num)
    return `abre com ${sys}/${dia} mmHg, fecha abaixo de ${sysBelow}/${diaBelow} mmHg`
  }
  const band = numbersOf(values, ['openAt', 'closeAt'])
  if (band === null) return null
  const unit = SAFETY_UNITS[rule]
  const withUnit = (n: number) => (unit === '%' ? `${num(n)}%` : `${num(n)} ${unit}`)
  return `abre em ${withUnit(band[0]!)}, fecha em ${withUnit(band[1]!)}`
}

// Histórico

export const ACTION_LABELS: Record<CalibrationChangeAction, string> = {
  BAND_OVERRIDE: 'Faixa corrigida',
  BAND_REVERT: 'Faixa voltou ao aprendido',
  SAFETY_SET: 'Trava personalizada',
  SAFETY_REVERT: 'Trava voltou ao padrão',
  RECALIBRATE_DEVICE: 'Recalibração por troca de aparelho',
}

const DEVICE_FAMILIES: Record<string, string> = { WATCH: 'Relógio', BAND: 'Pulseira' }

const UNREADABLE = 'valor ilegível'

/** De onde para onde, em texto, lendo o JSON livre com desconfiança. */
export function changeValueLabel(item: CalibrationHistoryItem, side: 'from' | 'to'): string {
  const value = item[side]
  switch (item.action) {
    case 'BAND_OVERRIDE':
    case 'BAND_REVERT':
      if (value === null) return 'aprendido'
      if (!isRecord(value) || item.metric === null) return UNREADABLE
      return limitsLabelOf(item.metric, value as Cuts) ?? 'sem cortes'
    case 'SAFETY_SET':
    case 'SAFETY_REVERT':
      if (value === null) return 'padrão'
      if (item.rule === null) return UNREADABLE
      return safetyValuesLabel(item.rule, value) ?? UNREADABLE
    case 'RECALIBRATE_DEVICE': {
      if (!isRecord(value)) return UNREADABLE
      const family = value.deviceFamily
      if (family === null || family === undefined) return 'sem aparelho'
      return (typeof family === 'string' && DEVICE_FAMILIES[family]) || 'aparelho desconhecido'
    }
    default:
      return UNREADABLE
  }
}

/** Sobre o que foi a mudança: a medição, a trava ou nada (troca de aparelho). */
export function changeTargetOf(item: CalibrationHistoryItem): string | null {
  if (item.metric !== null) return METRIC_TITLES[item.metric] ?? null
  if (item.rule !== null) return SAFETY_TITLES[item.rule] ?? null
  return null
}

export function actorLabelOf(item: CalibrationHistoryItem): string {
  // A troca de aparelho vem do recálculo, sem pessoa por trás.
  if (item.actor === null) {
    return item.action === 'RECALIBRATE_DEVICE' ? 'Sistema' : 'Pessoa removida'
  }
  return item.actor.name.trim() === '' ? 'Pessoa removida' : item.actor.name
}
