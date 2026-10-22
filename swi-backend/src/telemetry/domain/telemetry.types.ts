// Contrato canônico de telemetria do piloto Apple Watch. Este é o vocabulário
// que ingestão, projeção, read models, mobile e painel compartilham. Nenhuma
// camada acima dele redefine unidade, qualidade ou origem.

/** Real vem do relógio ou de aparelho externo; DEMO é demonstração explícita. */
export type TelemetryOrigin = 'REAL' | 'DEMO'

/**
 * Três estados, e os três alcançáveis por qualquer métrica. "Calculando" não
 * mora aqui: ele valia para uma métrica das nove, obrigava todo consumidor a
 * carregar um braço morto em cada switch, e dentro do próprio domínio a
 * conversão de recência de pressão só se mantinha correta por cair no default.
 * A decisão de produto continua existindo, na forma da métrica que a produz:
 * veja EnergyRateState, no projetor.
 */
export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE'

export type MeasurementSource =
  | 'APPLE_WATCH'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  /** Lido do Health Connect no Android, gravado lá pelo app de uma pulseira. */
  | 'HEALTH_CONNECT'
  /** Batimento lido direto da pulseira pelo Bluetooth do celular Android, ao vivo. */
  | 'BLUETOOTH_HR'
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
  | 'distance'
  | 'oxygenSaturation'
  /** Medição pontual vinda do app Saúde, como a pressão. Sem alerta: o pulso mede pele. */
  | 'bodyTemperature'
  /** Minutos até o desgaste cruzar o limiar do alerta. Derivada da avaliação. */
  | 'fatigueEtaMin'

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
    /** Variação em metros desde a amostra anterior, como stepDelta. */
    distanceDeltaM: Measurement
    /** Percentual. O relógio só mede em repouso, então chega raramente. */
    oxygenSaturation: Measurement
    /** Graus Celsius, lidos do app Saúde pelo iPhone. Chega raramente. */
    bodyTemperature: Measurement
  }>
  journeyId?: string | null
  taskId?: string | null
}

export type BloodPressureRecency = 'CURRENT' | 'HISTORICAL' | 'NONE'

/** Espelha o enum TelemetryConditionKind do schema. */
export type ConditionKind =
  | 'HEART_RATE_HIGH'
  | 'HEART_RATE_LOW'
  | 'BLOOD_PRESSURE_REVIEW'
  | 'DEVICE_BATTERY_LOW'
  | 'DEVICE_SIGNAL_LOST'
  /** Desgaste da avaliação em 80% ou mais. Vira item de fila, não urgência. */
  | 'WEAR_HIGH'
  /** Camada de Atenção da calibração individual: faixa de fadiga da pessoa. */
  | 'HEART_RATE_FATIGUE'
  | 'OXYGEN_FATIGUE'
  | 'WEAR_FATIGUE'
  | 'BLOOD_PRESSURE_FATIGUE'
  /** Travas da calibração individual. */
  | 'OXYGEN_LOW'
  | 'BLOOD_PRESSURE_HIGH'
  /**
   * Três ou mais episódios atrasados do mesmo tipo no mesmo dia monitorado.
   * Nasce recuperada, então nunca está entre as ativas da leitura.
   */
  | 'REPEATED_EPISODES'
  /**
   * Pedido de ajuda pelo botão "Ajuda urgente" do app. Não é medição: nasce
   * recuperada para levar o alerta urgente à fila, e nunca está entre as ativas.
   */
  | 'HELP_REQUESTED'

/**
 * Espelha o enum TelemetryConditionRecoveryReason do schema: por que uma
 * condição fechou. NORMALIZED, o valor voltou; SIGNAL_LOST, a sessão ao vivo
 * silenciou; SIGNAL_RESTORED, o aparelho voltou a falar e fechou a perda de
 * sinal; PROFILE_RETIRED, a regra que abriu foi aposentada; NO_NEW_READING, 24 h
 * sem medição nova da métrica.
 */
export type ConditionRecoveryReason =
  | 'NORMALIZED'
  | 'SIGNAL_LOST'
  | 'SIGNAL_RESTORED'
  | 'PROFILE_RETIRED'
  | 'NO_NEW_READING'

/**
 * O que conta como urgente, e por exclusão o que não conta.
 *
 * É o mesmo conjunto que "condição cardíaca ativa" em sinais vitais: no piloto,
 * o que urge é o coração fora da faixa. Ficam de fora por decisão congelada, e
 * não por esquecimento: BLOOD_PRESSURE_REVIEW pede revisão humana e nunca vira
 * urgência automática; DEVICE_BATTERY_LOW e DEVICE_SIGNAL_LOST são alertas de
 * aparelho, e tratá-los como alerta de saúde faria um relógio descarregado
 * contar como funcionário em risco. Quem for apresentá-los declara os próprios
 * conjuntos: uma lista exportada sem consumidor envelheceria sem ninguém notar.
 *
 * Com a calibração individual (revisão 2.0) entram as travas novas, oxigenação
 * abaixo de 90% e pressão em 180/110: são o piso de proteção que não aprende.
 * O desgaste alto também entra, porque deixou de ser estimativa sem régua: a
 * trava dele subiu para 90% e a faixa de cada pessoa cuida do caminho até lá.
 * As condições de Atenção (faixa de fadiga da pessoa) ficam de fora.
 *
 * O pedido de ajuda do app também é urgente, por definição: é uma pessoa
 * pedindo socorro. Ele nasce recuperado, então nunca conta entre as ativas.
 */
export const URGENT_CONDITION_KINDS = [
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'OXYGEN_LOW',
  'BLOOD_PRESSURE_HIGH',
  'WEAR_HIGH',
  'HELP_REQUESTED',
] as const

/** LIVE promove o snapshot; BACKLOG só vai ao histórico; HISTORICAL passou de 48 h. */
export type EventAge = 'LIVE' | 'BACKLOG' | 'HISTORICAL'

/** Espelha o enum TelemetryDeviceKind do schema. */
export type DeviceKind = 'APPLE_WATCH' | 'IPHONE' | 'EXTERNAL_CUFF' | 'ANDROID_PHONE'
