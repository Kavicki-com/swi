// Leituras de telemetria para teste, no formato que o backend devolve em
// GET /telemetry/v1/workers/:id/current.
import type { MetricState, WorkerTelemetry } from '@/services/api/telemetry'

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
    fatigueEtaMin: noMetric('min'),
  },
  bloodPressureRecency: 'NONE',
  formulaVersion: null,
  observedAt: FIXTURE_NOW,
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
