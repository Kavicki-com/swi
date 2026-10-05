// Leitura da telemetria do piloto pelo painel (telemetry/v1). Os tipos espelham
// o contrato do backend (domain/telemetry.types.ts, read-model e a fila de
// alertas): cada métrica chega com valor, qualidade, instante e origem, e
// ausência é null, nunca zero.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'
import { notifyAlertTriaged } from '@/services/alerts/alertTriage'

export type TelemetryOrigin = 'REAL' | 'DEMO'

export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE'

export type MeasurementSource =
  | 'APPLE_WATCH'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  | 'DERIVED'

export type MetricState<T> = {
  value: T | null
  quality: MetricQuality
  /** ISO-8601 da medição; null quando não há valor. */
  measuredAt: string | null
  source: MeasurementSource | null
  unit: string
}

export type BloodPressure = { systolic: number; diastolic: number }

export type WorkerMetrics = {
  heartRate: MetricState<number>
  steps: MetricState<number>
  movementPerMinute: MetricState<number>
  activeEnergy: MetricState<number>
  energyRatePerHour: MetricState<number> & { calculating: boolean }
  battery: MetricState<number>
  bloodPressure: MetricState<BloodPressure>
  /** 0-100. */
  effort: MetricState<number>
  /** 0-100. */
  wear: MetricState<number>
  /** Acumulado do dia, em metros. */
  distance: MetricState<number>
  /** Medição pontual: "última medição às", nunca "atual". */
  oxygenSaturation: MetricState<number>
  /** Medição pontual vinda do app Saúde, em °C. */
  bodyTemperature: MetricState<number>
  /** Minutos até o alerta de desgaste no ritmo recente. */
  fatigueEtaMin: MetricState<number>
}

export type ConditionKind =
  | 'HEART_RATE_HIGH'
  | 'HEART_RATE_LOW'
  | 'BLOOD_PRESSURE_REVIEW'
  | 'DEVICE_BATTERY_LOW'
  | 'DEVICE_SIGNAL_LOST'
  | 'WEAR_HIGH'

/**
 * URGENT é batimento fora da faixa; HEALTH pede atenção sem urgência (desgaste
 * alto, revisar pressão); DEVICE é problema do aparelho, não risco da pessoa.
 */
export type ConditionCategory = 'URGENT' | 'HEALTH' | 'DEVICE'

export type ActiveCondition = {
  kind: ConditionKind
  category: ConditionCategory
  /** ISO-8601 de quando a condição abriu. */
  openedAt: string
  /** O valor que abriu a condição, na unidade dela. */
  observedValue: number | null
  /** O limite em vigor quando abriu. */
  thresholdValue: number | null
}

export type WindowCoverage = {
  samples: number
  coveredMs: number
  windowStart: string | null
  windowEnd: string | null
}

export type WorkerTelemetry = {
  workerId: string
  /** Null enquanto o funcionário nunca reportou. */
  origin: TelemetryOrigin | null
  monitoringSessionId: string | null
  metrics: WorkerMetrics
  bloodPressureRecency: 'CURRENT' | 'HISTORICAL' | 'NONE'
  formulaVersion: string | null
  energyWindow: WindowCoverage
  movementWindow: WindowCoverage
  /** ISO-8601 do instante contra o qual a qualidade foi decidida. */
  observedAt: string
  /** Condições abertas da mesma origem da leitura, mais antiga primeiro. */
  conditions: ActiveCondition[]
}

export type Coverage = { evaluated: number; total: number }

export type AggregateMetric<T> = {
  value: T | null
  unit: string
  coverage: Coverage
  /** Leitura mais recente que entrou na conta; null sem cobertura. */
  measuredAt: string | null
  /** Legenda pronta do backend; o painel não inventa a própria. */
  caption: string
}

export type AlertCount = {
  /** Funcionários, e não quantidade de registros. */
  workers: number
  /** De quantos funcionários a contagem fala. */
  total: number
  caption: string
}

export type AdminTelemetrySummary = {
  observedAt: string
  vitalSigns: AggregateMetric<number>
  wearRate: AggregateMetric<number>
  heartRateAverage: AggregateMetric<number>
  bloodPressureAverage: AggregateMetric<BloodPressure>
  bodyTemperatureAverage: AggregateMetric<number>
  movements: AggregateMetric<number>
  urgentAlerts: AlertCount
}

export type AdminWorkerEntry = {
  worker: { id: string; name: string; sector: string | null }
  device: { state: 'NONE' | 'PAIRED'; lastSeenAt: string | null }
  /** A mesma leitura de workers/:id/current, condições incluídas. */
  telemetry: WorkerTelemetry
}

export type AdminWorkersTelemetry = {
  observedAt: string
  /** Urgentes primeiro, depois saúde, depois o resto, por nome. */
  workers: AdminWorkerEntry[]
}

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'

export type AlertQueueItem = {
  id: string
  /** DEMO só aparece com a configuração de homologação ligada no servidor. */
  origin: TelemetryOrigin
  status: AlertStatus
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  /** Quem reconheceu ou resolveu por último; null enquanto ninguém triou. */
  triagedBy: { id: string; name: string } | null
  worker: { id: string; name: string; sector: string | null }
  condition: {
    kind: ConditionKind
    category: ConditionCategory
    observedValue: number | null
    thresholdValue: number | null
    openedAt: string
    /** Preenchido quando o valor já normalizou; o alerta segue até ser triado. */
    recoveredAt: string | null
  }
}

export type AlertQueuePage = {
  items: AlertQueueItem[]
  /** null quando não há próxima página. */
  nextCursor: string | null
}

export type AlertQueueQuery = {
  status?: AlertStatus[]
  limit?: number
  cursor?: string
}

export type SeriesPeriod = 'day' | 'week' | 'month'

export type SeriesPoint = {
  /** ISO-8601 do início do balde. */
  start: string
  /** ISO-8601 do fim do balde, exclusivo. */
  end: string
  activeEnergyKcal: number | null
  steps: number | null
  distanceM: number | null
  heartRate: { avg: number | null; min: number | null; max: number | null }
  /** 0..1 do balde com amostras. */
  coverage: number
}

export type WorkerSeries = {
  workerId: string
  period: SeriesPeriod
  origin: TelemetryOrigin | null
  bucket: 'hour' | 'day'
  from: string
  to: string
  points: SeriesPoint[]
}

// Envelope comum: falha vira erro com mensagem, nunca leitura vazia, para a
// tela poder dizer "indisponível" em vez de afirmar ausência de dado.
async function call<T>(work: () => Promise<T>, fallback: string): Promise<ServiceResponse<T>> {
  try {
    return { data: await work(), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : fallback } }
  }
}

const id = (value: string) => encodeURIComponent(value)

// Triagem que deu certo avisa o aviso de alerta urgente, que relê a fila.
async function triaged<T>(work: Promise<ServiceResponse<T>>): Promise<ServiceResponse<T>> {
  const res = await work
  if (!res.error) notifyAlertTriaged()
  return res
}

export const telemetryApi = {
  // Quem nunca reportou volta como leitura vazia, não como erro: erro aqui é
  // funcionário fora da empresa, sessão caída ou backend fora do ar.
  workerCurrent: (workerId: string): Promise<ServiceResponse<WorkerTelemetry>> =>
    call(
      () => apiFetch<WorkerTelemetry>(`/telemetry/v1/workers/${id(workerId)}/current`),
      'Falha ao carregar a telemetria',
    ),

  adminSummary: (): Promise<ServiceResponse<AdminTelemetrySummary>> =>
    call(
      () => apiFetch<AdminTelemetrySummary>('/telemetry/v1/admin/summary'),
      'Falha ao carregar o resumo',
    ),

  adminWorkers: (): Promise<ServiceResponse<AdminWorkersTelemetry>> =>
    call(
      () => apiFetch<AdminWorkersTelemetry>('/telemetry/v1/admin/workers'),
      'Falha ao carregar os funcionários',
    ),

  workerSeries: (workerId: string, period: SeriesPeriod): Promise<ServiceResponse<WorkerSeries>> =>
    call(
      () => apiFetch<WorkerSeries>(`/telemetry/v1/workers/${id(workerId)}/series?period=${period}`),
      'Falha ao carregar a série',
    ),

  alerts: (query: AlertQueueQuery = {}): Promise<ServiceResponse<AlertQueuePage>> => {
    const params = new URLSearchParams()
    if (query.status?.length) params.set('status', query.status.join(','))
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.cursor) params.set('cursor', query.cursor)
    const qs = params.toString()
    return call(
      () => apiFetch<AlertQueuePage>(`/telemetry/v1/admin/alerts${qs ? `?${qs}` : ''}`),
      'Falha ao carregar os alertas',
    )
  },

  acknowledgeAlert: (alertId: string): Promise<ServiceResponse<AlertQueueItem>> =>
    triaged(
      call(
        () =>
          apiFetch<AlertQueueItem>(`/telemetry/v1/admin/alerts/${id(alertId)}/acknowledge`, {
            method: 'POST',
          }),
        'Falha ao reconhecer o alerta',
      ),
    ),

  resolveAlert: (alertId: string, note?: string): Promise<ServiceResponse<AlertQueueItem>> =>
    triaged(
      call(
        () =>
          apiFetch<AlertQueueItem>(`/telemetry/v1/admin/alerts/${id(alertId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify(note ? { note } : {}),
          }),
        'Falha ao resolver o alerta',
      ),
    ),
}
