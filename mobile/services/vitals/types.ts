export type WorkerStatus = 'good' | 'alert' | 'low' | 'unknown';

export interface Vitals {
  heartRate: number;
  bloodPressureSys: number;
  bloodPressureDia: number;
  oxygenation: number;
  caloriesPerHour: number;
  steps: number;
  distanceKm: number;
  effortPct: number;
  fatiguePct: number;
  fatigueEtaMin: number;
}

export type VitalsPhase = 'loading' | 'ready' | 'empty' | 'stale' | 'error';

/** getCurrent resolves null to mean "no data yet" (empty). Throwing = error. */
export interface VitalsBackend {
  getCurrent(): Promise<Vitals | null>;
}
