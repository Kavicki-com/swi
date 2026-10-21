import type { Prisma } from '@prisma/client'
import { percentile } from '../calibration/percentile'
import { alphaFor, clamp, decayed, wearOf, type Baseline, type UnavailableReason } from './fatigue-formula'
import type { SparseProfile } from './sparse-profile'

// Fórmula esparsa: o dia inteiro de uma pulseira, recalculado do zero a cada
// sincronização. Pura como a do relógio. A diferença não é a fisiologia, é a
// entrada: as leituras chegam espaçadas e fora de ordem de chegada (cada app
// sincroniza numa hora), então uma cadeia incremental perderia o batimento que
// chegasse depois da janela já fechada. Recalcular o dia é barato: centenas de
// leituras por pessoa, uma vez por sincronização, fora da rota ao vivo.
//
// O desgaste vale NA ÚLTIMA LEITURA e não decai até agora: decair faria uma
// pulseira que parou de sincronizar parecer recuperada. Quem mostra o número
// mostra junto até quando ele foi medido.

export interface SparseSample {
  atMs: number
  bpm: number
}

export interface SparseInput {
  profile: SparseProfile
  baseline: Baseline
  /** Batimentos do dia, em ordem crescente de atMs. */
  samples: readonly SparseSample[]
}

/**
 * O dia da pulseira até a última leitura, para o Resumo diário. A esparsa não
 * grava uma avaliação por batimento como o relógio, então o pico de desgaste e
 * os percentis do esforço só existem aqui, enquanto o dia é refeito.
 */
export interface SparseDayStats {
  wearMax: number | null
  effortP25: number | null
  effortP90: number | null
}

/** Esforço e desgaste logo depois de cada batimento do dia. */
export interface SparsePoint {
  atMs: number
  effortPercent: number
  wearPercent: number
}

export interface SparseResult {
  effortPercent: number | null
  wearPercent: number | null
  /** Sempre nulo: projetar a partir de um momento passado seria previsão falsa. */
  fatigueEtaMin: null
  /** Instante da última leitura do dia. Nulo sem leitura. */
  measuredUntilMs: number | null
  unavailableReason: UnavailableReason | null
  /** Intervalos acima de gapMaxMs, que decaíram a dose sem acrescentar nada. */
  gapsOverMax: number
  dayStats: SparseDayStats
  /** Fica em memória: um dia tem centenas de pontos, e o banco não precisa deles. */
  points: SparsePoint[]
}

const MINUTE_MS = 60_000

const NO_DAY_STATS: SparseDayStats = Object.freeze({ wearMax: null, effortP25: null, effortP90: null })

export function assessSparseDay(input: SparseInput): SparseResult {
  const { profile, baseline, samples } = input
  const empty = {
    effortPercent: null,
    wearPercent: null,
    fatigueEtaMin: null,
    dayStats: { ...NO_DAY_STATS },
    points: [],
  }
  if (samples.length === 0) {
    return {
      ...empty,
      measuredUntilMs: null,
      unavailableReason: baseline.kind === 'unavailable' ? baseline.reason : 'no_heart_rate',
      gapsOverMax: 0,
    }
  }
  const measuredUntilMs = samples[samples.length - 1].atMs
  if (baseline.kind === 'unavailable') {
    return { ...empty, measuredUntilMs, unavailableReason: baseline.reason, gapsOverMax: 0 }
  }

  const reserve = Math.max(1, baseline.maxBpm - baseline.restingBpm)
  let dose = 0
  let ema: number | null = null
  let previousMs: number | null = null
  let gapsOverMax = 0
  const points: SparsePoint[] = []

  for (const s of samples) {
    const dtMs = previousMs === null ? 0 : Math.max(0, s.atMs - previousMs)
    dose = decayed(dose, dtMs, profile.decayMinutes)
    const hrr = clamp((s.bpm - baseline.restingBpm) / reserve, 0, profile.intensityCeiling)
    ema = ema === null ? hrr : ema + alphaFor(dtMs, profile.emaAlphaPer15s) * (hrr - ema)
    if (previousMs !== null) {
      if (dtMs <= profile.gapMaxMs) dose += hrr ** profile.doseExponent * (dtMs / MINUTE_MS)
      else gapsOverMax += 1
    }
    previousMs = s.atMs
    points.push({
      atMs: s.atMs,
      effortPercent: Math.round(100 * clamp(ema, 0, 1)),
      wearPercent: wearOf(dose, profile.doseScale),
    })
  }

  const efforts = points.map((p) => p.effortPercent)
  const last = points[points.length - 1]
  return {
    effortPercent: last.effortPercent,
    wearPercent: last.wearPercent,
    fatigueEtaMin: null,
    measuredUntilMs,
    unavailableReason: null,
    gapsOverMax,
    dayStats: {
      wearMax: points.reduce((max, p) => Math.max(max, p.wearPercent), 0),
      effortP25: percentile(efforts, 25),
      effortP90: percentile(efforts, 90),
    },
    points,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumberOrNull = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v))

/**
 * Lê `inputs.dayStats` de uma avaliação esparsa gravada. Defensivo como o
 * `heartRateReferenceOf`: avaliação antiga não tem o campo, e campo torto não
 * pode virar número no Resumo. Qualquer formato fora do esperado dá nulo.
 */
export function dayStatsOf(inputs: Prisma.JsonValue | null): SparseDayStats | null {
  if (!isRecord(inputs)) return null
  const stats = inputs.dayStats
  if (!isRecord(stats)) return null
  const { wearMax, effortP25, effortP90 } = stats
  if (!isNumberOrNull(wearMax) || !isNumberOrNull(effortP25) || !isNumberOrNull(effortP90)) return null
  return { wearMax, effortP25, effortP90 }
}
