// O que a calibração individual acrescenta aos cards do perfil: a zona em que
// o valor de agora cai (selo) e a faixa da pessoa em vigor (frase). Função
// pura, no molde do vitalsView: corte nulo some da frase, faixa sem nenhum
// corte não vira frase, e o selo da fase sai daqui para o sourceBadgeOf.
import type { StatusTagStatus } from '@kavicki/swi-design-system'
import type {
  ActivityZone,
  CalibrationMetric,
  Cuts,
  StateZone,
  WorkerCalibration,
} from '@/services/api/telemetry'

export type ZoneTag = {
  label: string
  status: Extract<StatusTagStatus, 'accept' | 'info' | 'canceled'>
}

/** Zona e faixa de uma medição como o card desenha: cada uma pode faltar. */
export type CalibrationLine = { zone: ZoneTag | null; limits: string | null }

export const EMPTY_LINE: CalibrationLine = { zone: null, limits: null }

const ZONE_TAGS: Record<StateZone | ActivityZone, ZoneTag> = {
  EXCELLENCE: { label: 'Excelência', status: 'accept' },
  NORMAL: { label: 'Normal', status: 'info' },
  FATIGUE: { label: 'Fadiga', status: 'canceled' },
  // Atividade fora do habitual não é juízo de saúde: as três ficam neutras.
  BELOW: { label: 'Abaixo do habitual', status: 'info' },
  USUAL: { label: 'Habitual', status: 'info' },
  ABOVE: { label: 'Acima do habitual', status: 'info' },
}

export function zoneTagOf(zone: StateZone | ActivityZone | null): ZoneTag | null {
  return zone === null ? null : ZONE_TAGS[zone]
}

// Números em pt-BR, com vírgula e ponto de milhar.
const fmt = (n: number, digits: number, fixed = false) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: fixed ? digits : 0,
    maximumFractionDigits: digits,
  })
const integer = (n: number) => fmt(n, 0)
const percent = (n: number) => `${fmt(n, 1)}%`
const celsius = (n: number) => fmt(n, 1, true)
const km = (m: number) => fmt(m / 1000, 1, true)

const cut = (cuts: Cuts, key: string): number | null => {
  const value = cuts[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const join = (parts: (string | null)[]): string | null => {
  const present = parts.filter((p): p is string => p !== null)
  return present.length === 0 ? null : present.join(', ')
}

/**
 * Medição de estado com excelência e fadiga. `rising` diz para que lado a
 * fadiga cresce: batimento, esforço e desgaste sobem; oxigenação desce.
 */
function stateLabel(cuts: Cuts, format: (n: number) => string, rising: boolean): string | null {
  const excellence = cut(cuts, 'excellence')
  const fatigue = cut(cuts, 'fatigue')
  return join([
    excellence === null
      ? null
      : `excelência ${rising ? 'até' : 'a partir de'} ${format(excellence)}`,
    fatigue === null ? null : `fadiga ${rising ? 'a partir de' : 'abaixo de'} ${format(fatigue)}`,
  ])
}

type Parts = { n: string; unit: string }

const withUnit = ({ n, unit }: Parts) => (unit === '' ? n : `${n} ${unit}`)

/**
 * Faixa habitual de atividade ("habitual: 8 a 11 mil passos"). `format`
 * devolve o número e a escala separados para a escala comum aparecer uma vez
 * só; `tail` fecha a frase uma vez ("passos", "/min").
 */
function activityLabel(cuts: Cuts, format: (n: number) => Parts, tail = ''): string | null {
  const below = cut(cuts, 'below')
  const above = cut(cuts, 'above')
  let range: string
  if (below !== null && above !== null) {
    const b = format(below)
    const a = format(above)
    range = `${b.unit === a.unit ? b.n : withUnit(b)} a ${withUnit(a)}`
  } else if (below !== null) range = `a partir de ${withUnit(format(below))}`
  else if (above !== null) range = `até ${withUnit(format(above))}`
  else return null
  return `habitual: ${range}${tail}`
}

// Abaixo de mil, o número cheio; de mil para cima, "8 mil", "10,5 mil".
const stepsParts = (n: number): Parts => {
  const rounded = Math.round(n)
  return rounded < 1000
    ? { n: integer(rounded), unit: '' }
    : { n: fmt(rounded / 1000, 1), unit: 'mil' }
}

/**
 * Temperatura: o habitual é p25 a p75. Sem um dos dois, aquele lado cai para
 * p10 ou p90 (a borda mais larga ainda descreve a faixa); sem nenhum do lado,
 * a frase fica só com o outro.
 */
function temperatureLabel(cuts: Cuts): string | null {
  const low = cut(cuts, 'p25') ?? cut(cuts, 'p10')
  const high = cut(cuts, 'p75') ?? cut(cuts, 'p90')
  if (low !== null && high !== null) return `habitual de ${celsius(low)} a ${celsius(high)} °C`
  if (low !== null) return `habitual a partir de ${celsius(low)} °C`
  if (high !== null) return `habitual até ${celsius(high)} °C`
  return null
}

export function limitsLabelOf(metric: CalibrationMetric, cuts: Cuts): string | null {
  switch (metric) {
    case 'HEART_RATE':
    case 'SYSTOLIC':
    case 'DIASTOLIC':
      return stateLabel(cuts, integer, true)
    case 'OXYGEN_SATURATION':
      return stateLabel(cuts, percent, false)
    case 'EFFORT':
    case 'WEAR':
      return stateLabel(cuts, percent, true)
    case 'BODY_TEMPERATURE':
      return temperatureLabel(cuts)
    case 'STEPS':
      return activityLabel(cuts, stepsParts, ' passos')
    case 'DISTANCE':
      return activityLabel(cuts, (m) => ({ n: km(m), unit: 'km' }))
    case 'ACTIVE_ENERGY':
      return activityLabel(cuts, (n) => ({ n: integer(n), unit: 'kcal' }))
    case 'MOVEMENT':
      // "/min" cola no número: "30 a 52/min".
      return activityLabel(cuts, (n) => ({ n: integer(n), unit: '' }), '/min')
  }
}

/**
 * Pressão num card só, no molde do batimento ("excelência até 118/76, fadiga
 * a partir de 135/88"). Cada corte decide sozinho: faltando um lado, fica só
 * o outro, com o nome para não parecer a pressão inteira.
 */
export function pressureLimitsLabel(systolic: Cuts | null, diastolic: Cuts | null): string | null {
  const pair = (key: string, prefix: string): string | null => {
    const sys = systolic === null ? null : cut(systolic, key)
    const dia = diastolic === null ? null : cut(diastolic, key)
    if (sys !== null && dia !== null) return `${prefix} ${integer(sys)}/${integer(dia)}`
    if (sys !== null) return `${prefix} sistólica ${integer(sys)}`
    if (dia !== null) return `${prefix} diastólica ${integer(dia)}`
    return null
  }
  return join([pair('excellence', 'excelência até'), pair('fatigue', 'fadiga a partir de')])
}

const STATE_RANK: Record<StateZone, number> = { EXCELLENCE: 0, NORMAL: 1, FATIGUE: 2 }

/** A pior de duas zonas de estado (fadiga > normal > excelência); nula não conta. */
export function worseStateZone(a: StateZone | null, b: StateZone | null): StateZone | null {
  if (a === null) return b
  if (b === null) return a
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b
}

const stateZoneOf = (zone: unknown): StateZone | null =>
  zone === 'EXCELLENCE' || zone === 'NORMAL' || zone === 'FATIGUE' ? zone : null

/**
 * Zona e faixa de uma medição. `withZone: false` nos totais do dia (passos,
 * distância, calorias): o dia ainda corre, então só a faixa habitual vale.
 */
export function calibrationLineOf(
  calibration: WorkerCalibration | null | undefined,
  metric: CalibrationMetric,
  { withZone = true }: { withZone?: boolean } = {},
): CalibrationLine {
  const view = calibration?.metrics[metric]
  if (!view) return EMPTY_LINE
  return {
    zone: withZone ? zoneTagOf(view.zone) : null,
    limits: limitsLabelOf(metric, view.cuts),
  }
}

/** Pressão: a pior das zonas de sistólica e diastólica e a frase conjunta. */
export function pressureLineOf(calibration: WorkerCalibration | null | undefined): CalibrationLine {
  const sys = calibration?.metrics.SYSTOLIC
  const dia = calibration?.metrics.DIASTOLIC
  if (!sys && !dia) return EMPTY_LINE
  return {
    zone: zoneTagOf(worseStateZone(stateZoneOf(sys?.zone), stateZoneOf(dia?.zone))),
    limits: pressureLimitsLabel(sys?.cuts ?? null, dia?.cuts ?? null),
  }
}

export const calibratingLabel = (day: number) => `Calibrando, dia ${day} de 30`
export const recalibratingLabel = (day: number) => `Recalibrando: novo aparelho, dia ${day} de 30`

/** Selo da fase: só enquanto calibra (dia N de 30); calibrado não leva selo. */
export function calibrationBadgeOf(
  calibration: WorkerCalibration | null | undefined,
): string | null {
  if (!calibration || calibration.day === null) return null
  return calibration.recalibrating
    ? recalibratingLabel(calibration.day)
    : calibratingLabel(calibration.day)
}
