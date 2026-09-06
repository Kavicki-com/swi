import type { Scenario } from '../fatigue-simulator'

// Cenários controlados do simulador. Cada trecho é (segundos, BPM ou nulo,
// picos por minuto ou nulo). Cadência de 5 s entre amostras. "backlog" tem
// eventTime velho o bastante para a ingestão classificar como backlog, e o
// simulador reproduz a regra: backlog não avalia.

export interface ControlledSession {
  scenario: Scenario
  expectedFinal: { effort: number | null; wear: number | null } | null
}

export const CONTROLLED_SESSIONS: Record<string, ControlledSession> = {
  rest: {
    scenario: { cadenceSec: 5, segments: [[30 * 60, 66, 2]] },
    expectedFinal: { effort: 3, wear: 0 },
  },
  light: {
    scenario: { cadenceSec: 5, segments: [[30 * 60, 95, 30]] },
    expectedFinal: { effort: 29, wear: 3 },
  },
  moderate: {
    scenario: { cadenceSec: 5, segments: [[30 * 60, 125, 54]] },
    expectedFinal: { effort: 54, wear: 8 },
  },
  intense: {
    scenario: { cadenceSec: 5, segments: [[30 * 60, 165, 90]] },
    expectedFinal: { effort: 89, wear: 17 },
  },
  recovery: {
    scenario: { cadenceSec: 5, segments: [[20 * 60, 165, 90], [40 * 60, 75, 5]] },
    expectedFinal: { effort: 9, wear: 10 },
  },
  signalLoss: {
    scenario: { cadenceSec: 5, segments: [[10 * 60, 140, 60], [3 * 60, null, null], [5 * 60, 140, 60]] },
    expectedFinal: { effort: 65, wear: 6 },
  },
  backlog: {
    scenario: { cadenceSec: 5, segments: [[10 * 60, 140, 60]], backlog: true },
    expectedFinal: null,
  },
}
