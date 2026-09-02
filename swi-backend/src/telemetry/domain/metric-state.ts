import {
  InvalidMeasurementError,
  InvalidTelemetryEventError,
  TelemetryOriginMismatchError,
} from './telemetry.errors'
import type {
  BloodPressure,
  BloodPressureRecency,
  ClientIndicator,
  EventAge,
  Measurement,
  MeasurementSource,
  MetricKind,
  MetricQuality,
  MetricState,
  Sample,
  TelemetryOrigin,
} from './telemetry.types'

// Funções puras de validade. Todos os limites de atualidade do piloto moram
// aqui: nenhuma tela, projeção ou agregado recalcula os próprios prazos.
// "now" entra por parâmetro para tornar cada função determinística.

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const FRESHNESS = {
  /** BPM, passos, MPM, energia, esforço e desgaste. */
  VITAL: { currentMs: 45_000, staleMs: 120_000 },
  BATTERY: { currentMs: 5 * MINUTE, staleMs: 30 * MINUTE },
  /** Atual para mobile e painel; histórica só no mobile; depois, sem medição recente. */
  BLOOD_PRESSURE: { currentMs: 24 * HOUR, staleMs: 72 * HOUR },
} as const

export type FreshnessProfile = keyof typeof FRESHNESS

export const EVENT_AGE = {
  /** Dentro deste prazo o evento promove o snapshot atual. */
  liveMs: FRESHNESS.VITAL.staleMs,
  /** Até aqui é backlog: entra no histórico sem tocar o atual. Depois é histórico. */
  backlogMs: 48 * HOUR,
} as const

interface MetricSpec {
  unit: string
  freshness: FreshnessProfile
  sources: readonly MeasurementSource[]
  indicator?: ClientIndicator
  /** Leitura expirada continua visível com horário e qualidade. */
  retainsExpiredValue: boolean
}

export const METRICS: Record<MetricKind, MetricSpec> = {
  heartRate: {
    unit: 'bpm',
    freshness: 'VITAL',
    sources: ['APPLE_WATCH'],
    retainsExpiredValue: true,
  },
  steps: {
    unit: 'steps',
    freshness: 'VITAL',
    sources: ['APPLE_WATCH'],
    indicator: 'Q14',
    retainsExpiredValue: true,
  },
  movementPerMinute: {
    unit: 'mpm',
    freshness: 'VITAL',
    sources: ['DERIVED'],
    indicator: 'Q16',
    retainsExpiredValue: true,
  },
  activeEnergy: {
    unit: 'kcal',
    freshness: 'VITAL',
    sources: ['APPLE_WATCH'],
    retainsExpiredValue: true,
  },
  energyRatePerHour: {
    unit: 'kcal/h',
    freshness: 'VITAL',
    sources: ['DERIVED'],
    indicator: 'Q13',
    retainsExpiredValue: true,
  },
  battery: {
    unit: '%',
    freshness: 'BATTERY',
    sources: ['APPLE_WATCH'],
    retainsExpiredValue: true,
  },
  bloodPressure: {
    unit: 'mmHg',
    freshness: 'BLOOD_PRESSURE',
    sources: ['EXTERNAL_CUFF', 'MANUAL_HEALTHKIT', 'MANUAL_SWI'],
    // Acima de 72 h é "sem medição recente": o valor some, nunca vira 0/0.
    retainsExpiredValue: false,
  },
  effort: { unit: '%', freshness: 'VITAL', sources: ['DERIVED'], retainsExpiredValue: true },
  wear: { unit: '%', freshness: 'VITAL', sources: ['DERIVED'], retainsExpiredValue: true },
}

const toMs = (iso: string | Date): number =>
  iso instanceof Date ? iso.getTime() : Date.parse(iso)

/** Idade em ms; horário no futuro conta como zero, nunca como "mais atual". */
function ageMs(measuredAt: string, now: Date | string): number {
  return Math.max(0, toMs(now) - toMs(measuredAt))
}

export function qualityAt(
  kind: MetricKind,
  measuredAt: string | null,
  now: Date | string,
): MetricQuality {
  if (measuredAt === null || Number.isNaN(toMs(measuredAt))) return 'UNAVAILABLE'
  const { currentMs, staleMs } = FRESHNESS[METRICS[kind].freshness]
  const age = ageMs(measuredAt, now)
  if (age <= currentMs) return 'CURRENT'
  if (age <= staleMs) return 'STALE'
  return 'UNAVAILABLE'
}

export function metricState<T>(
  kind: MetricKind,
  sample: Sample<T> | null,
  now: Date | string,
): MetricState<T> {
  const { unit, retainsExpiredValue } = METRICS[kind]
  if (sample === null) {
    return { value: null, quality: 'UNAVAILABLE', measuredAt: null, source: null, unit }
  }
  const quality = qualityAt(kind, sample.measuredAt, now)
  if (quality === 'UNAVAILABLE' && !retainsExpiredValue) {
    return { value: null, quality, measuredAt: null, source: null, unit }
  }
  return {
    value: sample.value,
    quality,
    measuredAt: sample.measuredAt,
    source: sample.source,
    unit,
  }
}

export function bloodPressureRecency(
  measuredAt: string | null,
  now: Date | string,
): BloodPressureRecency {
  switch (qualityAt('bloodPressure', measuredAt, now)) {
    case 'CURRENT':
      return 'CURRENT'
    case 'STALE':
      return 'HISTORICAL'
    default:
      return 'NONE'
  }
}

export function bloodPressureState(
  sample: Sample<BloodPressure> | null,
  now: Date | string,
): MetricState<BloodPressure> {
  return metricState('bloodPressure', sample, now)
}

export function classifyEventAge(eventTime: string, now: Date | string): EventAge {
  const age = ageMs(eventTime, now)
  if (age <= EVENT_AGE.liveMs) return 'LIVE'
  if (age <= EVENT_AGE.backlogMs) return 'BACKLOG'
  return 'HISTORICAL'
}

/** Backlog e histórico entram no histórico sem promover o snapshot atual. */
export function isBacklog(eventTime: string, now: Date | string): boolean {
  return classifyEventAge(eventTime, now) !== 'LIVE'
}

export function assertOriginCompatible(
  sessionOrigin: TelemetryOrigin,
  eventOrigin: TelemetryOrigin,
): void {
  if (sessionOrigin !== eventOrigin) {
    throw new TelemetryOriginMismatchError(sessionOrigin, eventOrigin)
  }
}

/** Faixas de plausibilidade. Fora delas o valor é impossível, não "extremo". */
const RANGES: Partial<Record<MetricKind, { min: number; max: number; integer?: boolean }>> = {
  heartRate: { min: 20, max: 300 },
  steps: { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
  movementPerMinute: { min: 0, max: 1_000 },
  activeEnergy: { min: 0, max: 100_000 },
  energyRatePerHour: { min: 0, max: 10_000 },
  battery: { min: 0, max: 100 },
  effort: { min: 0, max: 100 },
  wear: { min: 0, max: 100 },
}

const BLOOD_PRESSURE_RANGE = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 30, max: 200 },
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateBloodPressure(value: unknown): void {
  const kind = 'bloodPressure'
  if (typeof value !== 'object' || value === null) {
    throw new InvalidMeasurementError(kind, 'par sistólica/diastólica ausente')
  }
  const { systolic, diastolic } = value as Partial<BloodPressure>
  if (!isFiniteNumber(systolic) || !isFiniteNumber(diastolic)) {
    throw new InvalidMeasurementError(kind, 'sistólica e diastólica precisam ser números finitos')
  }
  if (!Number.isInteger(systolic) || !Number.isInteger(diastolic)) {
    throw new InvalidMeasurementError(kind, 'mmHg é inteiro')
  }
  const s = BLOOD_PRESSURE_RANGE.systolic
  const d = BLOOD_PRESSURE_RANGE.diastolic
  if (systolic < s.min || systolic > s.max || diastolic < d.min || diastolic > d.max) {
    throw new InvalidMeasurementError(kind, 'fora da faixa plausível em mmHg')
  }
  if (systolic <= diastolic) {
    throw new InvalidMeasurementError(kind, 'sistólica deve superar a diastólica')
  }
}

/**
 * Rejeita valor impossível, unidade errada ou origem não permitida. Não
 * arredonda nem converte: o que entra errado é recusado, não corrigido.
 */
export function validateMeasurement(kind: MetricKind, measurement: Measurement<unknown>): void {
  const spec = METRICS[kind]
  if (measurement.unit !== spec.unit) {
    throw new InvalidMeasurementError(kind, `unidade esperada ${spec.unit}`)
  }
  if (!spec.sources.includes(measurement.source)) {
    throw new InvalidMeasurementError(kind, `origem ${measurement.source} não permitida`)
  }
  if (kind === 'bloodPressure') {
    validateBloodPressure(measurement.value)
    return
  }
  const { value } = measurement
  if (!isFiniteNumber(value)) {
    throw new InvalidMeasurementError(kind, 'valor precisa ser número finito')
  }
  const range = RANGES[kind]
  if (range === undefined) return
  if (range.integer && !Number.isInteger(value)) {
    throw new InvalidMeasurementError(kind, 'valor inteiro')
  }
  if (value < range.min || value > range.max) {
    throw new InvalidMeasurementError(kind, `fora da faixa ${range.min} a ${range.max}`)
  }
}

/**
 * O funcionário vem da credencial do dispositivo, nunca do payload. Um evento
 * que traz workerId está tentando impor identidade e é recusado inteiro.
 */
export function rejectWorkerIdAuthority(payload: Record<string, unknown>): void {
  if ('workerId' in payload) {
    throw new InvalidTelemetryEventError('workerId não é aceito no evento')
  }
}
