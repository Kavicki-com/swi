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
  TelemetryEvent,
  TelemetryOrigin,
} from './telemetry.types'

// Funções puras de validade. Todos os limites de atualidade do piloto moram
// aqui, e o dia monitorado também: nenhuma tela, projeção, agregado ou job
// recalcula os próprios prazos nem as próprias fronteiras de dia.
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

/**
 * BRT é UTC-3 fixo (o Brasil aboliu o horário de verão em 2019). Mesma conta
 * que reports.service.ts faz para formatar data, e sem depender de ICU.
 *
 * Exportado porque a varredura do ciclo de vida precisa da mesma conta dentro
 * do SQL, ao agrupar leituras por dia. É o deslocamento, nunca a regra: quem
 * traduz instante em dia continua sendo monitoredDayOf, aqui.
 */
export const BRT_OFFSET_MS = -3 * HOUR

/**
 * O dia monitorado é o dia civil em BRT, não as últimas 24 horas: "passos
 * acumulados no dia monitorado" é o que a decisão congelada promete ao cliente,
 * e uma janela deslizante faria o total encolher sozinho durante o turno.
 *
 * A regra mora no domínio porque tem mais de um dono: o read model a usa para
 * recortar o dia do acumulado, e o ciclo de vida do dado (Resumo do dia e
 * retenção) precisa da mesma fronteira para saber que dia resumir e quando
 * ele fecha. Uma segunda conta de meia-noite, em qualquer um deles, faria o
 * Resumo do dia discordar do painel.
 *
 * Consequência conhecida: um turno que cruza a meia-noite pertence a dois dias
 * monitorados, e o acumulado reinicia na virada. É o que a decisão descreve;
 * mudar isso é decisão de produto, não de código.
 */
export function monitoredDayRange(now: Date): { start: Date; end: Date } {
  return monitoredDayWindow(monitoredDayOf(now))
}

/**
 * O dia monitorado a que um instante pertence, como data pura em meia-noite
 * UTC. É essa data que vira a chave da linha do Resumo do dia: guardá-la com
 * hora faria a chave depender de conversão, e duas linhas do mesmo dia
 * poderiam coexistir sem que o índice único percebesse.
 */
export function monitoredDayOf(instant: Date): Date {
  const local = new Date(instant.getTime() + BRT_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
}

/**
 * A janela UTC de um dia monitorado já nomeado. O ciclo de vida resume um dia
 * que passou, então ele parte do dia, e não de "agora"; as duas portas devolvem
 * a mesma fronteira porque são a mesma conta.
 */
export function monitoredDayWindow(day: Date): { start: Date; end: Date } {
  // A porta recebe o dia como o banco o guarda. Um instante qualquer daria uma
  // janela deslocada sem nenhum erro, e o Resumo nasceria do dia errado.
  if (day.getTime() % (24 * HOUR) !== 0) {
    throw new Error('monitoredDayWindow espera uma data pura, em meia-noite UTC')
  }
  const start = new Date(day.getTime() - BRT_OFFSET_MS)
  return { start, end: new Date(start.getTime() + 24 * HOUR) }
}

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

/** Faixa de plausibilidade de um valor. Fora dela é impossível, não "extremo". */
interface ValueRange {
  min: number
  max: number
  integer?: boolean
}

const RANGES: Partial<Record<MetricKind, ValueRange>> = {
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

// As três conferências que toda medição sofre, num lugar só. A métrica canônica
// e a medição crua do evento passam pelas mesmas funções, e por isso não podem
// divergir sobre o que é unidade certa, origem permitida ou faixa possível.

function checkUnit(kind: string, unit: string, expected: string): void {
  if (unit !== expected) throw new InvalidMeasurementError(kind, `unidade esperada ${expected}`)
}

function checkSource(kind: string, source: string, allowed: readonly MeasurementSource[]): void {
  if (!allowed.includes(source as MeasurementSource)) {
    throw new InvalidMeasurementError(kind, `origem ${source} não permitida`)
  }
}

function checkNumber(kind: string, value: unknown, range: ValueRange | undefined): void {
  if (!isFiniteNumber(value)) {
    throw new InvalidMeasurementError(kind, 'valor precisa ser número finito')
  }
  if (range === undefined) return
  if (range.integer && !Number.isInteger(value)) {
    throw new InvalidMeasurementError(kind, 'valor inteiro')
  }
  if (value < range.min || value > range.max) {
    throw new InvalidMeasurementError(kind, `fora da faixa ${range.min} a ${range.max}`)
  }
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
  checkUnit(kind, measurement.unit, spec.unit)
  checkSource(kind, measurement.source, spec.sources)
  if (kind === 'bloodPressure') {
    validateBloodPressure(measurement.value)
    return
  }
  checkNumber(kind, measurement.value, RANGES[kind])
}

/**
 * O funcionário vem da credencial do dispositivo, nunca do payload. Um evento
 * que traz workerId está tentando impor identidade e é recusado inteiro.
 */
export function rejectWorkerIdAuthority(payload: object): void {
  // Pelo valor, não pela presença da chave. Uma classe que declara o campo sem
  // preenchê-lo pode carregar a chave vazia, e isso não é tentativa de impor
  // identidade; um valor qualquer é.
  const { workerId } = payload as { workerId?: unknown }
  if (workerId !== undefined && workerId !== null) {
    throw new InvalidTelemetryEventError('workerId não é aceito no evento')
  }
}

/** Chaves de medição que o evento bruto pode carregar. */
export type RawMeasurementKey = keyof TelemetryEvent['measurements']

interface RawMeasurementSpec {
  unit: string
  sources: readonly MeasurementSource[]
  range?: ValueRange
  /** Pressão é a única medição que chega como par, e não como um número. */
  pair?: true
}

/** Herda de uma métrica canônica o que já foi decidido sobre ela. */
function fromMetric(kind: MetricKind): RawMeasurementSpec {
  const spec: RawMeasurementSpec = { unit: METRICS[kind].unit, sources: METRICS[kind].sources }
  const range = RANGES[kind]
  if (range !== undefined) spec.range = range
  if (kind === 'bloodPressure') spec.pair = true
  return spec
}

/**
 * O que cada medição do evento bruto precisa cumprir.
 *
 * Cinco delas são a mesma coisa que uma métrica canônica e herdam dela unidade,
 * origem e faixa. motionCount tem spec própria: é a contagem de movimento que
 * alimenta a derivação de MPM, e registrá-la como MetricKind faria dela o
 * sétimo indicador que a decisão congelada recusa.
 *
 * O Record cobre RawMeasurementKey inteiro de propósito: uma medição nova no
 * evento não compila até alguém dizer como ela é validada.
 */
const RAW_MEASUREMENTS: Record<RawMeasurementKey, RawMeasurementSpec> = {
  heartRate: fromMetric('heartRate'),
  stepDelta: fromMetric('steps'),
  activeEnergyKcal: fromMetric('activeEnergy'),
  battery: fromMetric('battery'),
  bloodPressure: fromMetric('bloodPressure'),
  motionCount: { unit: 'count', sources: ['APPLE_WATCH'], range: { min: 0, max: 100_000 } },
}

/** Forma mínima de uma medição, antes de saber se o conteúdo dela vale. */
interface MeasurementShape {
  value: unknown
  unit: string
  source: string
}

function assertMeasurementShape(key: string, raw: unknown): asserts raw is MeasurementShape {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidMeasurementError(key, 'medição precisa ser um objeto')
  }
  const shape = raw as Partial<MeasurementShape>
  if (!('value' in shape)) throw new InvalidMeasurementError(key, 'valor ausente')
  if (typeof shape.unit !== 'string' || typeof shape.source !== 'string') {
    throw new InvalidMeasurementError(key, 'unidade e origem são obrigatórias')
  }
}

/**
 * Valida uma medição como ela chega no evento, pela chave que o aparelho usou.
 *
 * Chave desconhecida é recusa, não descarte: o normalizador da persistência lê
 * só as chaves que conhece, então aceitar o resto significaria responder ACK
 * para uma medição que nunca foi gravada.
 */
export function validateRawMeasurement(key: string, raw: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(RAW_MEASUREMENTS, key)) {
    throw new InvalidTelemetryEventError(`medição desconhecida: ${key}`)
  }
  const spec = RAW_MEASUREMENTS[key as RawMeasurementKey]
  assertMeasurementShape(key, raw)
  checkUnit(key, raw.unit, spec.unit)
  checkSource(key, raw.source, spec.sources)
  if (spec.pair === true) {
    validateBloodPressure(raw.value)
    return
  }
  checkNumber(key, raw.value, spec.range)
}

/**
 * Um evento precisa medir alguma coisa. Sem medição ele grava uma linha só de
 * nulos, consome uma sequência da sessão e não conta nada a ninguém.
 */
export function assertMeasuresSomething(measurements: object): void {
  if (Object.keys(measurements).length === 0) {
    throw new InvalidTelemetryEventError('evento sem medição alguma')
  }
}

/**
 * Folga aceita para o relógio do aparelho estar adiantado. Passado disso, o
 * horário é do futuro e o evento é recusado.
 */
export const CLOCK_SKEW_MS = 2 * MINUTE

/**
 * O snapshot só é promovido por evento mais recente do que o já promovido. Um
 * evento com horário no futuro passaria a barrar todos os seguintes, e o
 * funcionário ficaria com o estado atual congelado até o relógio do servidor
 * alcançar aquele instante. Por isso a checagem é da ingestão, antes de gravar.
 */
export function assertEventTimeUsable(eventTime: string, now: Date | string): void {
  const measured = toMs(eventTime)
  if (Number.isNaN(measured)) {
    throw new InvalidTelemetryEventError('eventTime não é um instante válido')
  }
  if (measured - toMs(now) > CLOCK_SKEW_MS) {
    throw new InvalidTelemetryEventError('eventTime no futuro')
  }
}
