import { monitoredDayOf, monitoredDayWindow } from '../domain/metric-state'
import type { TelemetryOrigin } from '../domain/telemetry.types'
import { summarizeDay, type SummarizerSample } from '../lifecycle/telemetry-summarizer'

// Série por período para os gráficos de período: "Hoje" em horas, "Esta
// semana" e "Este mês" em dias. Módulo puro, com o instante por parâmetro: quem
// busca as linhas é o serviço; aqui só se decide em que balde cada coisa cai e
// o que o balde mostra.
//
// A conta de cada balde é a do Resumo do dia, e não uma segunda: um balde feito
// de amostras passa pelo mesmo `summarizeDay`, e um dia fechado lê a linha que
// ele já gravou. Assim o gráfico da semana nunca discorda do Resumo do dia.

export type SeriesPeriod = 'day' | 'week' | 'month'

export const SERIES_PERIODS: readonly SeriesPeriod[] = ['day', 'week', 'month']

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Quantos dias monitorados cada período cobre, terminando no dia de hoje. */
const DAYS_IN: Record<Exclude<SeriesPeriod, 'day'>, number> = { week: 7, month: 30 }

export interface SeriesBucket {
  start: Date
  end: Date
  /** O dia monitorado a que o balde pertence, como data pura. */
  day: Date
}

/**
 * Os baldes do período, do mais antigo para o mais recente. "Hoje" começa na
 * meia-noite de Brasília e para na hora corrente: hora que ainda não começou
 * não é balde vazio, é futuro, e mostrá-la sugeriria silêncio de quem nem
 * teve chance de medir.
 */
export function seriesBuckets(
  period: SeriesPeriod,
  now: Date,
): { bucket: 'hour' | 'day'; buckets: SeriesBucket[] } {
  const today = monitoredDayOf(now)
  if (period === 'day') {
    const { start } = monitoredDayWindow(today)
    const buckets: SeriesBucket[] = []
    for (let at = start.getTime(); at <= now.getTime() && at < start.getTime() + DAY; at += HOUR) {
      buckets.push({ start: new Date(at), end: new Date(at + HOUR), day: today })
    }
    return { bucket: 'hour', buckets }
  }
  const buckets: SeriesBucket[] = []
  for (let i = DAYS_IN[period] - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * DAY)
    const { start, end } = monitoredDayWindow(day)
    buckets.push({ start, end, day })
  }
  return { bucket: 'day', buckets }
}

/** As colunas do Resumo do dia que a série lê. */
export interface SeriesSummaryRow {
  day: Date
  heartRateMin: number | null
  heartRateMax: number | null
  heartRateAvg: number | null
  stepsTotal: number | null
  distanceTotalM: number | null
  activeEnergyKcalTotal: number | null
  coveredMs: number | null
}

export interface SeriesPoint {
  /** ISO-8601 do início do balde. */
  start: string
  /** ISO-8601 do fim do balde, exclusivo. */
  end: string
  activeEnergyKcal: number | null
  steps: number | null
  distanceM: number | null
  heartRate: { avg: number | null; min: number | null; max: number | null }
  /**
   * Fração do balde coberta por leituras, de 0 a 1, pela regra do tempo
   * coberto do Resumo. No balde corrente o denominador é o tempo já decorrido.
   */
  coverage: number
}

export interface WorkerSeries {
  workerId: string
  period: SeriesPeriod
  /** Nula enquanto o funcionário nunca reportou. Nunca mistura as duas. */
  origin: TelemetryOrigin | null
  bucket: 'hour' | 'day'
  /** ISO-8601 do início do primeiro balde. */
  from: string
  /** ISO-8601 do instante da leitura. */
  to: string
  points: SeriesPoint[]
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10)
const round0 = (n: number | null): number | null => (n === null ? null : Math.round(n))

/**
 * Cobertura sobre o tempo que o balde de fato teve. Sem leitura alguma é zero,
 * e é o par nulo dos valores que diz "ninguém mediu"; a cobertura só mede
 * quanto do balde as leituras abrangem.
 */
function coverageOf(coveredMs: number | null, bucket: SeriesBucket, now: Date): number {
  const elapsed = Math.min(bucket.end.getTime(), now.getTime()) - bucket.start.getTime()
  if (coveredMs === null || elapsed <= 0) return 0
  return Math.min(1, Math.max(0, coveredMs / elapsed))
}

function emptyPoint(bucket: SeriesBucket): SeriesPoint {
  return {
    start: bucket.start.toISOString(),
    end: bucket.end.toISOString(),
    activeEnergyKcal: null,
    steps: null,
    distanceM: null,
    heartRate: { avg: null, min: null, max: null },
    coverage: 0,
  }
}

function pointOf(row: SeriesSummaryRow, bucket: SeriesBucket, now: Date): SeriesPoint {
  return {
    start: bucket.start.toISOString(),
    end: bucket.end.toISOString(),
    activeEnergyKcal: round1(row.activeEnergyKcalTotal),
    steps: row.stepsTotal,
    distanceM: round0(row.distanceTotalM),
    heartRate: { avg: round1(row.heartRateAvg), min: row.heartRateMin, max: row.heartRateMax },
    coverage: coverageOf(row.coveredMs, bucket, now),
  }
}

/** Um balde feito de amostras, pela mesma conta do Resumo do dia. */
function pointFromSamples(
  samples: readonly SummarizerSample[],
  bucket: SeriesBucket,
  ctx: { workerId: string; origin: TelemetryOrigin; now: Date },
): SeriesPoint {
  const summary = summarizeDay(
    { workerId: ctx.workerId, day: bucket.day, origin: ctx.origin, samples, assessments: [] },
    ctx.now,
  )
  return summary === null ? emptyPoint(bucket) : pointOf(summary, bucket, ctx.now)
}

export interface SeriesInput {
  workerId: string
  period: SeriesPeriod
  now: Date
  origin: TelemetryOrigin | null
  /** Resumos do dia já gravados para a janela, na origem da série. */
  summaries: readonly SeriesSummaryRow[]
  /** Amostras dos baldes que ainda não têm Resumo, na origem da série. */
  samples: readonly SummarizerSample[]
  /**
   * Primeiro instante de dia que o ciclo de vida ainda não resumiu. Balde
   * diário que começa antes disso e não tem Resumo fica vazio: o Resumo é a
   * fonte do dia fechado, e recalculá-lo aqui leria um mês de amostras.
   */
  openFrom: Date
}

const dayKey = (day: Date) => day.toISOString().slice(0, 10)

export function assembleSeries(input: SeriesInput): WorkerSeries {
  const { bucket, buckets } = seriesBuckets(input.period, input.now)
  const from = (buckets[0]?.start ?? input.now).toISOString()
  const base = {
    workerId: input.workerId,
    period: input.period,
    origin: input.origin,
    bucket,
    from,
    to: input.now.toISOString(),
  }

  const origin = input.origin
  if (origin === null) return { ...base, points: buckets.map(emptyPoint) }

  // Amostras distribuídas uma vez, por balde. Fora da janela da série não
  // entram em balde nenhum.
  const byBucket = new Map<number, SummarizerSample[]>()
  for (const s of input.samples) {
    const t = s.eventTime.getTime()
    const b = buckets.find((x) => t >= x.start.getTime() && t < x.end.getTime())
    if (!b) continue
    const list = byBucket.get(b.start.getTime())
    if (list) list.push(s)
    else byBucket.set(b.start.getTime(), [s])
  }
  const summaries = new Map(input.summaries.map((r) => [dayKey(r.day), r]))
  const ctx = { workerId: input.workerId, origin, now: input.now }

  const points = buckets.map((b) => {
    const samples = byBucket.get(b.start.getTime()) ?? []
    if (bucket === 'hour') return pointFromSamples(samples, b, ctx)
    const summary = summaries.get(dayKey(b.day))
    if (summary) return pointOf(summary, b, input.now)
    if (b.end.getTime() > input.openFrom.getTime()) return pointFromSamples(samples, b, ctx)
    return emptyPoint(b)
  })
  return { ...base, points }
}
