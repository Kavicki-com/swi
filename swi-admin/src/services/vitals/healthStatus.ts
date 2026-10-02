// Estado de saúde de uma pessoa decidido só pelas condições abertas no
// backend, a mesma régua do app. Urgência e alerta de saúde valem mesmo com a
// leitura velha: esconder uma condição aberta seria pior que mostrá-la
// atrasada. "Bom" exige leitura atual, porque sem ela ninguém confirma que a
// pessoa está bem; condição só de aparelho não entra, porque relógio
// descarregado não é pessoa em risco.
import type { WorkerTelemetry } from '@/services/api/telemetry'

export type HealthStatus = 'good' | 'alert' | 'low' | 'unknown'

export function healthStatusFrom(telemetry: WorkerTelemetry | null): HealthStatus {
  if (telemetry === null) return 'unknown'
  const categories = new Set(telemetry.conditions.map((c) => c.category))
  if (categories.has('URGENT')) return 'low'
  if (categories.has('HEALTH')) return 'alert'
  return telemetry.metrics.heartRate.quality === 'CURRENT' ? 'good' : 'unknown'
}
