import { FRESHNESS } from '../domain/metric-state'
import type { TelemetryOrigin } from '../domain/telemetry.types'

// Resumidor do dia monitorado. É função pura, com o instante do cálculo por
// parâmetro, e é isso que torna o Resumo recomputável: apagada a Leitura bruta,
// a única defesa contra um número errado é poder refazê-lo a partir do que
// sobrou. Nada aqui lê relógio, banco ou Prisma.
//
// O que este módulo NÃO faz: decidir que dia resumir, buscar linha ou gravar.
// Isso é do serviço de ciclo de vida. Aqui só entra a série de um dia, de um
// funcionário, de uma origem.

/**
 * Muda quando a conta muda. Fica gravado na linha para que um Resumo antigo
 * possa ser reconhecido como produto de outra regra, em vez de ser comparado
 * com um novo como se fossem a mesma coisa.
 */
export const SUMMARIZER_VERSION = 'swi-daily-summary-1'

/**
 * Intervalo máximo entre duas leituras que ainda conta como tempo coberto.
 *
 * É o mesmo prazo que torna uma leitura indisponível no painel, e vem do
 * domínio de propósito: se o Resumo tivesse limite próprio, ele diria que o
 * aparelho cobriu um período que a tela do mesmo dia mostrou como silêncio.
 * A fronteira é inclusiva, como a da qualidade.
 */
const MAX_GAP_MS = FRESHNESS.VITAL.staleMs

/** Uma Leitura como o resumidor precisa vê-la. */
export interface SummarizerSample {
  eventTime: Date
  sessionId: string
  heartRateBpm: number | null
  stepDelta: number | null
}

/** Uma avaliação de esforço e desgaste do dia. */
export interface SummarizerAssessment {
  computedAt: Date
  effortPercent: number | null
  wearPercent: number | null
}

export interface DailySummaryInput {
  workerId: string
  /** Data pura do dia civil em Brasília, em meia-noite UTC. */
  day: Date
  origin: TelemetryOrigin
  samples: readonly SummarizerSample[]
  assessments: readonly SummarizerAssessment[]
}

/**
 * A linha do Resumo. Toda estatística é anulável porque métrica ausente é
 * desconhecida, nunca zero. `sampleCount` é a exceção: quando existe linha, a
 * quantidade de leituras é fato apurado, inclusive quando é zero.
 */
export interface DailySummary {
  workerId: string
  day: Date
  origin: TelemetryOrigin

  heartRateMin: number | null
  heartRateMax: number | null
  heartRateAvg: number | null
  heartRateCount: number | null
  heartRateCoveredMs: number | null

  stepsTotal: number | null
  stepsCount: number | null

  sampleCount: number
  firstSampleAt: Date | null
  lastSampleAt: Date | null
  coveredMs: number | null

  summarizerVersion: string
  computedAt: Date
}

/**
 * Soma dos intervalos entre instantes consecutivos, descartando os maiores que
 * o prazo. Um instante só cobre zero: houve leitura, e ela não abrange
 * intervalo nenhum. Isso é diferente de não ter havido leitura, que é nulo.
 *
 * Ordena antes de somar: a varredura carrega as linhas na ordem que o banco
 * quiser, e a ordem de chegada não pode aparecer no número.
 */
function coveredMsOf(times: readonly number[]): number {
  const ordered = [...times].sort((a, b) => a - b)
  let covered = 0
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i] - ordered[i - 1]
    if (gap <= MAX_GAP_MS) covered += gap
  }
  return covered
}

/**
 * Menor e maior valor por laço, e não por `Math.min(...valores)`: o spread
 * empilha cada elemento como argumento, e um dia cheio passa de cem mil
 * leituras. O estouro derrubaria justamente o dia com mais dado, e ele nunca
 * ganharia Resumo. Devolve null para lista vazia, que é "ninguém mediu".
 */
function extremes(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/**
 * Resume um dia fechado. Devolve null quando não houve nada a resumir: um dia
 * sem leitura e sem avaliação não é um dia de zeros, é um dia sem dado, e
 * gravar a linha inventaria um monitoramento que não aconteceu.
 */
export function summarizeDay(input: DailySummaryInput, computedAt: Date): DailySummary | null {
  const { samples, assessments } = input
  if (samples.length === 0 && assessments.length === 0) return null

  const times = samples.map((s) => s.eventTime.getTime())
  // flatMap e não filter: ele estreita o tipo no mesmo passo, então a conta
  // adiante não precisa de um `?? 0` que esconderia medição ausente como zero.
  const beats = samples.flatMap((s) => (s.heartRateBpm === null ? [] : [s.eventTime.getTime()]))
  const bpm = samples.flatMap((s) => (s.heartRateBpm === null ? [] : [s.heartRateBpm]))
  const steps = samples.flatMap((s) => (s.stepDelta === null ? [] : [s.stepDelta]))

  const bpmRange = extremes(bpm)
  const timeRange = extremes(times)

  return {
    workerId: input.workerId,
    day: input.day,
    origin: input.origin,

    heartRateMin: bpmRange === null ? null : bpmRange.min,
    heartRateMax: bpmRange === null ? null : bpmRange.max,
    heartRateAvg: bpm.length === 0 ? null : bpm.reduce((a, b) => a + b, 0) / bpm.length,
    heartRateCount: bpm.length === 0 ? null : bpm.length,
    heartRateCoveredMs: beats.length === 0 ? null : coveredMsOf(beats),

    stepsTotal: steps.length === 0 ? null : steps.reduce((a, b) => a + b, 0),
    stepsCount: steps.length === 0 ? null : steps.length,

    sampleCount: samples.length,
    firstSampleAt: timeRange === null ? null : new Date(timeRange.min),
    lastSampleAt: timeRange === null ? null : new Date(timeRange.max),
    coveredMs: times.length === 0 ? null : coveredMsOf(times),

    summarizerVersion: SUMMARIZER_VERSION,
    computedAt,
  }
}
