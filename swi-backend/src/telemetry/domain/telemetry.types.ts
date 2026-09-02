// Contrato canônico de telemetria do piloto Apple Watch. Este é o vocabulário
// que ingestão, projeção, read models, mobile e painel compartilham. Nenhuma
// camada acima dele redefine unidade, qualidade ou origem.

/** Real vem do relógio ou de aparelho externo; DEMO é demonstração explícita. */
export type TelemetryOrigin = 'REAL' | 'DEMO'

export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE'

export type MeasurementSource =
  | 'APPLE_WATCH'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  | 'DERIVED'

/** Estado de leitura de uma métrica. Ausência é null, nunca zero. */
export interface MetricState<T> {
  value: T | null
  quality: MetricQuality
  measuredAt: string | null
  source: MeasurementSource | null
  unit: string
}

export type MetricKind =
  | 'heartRate'
  | 'steps'
  | 'movementPerMinute'
  | 'activeEnergy'
  | 'energyRatePerHour'
  | 'battery'
  | 'bloodPressure'
  | 'effort'
  | 'wear'

/** Identificadores do escopo do cliente para as métricas que ele nomeou. */
export type ClientIndicator = 'Q13' | 'Q14' | 'Q16'

export interface BloodPressure {
  /** mmHg, inteiro. */
  systolic: number
  /** mmHg, inteiro. */
  diastolic: number
}

/** Uma medição bruta como chega no evento, antes de virar MetricState. */
export interface Measurement<T = number> {
  value: T
  unit: string
  source: MeasurementSource
}

/** Amostra já aceita, com o horário em que foi medida no aparelho. */
export interface Sample<T = number> {
  value: T
  measuredAt: string
  source: MeasurementSource
}

/**
 * Evento bruto de telemetria. Não carrega workerId: o funcionário é derivado
 * da credencial do dispositivo no backend. journeyId e taskId são contexto
 * opcional e nunca controlam o monitoramento.
 */
export interface TelemetryEvent {
  eventId: string
  deviceId: string
  monitoringSessionId: string
  sequence: number
  /** ISO-8601, medido no aparelho. */
  eventTime: string
  /** ISO-8601, carimbado pelo backend ao receber. */
  receivedAt: string
  origin: TelemetryOrigin
  measurements: Partial<{
    heartRate: Measurement
    stepDelta: Measurement
    activeEnergyKcal: Measurement
    motionCount: Measurement
    battery: Measurement
    bloodPressure: Measurement<BloodPressure>
  }>
  journeyId?: string | null
  taskId?: string | null
}

export type BloodPressureRecency = 'CURRENT' | 'HISTORICAL' | 'NONE'

/** LIVE promove o snapshot; BACKLOG só vai ao histórico; HISTORICAL passou de 48 h. */
export type EventAge = 'LIVE' | 'BACKLOG' | 'HISTORICAL'
