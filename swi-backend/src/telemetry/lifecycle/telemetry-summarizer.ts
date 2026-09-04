import { FRESHNESS } from '../domain/metric-state'
import type { MeasurementSource, TelemetryOrigin } from '../domain/telemetry.types'

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
export const SUMMARIZER_VERSION = 'swi-daily-summary-2'

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
  activeEnergyKcal: number | null
  batteryPercent: number | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
}

/** Uma avaliação de esforço e desgaste do dia. */
export interface SummarizerAssessment {
  computedAt: Date
  effortPercent: number | null
  wearPercent: number | null
}

/**
 * A partir de quanto uma avaliação conta como esforço ou desgaste alto. O
 * limite é inclusivo: 80 exato já é alto.
 */
const HIGH_PERCENT = 80

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

  activeEnergyKcalTotal: number | null
  activeEnergyCount: number | null

  effortMax: number | null
  effortAvg: number | null
  effortCount: number | null
  effortAbove80Ms: number | null
  wearMax: number | null
  wearAvg: number | null
  wearCount: number | null
  wearAbove80Ms: number | null

  bloodPressureCount: number | null
  lastSystolicMmHg: number | null
  lastDiastolicMmHg: number | null
  lastBloodPressureSource: MeasurementSource | null
  lastBloodPressureAt: Date | null

  batteryMin: number | null

  sampleCount: number
  sessionCount: number | null
  firstSampleAt: Date | null
  lastSampleAt: Date | null
  coveredMs: number | null

  summarizerVersion: string
  computedAt: Date
}

/** Máximo, média e quantidade de uma métrica, ou null quando ninguém mediu. */
interface Stats {
  max: number
  avg: number
  count: number
}

function statsOf(values: readonly number[]): Stats | null {
  const range = extremes(values)
  if (range === null) return null
  return {
    max: range.max,
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    count: values.length,
  }
}

/**
 * Tempo em que a métrica esteve em 80 por cento ou mais, pela mesma regra do
 * tempo coberto: soma dos intervalos entre avaliações ALTAS consecutivas, sem
 * as lacunas. Uma avaliação baixa no meio quebra a sequência, porque contar
 * aquele intervalo afirmaria esforço alto num momento medido baixo. Uma
 * avaliação SEM valor não está aqui: ela é silêncio, e silêncio curto não
 * quebra, como no tempo coberto.
 *
 * Exige entrada já ordenada por instante; quem ordena é summarizeDay, uma vez.
 */
function highMsOfOrdered(ordered: readonly { at: number; value: number }[]): number {
  let high = 0
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1]
    const current = ordered[i]
    if (previous.value < HIGH_PERCENT || current.value < HIGH_PERCENT) continue
    const gap = current.at - previous.at
    if (gap <= MAX_GAP_MS) high += gap
  }
  return high
}

/**
 * A última aferição do dia. Empate de instante (possível entre sessões) é
 * desfeito pela maior sistólica e depois pela maior diastólica: determinístico,
 * e num empate real o Resumo errar para o lado do cuidado é o erro certo.
 */
function lastPressureOf(ordered: readonly SummarizerSample[]): SummarizerSample | null {
  let last: SummarizerSample | null = null
  for (const s of ordered) {
    if (last === null || s.eventTime.getTime() > last.eventTime.getTime()) {
      last = s
      continue
    }
    if (s.eventTime.getTime() < last.eventTime.getTime()) continue
    const sys = (s.systolicMmHg as number) - (last.systolicMmHg as number)
    const dia = (s.diastolicMmHg as number) - (last.diastolicMmHg as number)
    if (sys > 0 || (sys === 0 && dia > 0)) last = s
  }
  return last
}

/**
 * Soma dos intervalos entre instantes consecutivos, descartando os maiores que
 * o prazo. Um instante só cobre zero: houve leitura, e ela não abrange
 * intervalo nenhum. Isso é diferente de não ter havido leitura, que é nulo.
 *
 * Exige entrada já ordenada; quem ordena é summarizeDay, uma vez.
 */
function coveredMsOfOrdered(ordered: readonly number[]): number {
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
  if (input.samples.length === 0 && input.assessments.length === 0) return null

  // Ordena uma vez, na entrada, e todo o resto lê daqui. A consulta não pede
  // ordenação ao banco, e soma de ponto flutuante não é associativa: sem isto,
  // duas rodadas sobre o mesmo dia poderiam gravar totais de energia
  // diferentes nos últimos bits, e o Resumo deixaria de ser recomputável.
  const samples = [...input.samples].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime())
  const assessments = [...input.assessments].sort(
    (a, b) => a.computedAt.getTime() - b.computedAt.getTime(),
  )

  const times = samples.map((s) => s.eventTime.getTime())
  // flatMap e não filter: ele estreita o tipo no mesmo passo, então a conta
  // adiante não precisa de um `?? 0` que esconderia medição ausente como zero.
  const beats = samples.flatMap((s) => (s.heartRateBpm === null ? [] : [s.eventTime.getTime()]))
  const bpm = samples.flatMap((s) => (s.heartRateBpm === null ? [] : [s.heartRateBpm]))
  const steps = samples.flatMap((s) => (s.stepDelta === null ? [] : [s.stepDelta]))
  const energy = samples.flatMap((s) => (s.activeEnergyKcal === null ? [] : [s.activeEnergyKcal]))
  const battery = samples.flatMap((s) => (s.batteryPercent === null ? [] : [s.batteryPercent]))

  // Pressão é o par, não dois números soltos: meia medição não é aferição.
  const pressures = samples.filter(
    (s) => s.systolicMmHg !== null && s.diastolicMmHg !== null,
  )
  const lastPressure = lastPressureOf(pressures)

  const effort = assessments.flatMap((a) => (a.effortPercent === null ? [] : [a.effortPercent]))
  const wear = assessments.flatMap((a) => (a.wearPercent === null ? [] : [a.wearPercent]))
  const effortStats = statsOf(effort)
  const wearStats = statsOf(wear)

  const bpmRange = extremes(bpm)
  const batteryRange = extremes(battery)
  const timeRange = extremes(times)

  return {
    workerId: input.workerId,
    day: input.day,
    origin: input.origin,

    heartRateMin: bpmRange === null ? null : bpmRange.min,
    heartRateMax: bpmRange === null ? null : bpmRange.max,
    heartRateAvg: bpm.length === 0 ? null : bpm.reduce((a, b) => a + b, 0) / bpm.length,
    heartRateCount: bpm.length === 0 ? null : bpm.length,
    heartRateCoveredMs: beats.length === 0 ? null : coveredMsOfOrdered(beats),

    stepsTotal: steps.length === 0 ? null : steps.reduce((a, b) => a + b, 0),
    stepsCount: steps.length === 0 ? null : steps.length,

    activeEnergyKcalTotal: energy.length === 0 ? null : energy.reduce((a, b) => a + b, 0),
    activeEnergyCount: energy.length === 0 ? null : energy.length,

    effortMax: effortStats?.max ?? null,
    effortAvg: effortStats?.avg ?? null,
    effortCount: effortStats?.count ?? null,
    effortAbove80Ms:
      effortStats === null
        ? null
        : highMsOfOrdered(
            assessments.flatMap((a) =>
              a.effortPercent === null ? [] : [{ at: a.computedAt.getTime(), value: a.effortPercent }],
            ),
          ),
    wearMax: wearStats?.max ?? null,
    wearAvg: wearStats?.avg ?? null,
    wearCount: wearStats?.count ?? null,
    wearAbove80Ms:
      wearStats === null
        ? null
        : highMsOfOrdered(
            assessments.flatMap((a) =>
              a.wearPercent === null ? [] : [{ at: a.computedAt.getTime(), value: a.wearPercent }],
            ),
          ),

    bloodPressureCount: pressures.length === 0 ? null : pressures.length,
    lastSystolicMmHg: lastPressure?.systolicMmHg ?? null,
    lastDiastolicMmHg: lastPressure?.diastolicMmHg ?? null,
    lastBloodPressureSource: lastPressure?.bloodPressureSource ?? null,
    lastBloodPressureAt: lastPressure?.eventTime ?? null,

    batteryMin: batteryRange === null ? null : batteryRange.min,

    sampleCount: samples.length,
    sessionCount:
      samples.length === 0 ? null : new Set(samples.map((s) => s.sessionId)).size,
    firstSampleAt: timeRange === null ? null : new Date(timeRange.min),
    lastSampleAt: timeRange === null ? null : new Date(timeRange.max),
    coveredMs: times.length === 0 ? null : coveredMsOfOrdered(times),

    summarizerVersion: SUMMARIZER_VERSION,
    computedAt,
  }
}
