import type { WorkerTelemetry } from './telemetry-projector'

// Estado de saúde de uma pessoa decidido só pelas condições abertas, a mesma
// régua do painel e do app. Urgência e alerta de saúde valem mesmo com a
// leitura velha: esconder uma condição aberta seria pior que mostrá-la
// atrasada. "Bom" exige batimento atual, porque sem ele ninguém confirma que a
// pessoa está bem; condição só de aparelho não entra, porque relógio
// descarregado não é pessoa em risco.

export type HealthStatus = 'good' | 'alert' | 'low' | 'unknown'

export function healthStatusOf(telemetry: WorkerTelemetry): HealthStatus {
  const categories = new Set(telemetry.conditions.map((c) => c.category))
  if (categories.has('URGENT')) return 'low'
  if (categories.has('HEALTH')) return 'alert'
  return telemetry.metrics.heartRate.quality === 'CURRENT' ? 'good' : 'unknown'
}
