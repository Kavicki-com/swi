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
}

const MINUTE_MS = 60_000

export function assessSparseDay(input: SparseInput): SparseResult {
  const { profile, baseline, samples } = input
  const empty = { effortPercent: null, wearPercent: null, fatigueEtaMin: null } as const
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
  }

  return {
    effortPercent: ema === null ? null : Math.round(100 * clamp(ema, 0, 1)),
    wearPercent: wearOf(dose, profile.doseScale),
    fatigueEtaMin: null,
    measuredUntilMs,
    unavailableReason: null,
    gapsOverMax,
  }
}
