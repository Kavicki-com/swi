// Leituras de telemetria para teste, no formato que o backend devolve em
// GET /telemetry/v1/workers/:id/current.
import type {
  ActiveCondition,
  AdminTelemetrySummary,
  AdminWorkerEntry,
  AggregateMetric,
  AlertQueueItem,
  ConditionCategory,
  MetricState,
  SeriesPoint,
  WorkerSeries,
  WorkerTelemetry,
} from '@/services/api/telemetry'

export const FIXTURE_NOW = '2026-10-01T15:00:00.000Z'
export const FIXTURE_AT = '2026-10-01T14:59:30.000Z'

export const noMetric = <T>(unit: string): MetricState<T> => ({
  value: null,
  quality: 'UNAVAILABLE',
  measuredAt: null,
  source: null,
  unit,
})

export const metric = <T>(value: T, over: Partial<MetricState<T>> = {}): MetricState<T> => ({
  value,
  quality: 'CURRENT',
  measuredAt: FIXTURE_AT,
  source: 'APPLE_WATCH',
  unit: '',
  ...over,
})

const EMPTY_WINDOW = { samples: 0, coveredMs: 0, windowStart: null, windowEnd: null }

/** O que o backend devolve para quem nunca reportou: leitura vazia, não erro. */
export const neverReported = (workerId = 'w1'): WorkerTelemetry => ({
  workerId,
  origin: null,
  monitoringSessionId: null,
  metrics: {
    heartRate: noMetric('bpm'),
    steps: noMetric('steps'),
    movementPerMinute: noMetric('mpm'),
    activeEnergy: noMetric('kcal'),
    energyRatePerHour: { ...noMetric<number>('kcal/h'), calculating: false },
    battery: noMetric('%'),
    bloodPressure: noMetric('mmHg'),
    effort: noMetric('%'),
    wear: noMetric('%'),
    distance: noMetric('m'),
    oxygenSaturation: noMetric('%'),
    bodyTemperature: noMetric('°C'),
    fatigueEtaMin: noMetric('min'),
  },
  bloodPressureRecency: 'NONE',
  formulaVersion: null,
  energyWindow: EMPTY_WINDOW,
  movementWindow: EMPTY_WINDOW,
  observedAt: FIXTURE_NOW,
  conditions: [],
})

/** Funcionário reportando agora: batimento 112, desgaste 38,4, esforço 61, 95 min. */
export const reporting = (
  over: Partial<WorkerTelemetry['metrics']> = {},
  origin: 'REAL' | 'DEMO' = 'REAL',
  workerId = 'w1',
): WorkerTelemetry => {
  const base = neverReported(workerId)
  return {
    ...base,
    origin,
    monitoringSessionId: 's1',
    metrics: {
      ...base.metrics,
      heartRate: metric(112),
      wear: metric(38.4, { source: 'DERIVED' }),
      effort: metric(61, { source: 'DERIVED' }),
      fatigueEtaMin: metric(95, { source: 'DERIVED' }),
      ...over,
    },
  }
}

const KIND_BY_CATEGORY: Record<ConditionCategory, ActiveCondition['kind']> = {
  URGENT: 'HEART_RATE_HIGH',
  HEALTH: 'WEAR_HIGH',
  DEVICE: 'DEVICE_BATTERY_LOW',
}

/** Condição aberta; o tipo padrão segue a categoria. */
export const condition = (
  category: ConditionCategory,
  over: Partial<ActiveCondition> = {},
): ActiveCondition => ({
  kind: KIND_BY_CATEGORY[category],
  category,
  openedAt: FIXTURE_AT,
  observedValue: null,
  thresholdValue: null,
  ...over,
})

/** Uma linha de GET /telemetry/v1/admin/workers. */
export const adminWorker = (
  id: string,
  name: string,
  over: Partial<AdminWorkerEntry> = {},
): AdminWorkerEntry => ({
  worker: { id, name, sector: 'Operações' },
  device: { state: 'PAIRED', lastSeenAt: FIXTURE_AT },
  telemetry: reporting({}, 'REAL', id),
  ...over,
})

const aggregate = <T>(value: T | null, unit: string): AggregateMetric<T> => ({
  value,
  unit,
  coverage: { evaluated: value === null ? 0 : 3, total: 4 },
  measuredAt: value === null ? null : FIXTURE_AT,
  caption: value === null ? 'Sem dados atuais' : 'Média recente',
})

/** Resumo da empresa com quatro monitorados e três com leitura atual. */
export const adminSummary = (over: Partial<AdminTelemetrySummary> = {}): AdminTelemetrySummary => ({
  observedAt: FIXTURE_NOW,
  vitalSigns: aggregate(2, 'funcionários'),
  wearRate: aggregate(41.5, '%'),
  heartRateAverage: aggregate(96, 'bpm'),
  bloodPressureAverage: aggregate({ systolic: 124, diastolic: 80 }, 'mmHg'),
  bodyTemperatureAverage: aggregate<number>(null, '°C'),
  movements: aggregate(1840, 'passos'),
  urgentAlerts: { workers: 1, total: 4, caption: 'Funcionários com condição urgente ativa' },
  ...over,
})

/** Item da fila de alertas, aberto, de batimento alto. */
export const alertItem = (id: string, over: Partial<AlertQueueItem> = {}): AlertQueueItem => ({
  id,
  origin: 'REAL',
  status: 'OPEN',
  createdAt: FIXTURE_AT,
  acknowledgedAt: null,
  resolvedAt: null,
  resolutionNote: null,
  triagedBy: null,
  worker: { id: 'w1', name: 'Ana Souza', sector: 'Operações' },
  condition: {
    kind: 'HEART_RATE_HIGH',
    category: 'URGENT',
    observedValue: 185,
    thresholdValue: 167,
    openedAt: FIXTURE_AT,
    recoveredAt: null,
  },
  ...over,
})

/** Ponto de série vazio: ausência é null, nunca zero. */
export const emptyPoint = (start: string, end: string): SeriesPoint => ({
  start,
  end,
  activeEnergyKcal: null,
  steps: null,
  distanceM: null,
  heartRate: { avg: null, min: null, max: null },
  coverage: 0,
})

/** Série de um funcionário com os pontos dados. */
export const series = (points: SeriesPoint[], over: Partial<WorkerSeries> = {}): WorkerSeries => ({
  workerId: 'w1',
  period: 'week',
  origin: 'REAL',
  bucket: 'day',
  from: points[0]?.start ?? FIXTURE_NOW,
  to: points[points.length - 1]?.end ?? FIXTURE_NOW,
  points,
  ...over,
})
