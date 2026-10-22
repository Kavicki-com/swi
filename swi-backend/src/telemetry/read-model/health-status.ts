import { HOUR, ageMs } from '../domain/metric-state'
import type { MetricState } from '../domain/telemetry.types'
import { CONDITION_METRIC, type ActiveCondition, type WorkerTelemetry } from './telemetry-projector'

// Estado de saúde de uma pessoa, a mesma régua do painel e do app (ADR-0011).
// Só existe com batimento válido: sem ele a cor afirmaria o agora com dado
// velho, e o estado é neutro. A condição aberta continua em Alertas e nas
// notificações; o que ela perde é a cor. Condição só de aparelho não entra,
// porque relógio descarregado não é pessoa em risco.

export type HealthStatus = 'good' | 'alert' | 'low' | 'unknown'

/**
 * O Health Connect chega em lote: 60 min cobrem o ciclo de 30 min do app do
 * fabricante e a rodada de 15 min do segundo plano. Apple Watch e Bluetooth
 * são ao vivo e só valem atuais.
 */
export const HEALTH_CONNECT_VALID_HEART_RATE_MS = HOUR

export function hasValidHeartRate(heartRate: MetricState<number>, now: Date | string): boolean {
  if (heartRate.value === null || heartRate.measuredAt === null) return false
  if (heartRate.quality === 'CURRENT') return true
  return heartRate.source === 'HEALTH_CONNECT' && ageMs(heartRate.measuredAt, now) <= HEALTH_CONNECT_VALID_HEART_RATE_MS
}

/**
 * Por quanto tempo a medição avulsa sustenta a cor. São prazos só da cor: a
 * régua de exibição (recente até 24 h, histórica até 72 h) não muda.
 */
export const SPOT_CONDITION_PAINTS_MS = {
  oxygenSaturation: 12 * HOUR,
  bloodPressure: 6 * HOUR,
} as const

/**
 * Se a condição ainda pinta. Batimento e desgaste vão junto com o batimento
 * válido, que o estado já exige; oxigenação e pressão, pelo prazo próprio
 * contado da medição. Aparelho nunca chega aqui.
 */
export function conditionPaints(condition: ActiveCondition, now: Date | string): boolean {
  const metric = CONDITION_METRIC[condition.kind]
  if (metric !== 'oxygenSaturation' && metric !== 'bloodPressure') return true
  return condition.measuredAt !== null && ageMs(condition.measuredAt, now) <= SPOT_CONDITION_PAINTS_MS[metric]
}

export function healthStatusOf(telemetry: WorkerTelemetry): HealthStatus {
  if (!hasValidHeartRate(telemetry.metrics.heartRate, telemetry.observedAt)) return 'unknown'
  const painting = telemetry.conditions.filter((c) => conditionPaints(c, telemetry.observedAt))
  const categories = new Set(painting.map((c) => c.category))
  if (categories.has('URGENT')) return 'low'
  if (categories.has('HEALTH')) return 'alert'
  return 'good'
}
