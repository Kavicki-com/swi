// Calibração individual pelo painel (telemetry/v1/workers/:id/calibration):
// ler a régua da pessoa, as faixas por medição e as travas; corrigir uma faixa
// (admin e supervisor) ou uma trava (só admin); e ler o histórico de mudanças.
// Os tipos espelham calibration-admin.service.ts do backend. Toda escrita
// devolve o detalhe já atualizado, e remover o que não existe responde o
// detalhe como está.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'
import type { CalibrationMetric, Cuts } from './telemetry'

export type { CalibrationMetric, Cuts } from './telemetry'

/** Espelha o enum SafetyRule do backend: as travas que o admin muda por funcionário. */
export type SafetyRule =
  | 'HEART_RATE_HIGH'
  | 'HEART_RATE_LOW'
  | 'OXYGEN_LOW'
  | 'BLOOD_PRESSURE_HIGH'
  | 'WEAR_HIGH'

/** Trava de um número: abre em `openAt`, fecha ao passar de volta por `closeAt`. */
export type SafetyBand = { openAt: number; closeAt: number }

/** Trava da pressão: abre com sistólica ou diastólica no limite, fecha com as duas abaixo. */
export type PressureSafety = {
  systolicAt: number
  diastolicAt: number
  systolicRecoverBelow: number
  diastolicRecoverBelow: number
}

export type SafetyValues = SafetyBand | PressureSafety

export type CalibrationMetricDetail = {
  metric: CalibrationMetric
  validDays: number
  start: Cuts
  learned: Cuts
  override: Cuts | null
  effective: Cuts
  /** De onde vem o efetivo: correção do gestor, aprendido, ou partida v1.0 sem recálculo ainda. */
  source: 'OVERRIDE' | 'LEARNED' | 'START'
}

export type SafetyDetail = {
  rule: SafetyRule
  defaultLabel: string
  defaultValues: SafetyValues
  effective: SafetyValues
  custom: boolean
  /** ISO-8601 da trava personalizada; null quando vale o padrão. */
  updatedAt: string | null
}

/** Espelha o enum CalibrationDeviceFamily do backend: relógio ou pulseira. */
export type CalibrationDeviceFamily = 'WATCH' | 'BAND'

export type CalibrationDetail = {
  workerId: string
  version: string | null
  phase: 'CALIBRATING' | 'CALIBRATED'
  /** Dia N de 30 enquanto calibra; nulo depois. */
  day: number | null
  recalibrating: boolean
  /** Família do aparelho que a calibração mediu; nula antes do primeiro recálculo. */
  deviceFamily: CalibrationDeviceFamily | null
  ruler: {
    restingBpm: number | null
    peakBpm: number | null
    peakPersonalBpm: number | null
    peakStartBpm: number | null
    maxBpmByAge: number | null
  }
  metrics: CalibrationMetricDetail[]
  safety: SafetyDetail[]
}

/** Espelha o enum CalibrationChangeAction do backend. */
export type CalibrationChangeAction =
  | 'BAND_OVERRIDE'
  | 'BAND_REVERT'
  | 'SAFETY_SET'
  | 'SAFETY_REVERT'
  | 'RECALIBRATE_DEVICE'

export type CalibrationHistoryItem = {
  id: string
  action: CalibrationChangeAction
  metric: CalibrationMetric | null
  rule: SafetyRule | null
  /**
   * JSON gravado antes e depois da mudança (cortes, valores da trava ou nulo).
   * Fica `unknown` de propósito: quem mostra lê com desconfiança, como o backend.
   */
  from: unknown
  to: unknown
  /** Quem fez; nome vazio quando a pessoa foi apagada depois. */
  actor: { id: string; name: string } | null
  /** ISO-8601. */
  at: string
}

export type CalibrationHistoryPage = {
  items: CalibrationHistoryItem[]
  /** null quando não há próxima página. */
  nextCursor: string | null
}

// Falha vira erro com mensagem, nunca detalhe vazio: a recusa do servidor
// (corte fora de ordem, trava implausível) chega com o texto dele.
async function call<T>(work: () => Promise<T>, fallback: string): Promise<ServiceResponse<T>> {
  try {
    return { data: await work(), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : fallback } }
  }
}

const id = (value: string) => encodeURIComponent(value)
const base = (workerId: string) => `/telemetry/v1/workers/${id(workerId)}/calibration`

export const calibrationApi = {
  detail: (workerId: string): Promise<ServiceResponse<CalibrationDetail>> =>
    call(() => apiFetch<CalibrationDetail>(base(workerId)), 'Falha ao carregar a calibração'),

  history: (workerId: string, cursor?: string): Promise<ServiceResponse<CalibrationHistoryPage>> =>
    call(
      () =>
        apiFetch<CalibrationHistoryPage>(
          `${base(workerId)}/history${cursor ? `?cursor=${id(cursor)}` : ''}`,
        ),
      'Falha ao carregar o histórico da calibração',
    ),

  setBand: (
    workerId: string,
    metric: CalibrationMetric,
    cuts: Cuts,
  ): Promise<ServiceResponse<CalibrationDetail>> =>
    call(
      () =>
        apiFetch<CalibrationDetail>(`${base(workerId)}/bands/${id(metric)}`, {
          method: 'PUT',
          body: JSON.stringify({ cuts }),
        }),
      'Falha ao corrigir a faixa',
    ),

  revertBand: (
    workerId: string,
    metric: CalibrationMetric,
  ): Promise<ServiceResponse<CalibrationDetail>> =>
    call(
      () =>
        apiFetch<CalibrationDetail>(`${base(workerId)}/bands/${id(metric)}`, { method: 'DELETE' }),
      'Falha ao remover a correção da faixa',
    ),

  setSafety: (
    workerId: string,
    rule: SafetyRule,
    values: SafetyValues,
  ): Promise<ServiceResponse<CalibrationDetail>> =>
    call(
      () =>
        apiFetch<CalibrationDetail>(`${base(workerId)}/safety/${id(rule)}`, {
          method: 'PUT',
          body: JSON.stringify({ values }),
        }),
      'Falha ao gravar a trava',
    ),

  revertSafety: (workerId: string, rule: SafetyRule): Promise<ServiceResponse<CalibrationDetail>> =>
    call(
      () =>
        apiFetch<CalibrationDetail>(`${base(workerId)}/safety/${id(rule)}`, { method: 'DELETE' }),
      'Falha ao remover a trava personalizada',
    ),
}
