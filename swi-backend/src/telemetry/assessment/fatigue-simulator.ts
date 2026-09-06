import type { AssessmentProfile } from './assessment-profile'
import { assessWindow, type Baseline, type FormulaResult, type FormulaSample, type FormulaState } from './fatigue-formula'

// Simulador determinístico da avaliação. Gera amostras a partir de trechos
// (duração, BPM, picos por minuto) e corre a fórmula em janelas de 15 s,
// encadeando o estado como o serviço faz. Não conhece banco nem relógio.

/** Trecho: segundos, BPM (nulo é perda de sinal), picos por minuto (nulo é sem movimento). */
export type Segment = readonly [seconds: number, bpm: number | null, peaksPerMinute: number | null]

export interface Scenario {
  cadenceSec: number
  segments: readonly Segment[]
  /** Backlog não avalia: o simulador devolve trilha vazia. */
  backlog?: boolean
}

export const WINDOW_MS = 15_000

export function samplesOf(scenario: Scenario, startMs = 0): FormulaSample[] {
  const out: FormulaSample[] = []
  let atMs = startMs
  for (const [seconds, bpm, peaksPerMinute] of scenario.segments) {
    const endMs = atMs + seconds * 1000
    while (atMs + scenario.cadenceSec * 1000 <= endMs) {
      atMs += scenario.cadenceSec * 1000
      out.push({
        atMs,
        heartRateBpm: bpm,
        motionCount: peaksPerMinute === null ? null : (peaksPerMinute * scenario.cadenceSec) / 60,
      })
    }
  }
  return out
}

export function simulate(scenario: Scenario, profile: AssessmentProfile, baseline: Baseline): FormulaResult[] {
  if (scenario.backlog) return []
  const samples = samplesOf(scenario)
  const lastMs = samples[samples.length - 1]?.atMs ?? 0
  const trace: FormulaResult[] = []
  let state: FormulaState | null = null
  for (let startMs = 0; startMs < lastMs; startMs += WINDOW_MS) {
    const endMs = startMs + WINDOW_MS
    const result = assessWindow({
      profile,
      previous: state,
      baseline,
      samples: samples.filter((s) => s.atMs > startMs && s.atMs <= endMs),
      window: { startMs, endMs },
    })
    trace.push(result)
    state = result.nextState
  }
  return trace
}

/**
 * Desgaste de regime permanente para intensidade constante, em forma fechada:
 * dD/dt = I^e - D/tau tem equilíbrio em D = tau * I^e. É a varredura de
 * parâmetros do plano sem simular horas.
 */
export function steadyStateWear(intensity: number, profile: AssessmentProfile): number {
  const dose = profile.decayMinutes * intensity ** profile.doseExponent
  return 100 * (1 - Math.exp(-dose / profile.doseScale))
}
