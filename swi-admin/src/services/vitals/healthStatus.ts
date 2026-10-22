// Estado de saúde de uma pessoa, a mesma tabela do app e do backend. Só existe
// com batimento válido: sem ele a cor afirmaria o agora com dado velho, e o
// estado é neutro. A condição aberta continua em Alertas e nas notificações; o
// que ela perde é a cor. Condição só de aparelho não entra, porque relógio
// descarregado não é pessoa em risco.
import type {
  ActiveCondition,
  ConditionKind,
  MetricState,
  WorkerTelemetry,
} from '@/services/api/telemetry'

export type HealthStatus = 'good' | 'alert' | 'low' | 'unknown'

const HOUR = 60 * 60_000

/**
 * O Health Connect chega em lote: 60 min cobrem o ciclo de 30 min do app do
 * fabricante e a rodada de 15 min do segundo plano. Apple Watch e Bluetooth
 * são ao vivo e só valem atuais.
 */
const HEALTH_CONNECT_VALID_HEART_RATE_MS = HOUR

/**
 * Por quanto tempo a medição avulsa sustenta a cor. São prazos só da cor: a
 * régua de exibição da medição não muda.
 */
const SPOT_CONDITION_PAINTS_MS = { oxygenSaturation: 12 * HOUR, bloodPressure: 6 * HOUR }

// A medição avulsa que sustenta cada condição. Batimento e desgaste vão junto
// com o batimento válido, que o estado já exige; aparelho nunca pinta.
const SPOT_METRIC: Readonly<Record<ConditionKind, keyof typeof SPOT_CONDITION_PAINTS_MS | null>> = {
  HEART_RATE_HIGH: null,
  HEART_RATE_LOW: null,
  HEART_RATE_FATIGUE: null,
  WEAR_HIGH: null,
  WEAR_FATIGUE: null,
  OXYGEN_LOW: 'oxygenSaturation',
  OXYGEN_FATIGUE: 'oxygenSaturation',
  BLOOD_PRESSURE_HIGH: 'bloodPressure',
  BLOOD_PRESSURE_REVIEW: 'bloodPressure',
  BLOOD_PRESSURE_FATIGUE: 'bloodPressure',
  DEVICE_BATTERY_LOW: null,
  DEVICE_SIGNAL_LOST: null,
  // Nasce encerrada, então nunca chega aberta à leitura.
  REPEATED_EPISODES: null,
}

const ageMs = (iso: string, now: string) => Date.parse(now) - Date.parse(iso)

// "Atual" (até 45 s) quem decide é o backend, na qualidade da métrica; o prazo
// do Health Connect conta do observedAt, o mesmo instante da qualidade.
function hasValidHeartRate(heartRate: MetricState<number>, now: string): boolean {
  if (heartRate.value === null || heartRate.measuredAt === null) return false
  if (heartRate.quality === 'CURRENT') return true
  return (
    heartRate.source === 'HEALTH_CONNECT' &&
    ageMs(heartRate.measuredAt, now) <= HEALTH_CONNECT_VALID_HEART_RATE_MS
  )
}

// Medição avulsa sem instante (backend anterior) não sustenta cor.
function conditionPaints(condition: ActiveCondition, now: string): boolean {
  const metric = SPOT_METRIC[condition.kind]
  if (metric === null) return true
  const at = condition.measuredAt ?? null
  return at !== null && ageMs(at, now) <= SPOT_CONDITION_PAINTS_MS[metric]
}

export function healthStatusFrom(telemetry: WorkerTelemetry | null): HealthStatus {
  if (telemetry === null) return 'unknown'
  const now = telemetry.observedAt
  if (!hasValidHeartRate(telemetry.metrics.heartRate, now)) return 'unknown'
  const painting = telemetry.conditions.filter((c) => conditionPaints(c, now))
  const categories = new Set(painting.map((c) => c.category))
  if (categories.has('URGENT')) return 'low'
  if (categories.has('HEALTH')) return 'alert'
  return 'good'
}
