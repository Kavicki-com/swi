import { apiRequest } from '../api/http';

// Leitura da telemetria do próprio funcionário (GET /telemetry/v1/me/current).
// Os tipos espelham o contrato do backend: cada métrica chega com valor,
// qualidade, instante e origem, e ausência é null, nunca zero. Quem nunca
// reportou recebe leitura vazia (origin null), não erro.

export type TelemetryOrigin = 'REAL' | 'DEMO';

export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE';

export type MeasurementSource =
  | 'APPLE_WATCH'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  | 'DERIVED';

export interface MetricState<T> {
  /**
   * Batimento, esforço, desgaste e as outras métricas contínuas guardam o
   * último valor mesmo depois de expirar; aí a qualidade vem UNAVAILABLE e o
   * valor não vale mais como leitura atual.
   */
  value: T | null;
  quality: MetricQuality;
  /** ISO-8601 da medição; null quando nunca houve medição. */
  measuredAt: string | null;
  source: MeasurementSource | null;
  unit: string;
}

export interface BloodPressure {
  systolic: number;
  diastolic: number;
}

export interface WorkerMetrics {
  heartRate: MetricState<number>;
  steps: MetricState<number>;
  movementPerMinute: MetricState<number>;
  activeEnergy: MetricState<number>;
  /** `calculating` diz que a janela ainda não cobre o mínimo para a taxa. */
  energyRatePerHour: MetricState<number> & { calculating: boolean };
  battery: MetricState<number>;
  bloodPressure: MetricState<BloodPressure>;
  /** 0-100. */
  effort: MetricState<number>;
  /** 0-100. */
  wear: MetricState<number>;
  /** Acumulado do dia, em metros. */
  distance: MetricState<number>;
  /** Medição pontual: "última medição às", nunca "atual". */
  oxygenSaturation: MetricState<number>;
  /** Minutos até o alerta de desgaste no ritmo recente. */
  fatigueEtaMin: MetricState<number>;
}

/**
 * Categoria decidida no backend a partir do domínio: URGENT é batimento fora
 * da faixa, HEALTH pede atenção sem urgência (desgaste alto, revisar pressão),
 * DEVICE é problema do aparelho, não risco do funcionário.
 */
export type ConditionCategory = 'URGENT' | 'HEALTH' | 'DEVICE';

export interface ActiveCondition {
  kind: string;
  category: ConditionCategory;
  /** ISO-8601 de quando a condição abriu. */
  openedAt: string;
  observedValue: number | null;
  thresholdValue: number | null;
}

export interface WorkerTelemetry {
  workerId: string;
  /** Condições abertas da mesma origem da leitura, mais antiga primeiro. */
  conditions: ActiveCondition[];
  /** null enquanto o funcionário nunca reportou. */
  origin: TelemetryOrigin | null;
  monitoringSessionId: string | null;
  metrics: WorkerMetrics;
  bloodPressureRecency: 'CURRENT' | 'HISTORICAL' | 'NONE';
  formulaVersion: string | null;
  /** ISO-8601 do instante contra o qual a qualidade foi decidida. */
  observedAt: string;
}

export const MY_TELEMETRY_PATH = '/telemetry/v1/me/current';

// As métricas que as telas leem. Uma resposta sem alguma delas não serve de
// leitura: desmontá-la quebraria a tela, e com ela o botão de ajuda urgente.
const READ_METRICS: readonly (keyof WorkerMetrics)[] = [
  'heartRate',
  'steps',
  'energyRatePerHour',
  'battery',
  'bloodPressure',
  'effort',
  'wear',
  'distance',
  'oxygenSaturation',
  'fatigueEtaMin',
];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isWorkerTelemetry(data: unknown): data is WorkerTelemetry {
  if (!isObject(data) || !Array.isArray(data.conditions)) return false;
  if (data.origin !== null && data.origin !== 'REAL' && data.origin !== 'DEMO') return false;
  const { metrics } = data;
  return isObject(metrics) && READ_METRICS.every((key) => isObject(metrics[key]));
}

/**
 * Lança em falha de rede ou de sessão, e também quando a resposta não é uma
 * leitura: o cliente HTTP devolve {} para corpo que não é JSON, e um backend
 * antigo pode não mandar as condições ou alguma métrica. Quem chama decide o
 * que a tela diz.
 */
export async function fetchMyTelemetry(): Promise<WorkerTelemetry> {
  const data: unknown = await apiRequest(MY_TELEMETRY_PATH, { auth: true });
  if (!isWorkerTelemetry(data)) throw new Error('Leitura de telemetria fora do contrato');
  return data;
}
