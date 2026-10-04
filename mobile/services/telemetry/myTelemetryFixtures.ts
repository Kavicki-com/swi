// Leituras de telemetria para teste, no formato de GET /telemetry/v1/me/current.
import type { ActiveCondition, MetricState, WorkerTelemetry } from './myTelemetry';

export const FIXTURE_AT = '2026-10-01T14:59:30.000Z';

/** Dois dias antes do instante da leitura: medição que não é de hoje. */
export const FIXTURE_OTHER_DAY = '2026-09-29T14:59:00.000Z';

export const noMetric = <T,>(unit: string): MetricState<T> => ({
  value: null,
  quality: 'UNAVAILABLE',
  measuredAt: null,
  source: null,
  unit,
});

export const condition = (
  category: ActiveCondition['category'],
  kind = category === 'URGENT' ? 'HEART_RATE_HIGH' : category === 'HEALTH' ? 'WEAR_HIGH' : 'DEVICE_BATTERY_LOW',
): ActiveCondition => ({
  kind,
  category,
  openedAt: FIXTURE_AT,
  observedValue: null,
  thresholdValue: null,
});

export const metric = <T,>(value: T, over: Partial<MetricState<T>> = {}): MetricState<T> => ({
  value,
  quality: 'CURRENT',
  measuredAt: FIXTURE_AT,
  source: 'APPLE_WATCH',
  unit: '',
  ...over,
});

/**
 * Valor que o backend ainda devolve depois de expirar: batimento, esforço,
 * desgaste e as outras métricas contínuas guardam o último valor, e é a
 * qualidade UNAVAILABLE que diz que ele não vale mais como leitura atual.
 */
export const expired = <T,>(value: T, measuredAt: string): MetricState<T> =>
  metric(value, { quality: 'UNAVAILABLE', measuredAt });

/** O que o backend devolve para quem nunca reportou: leitura vazia, não erro. */
export const neverReported = (): WorkerTelemetry => ({
  workerId: 'w1',
  conditions: [],
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
  observedAt: '2026-10-01T15:00:00.000Z',
});

/** Reportando agora: 112 bpm, 310 kcal/h, desgaste 38,4, esforço 61, 95 min. */
export const reporting = (
  over: Partial<WorkerTelemetry['metrics']> = {},
  origin: 'REAL' | 'DEMO' = 'REAL',
): WorkerTelemetry => {
  const base = neverReported();
  return {
    ...base,
    origin,
    monitoringSessionId: 's1',
    metrics: {
      ...base.metrics,
      heartRate: metric(112),
      energyRatePerHour: { ...metric(310.4, { source: 'DERIVED' }), calculating: false },
      wear: metric(38.4, { source: 'DERIVED' }),
      effort: metric(61, { source: 'DERIVED' }),
      fatigueEtaMin: metric(95, { source: 'DERIVED' }),
      ...over,
    },
  };
};
