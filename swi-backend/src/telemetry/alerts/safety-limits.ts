import type { SafetyRule } from '@prisma/client'
import { CALIBRATED_ALERT_PROFILE } from './alert-profile'

// Travas por funcionário (perfil swi-alert-calibrated-3): o piso de proteção
// que não aprende. Sem linha em WorkerSafetyLimit vale o padrão do perfil; com
// linha, o que o admin gravou. O JSON é lido com desconfiança, como os cortes
// da calibração: linha torta vira "sem trava personalizada", nunca exceção no
// motor de condições.

/** Trava de um número: abre em `openAt`, fecha ao passar de volta por `closeAt`. */
export interface SafetyBand {
  openAt: number
  closeAt: number
}

/** Trava da pressão: abre com sistólica ou diastólica no limite, fecha com as duas abaixo. */
export interface PressureSafety {
  systolicAt: number
  diastolicAt: number
  systolicRecoverBelow: number
  diastolicRecoverBelow: number
}

export type SafetyValuesFor<R extends SafetyRule> = R extends 'BLOOD_PRESSURE_HIGH' ? PressureSafety : SafetyBand
export type SafetyValues = SafetyBand | PressureSafety

const BAND_KEYS = ['openAt', 'closeAt'] as const
const PRESSURE_KEYS = ['systolicAt', 'diastolicAt', 'systolicRecoverBelow', 'diastolicRecoverBelow'] as const
const keysOf = (rule: SafetyRule): readonly string[] => (rule === 'BLOOD_PRESSURE_HIGH' ? PRESSURE_KEYS : BAND_KEYS)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Parser defensivo do JSON gravado. Campo ausente ou não numérico reprova. */
export function safetyValuesOf<R extends SafetyRule>(rule: R, json: unknown): SafetyValuesFor<R> | null {
  if (!isRecord(json)) return null
  const out: Record<string, number> = {}
  for (const key of keysOf(rule)) {
    const value = json[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    out[key] = value
  }
  return out as unknown as SafetyValuesFor<R>
}

type BandRule = Exclude<SafetyRule, 'BLOOD_PRESSURE_HIGH'>

/**
 * Faixa plausível da abertura e para que lado a recuperação fica. Trava de
 * alto fecha abaixo de onde abriu; trava de baixo, acima. Fora disso é número
 * digitado errado, e a rota recusa em vez de gravar uma trava que nunca abre
 * ou nunca fecha.
 */
const BAND_RANGES: Readonly<Record<BandRule, { label: string; min: number; max: number; closes: 'below' | 'above'; closeMax?: number }>> = {
  HEART_RATE_HIGH: { label: 'batimento alto', min: 100, max: 230, closes: 'below' },
  HEART_RATE_LOW: { label: 'batimento baixo', min: 30, max: 80, closes: 'above' },
  OXYGEN_LOW: { label: 'oxigenação baixa', min: 80, max: 95, closes: 'above', closeMax: 100 },
  WEAR_HIGH: { label: 'desgaste alto', min: 50, max: 100, closes: 'below' },
}

const PRESSURE_RANGES = { systolic: { min: 140, max: 240 }, diastolic: { min: 90, max: 140 } } as const

const outside = (value: number, range: { min: number; max: number }) => value < range.min || value > range.max

/**
 * Texto do erro para a rota, ou nulo quando os valores servem para a regra. Os
 * valores entram como `unknown` porque o corpo da rota é JSON qualquer: o
 * formato é conferido aqui, junto da plausibilidade.
 */
export function validateSafety(rule: SafetyRule, values: unknown): string | null {
  if (rule === 'BLOOD_PRESSURE_HIGH') {
    const p = safetyValuesOf(rule, values)
    if (p === null) return `Valores incompletos para a trava: informe ${PRESSURE_KEYS.join(', ')}.`
    if (outside(p.systolicAt, PRESSURE_RANGES.systolic)) return 'A sistólica da trava de pressão alta deve ficar entre 140 e 240.'
    if (outside(p.diastolicAt, PRESSURE_RANGES.diastolic)) return 'A diastólica da trava de pressão alta deve ficar entre 90 e 140.'
    if (p.systolicRecoverBelow >= p.systolicAt) return 'A sistólica de recuperação deve ficar abaixo da de abertura.'
    if (p.diastolicRecoverBelow >= p.diastolicAt) return 'A diastólica de recuperação deve ficar abaixo da de abertura.'
    return null
  }

  const band = safetyValuesOf(rule, values)
  if (band === null) return `Valores incompletos para a trava: informe ${BAND_KEYS.join(', ')}.`
  const range = BAND_RANGES[rule]
  if (outside(band.openAt, range)) return `A abertura da trava de ${range.label} deve ficar entre ${range.min} e ${range.max}.`
  if (range.closes === 'below' && band.closeAt >= band.openAt) {
    return `A recuperação da trava de ${range.label} deve ficar abaixo da abertura.`
  }
  if (range.closes === 'above' && band.closeAt <= band.openAt) {
    return `A recuperação da trava de ${range.label} deve ficar acima da abertura.`
  }
  if (range.closeMax !== undefined && band.closeAt > range.closeMax) {
    return `A recuperação da trava de ${range.label} não pode passar de ${range.closeMax}.`
  }
  return null
}

const percent = (fraction: number) => Math.round(fraction * 100)

/**
 * O padrão em texto, para o painel mostrar o que vale sem linha do admin. Em
 * texto e não em número porque as travas de batimento dependem da idade e do
 * repouso de cada pessoa. Sai dos números do perfil, para nunca divergir dele.
 */
export function defaultSafetyLabel(rule: SafetyRule): string {
  const p = CALIBRATED_ALERT_PROFILE
  switch (rule) {
    case 'HEART_RATE_HIGH':
      return `${percent(p.heartRateHigh.maxFraction)}% da máxima pela idade por ${p.persistence.windowMs / 1000} s (${p.heartRateHigh.floorBpm} bpm sem data de nascimento)`
    case 'HEART_RATE_LOW':
      return `${p.heartRateLow.belowRestingBpm} bpm abaixo do repouso, nunca abaixo de ${p.heartRateLow.floorBpm} bpm`
    case 'OXYGEN_LOW':
      return `abaixo de ${p.oxygenLow.openBelowPercent}%`
    case 'BLOOD_PRESSURE_HIGH':
      return `${p.bloodPressureHigh.systolicAt}/${p.bloodPressureHigh.diastolicAt} ou mais`
    case 'WEAR_HIGH':
      return `${p.wearHigh.openAtPercent}% ou mais`
  }
}
