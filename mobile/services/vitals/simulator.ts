import type { Vitals } from './types';

// Baseline = the Figma my-stats values (342:9419).
export const BASELINE_VITALS: Vitals = {
  heartRate: 67, bloodPressureSys: 12, bloodPressureDia: 8, oxygenation: 92.2,
  caloriesPerHour: 145, steps: 8975, distanceKm: 4.32, effortPct: 62.5,
  fatiguePct: 74, fatigueEtaMin: 105,
};

const clampDrift = (v: number, amp: number, min: number, max: number, rng: () => number) =>
  Math.min(max, Math.max(min, v + (rng() * 2 - 1) * amp));

/** Bounded random walk. rng() returns [0,1). Pure given rng. */
export function nextVitals(prev: Vitals, rng: () => number): Vitals {
  return {
    heartRate: Math.round(clampDrift(prev.heartRate, 3, 40, 140, rng)),
    bloodPressureSys: Math.round(clampDrift(prev.bloodPressureSys, 0.3, 9, 16, rng)),
    bloodPressureDia: Math.round(clampDrift(prev.bloodPressureDia, 0.3, 5, 11, rng)),
    oxygenation: Number(clampDrift(prev.oxygenation, 0.4, 80, 100, rng).toFixed(1)),
    caloriesPerHour: Math.round(clampDrift(prev.caloriesPerHour, 5, 60, 400, rng)),
    steps: Math.round(clampDrift(prev.steps, 20, 0, 30000, rng)),
    distanceKm: Number(clampDrift(prev.distanceKm, 0.02, 0, 20, rng).toFixed(2)),
    effortPct: Number(clampDrift(prev.effortPct, 1.5, 0, 100, rng).toFixed(1)),
    fatiguePct: Number(clampDrift(prev.fatiguePct, 1, 0, 100, rng).toFixed(1)),
    fatigueEtaMin: Math.max(0, Math.round(clampDrift(prev.fatigueEtaMin, 3, 0, 480, rng))),
  };
}
