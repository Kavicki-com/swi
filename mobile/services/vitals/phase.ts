import type { Vitals, VitalsPhase } from './types';

export interface PhaseInput {
  lastValue: Vitals | null | undefined; // undefined = none received yet; null = backend said empty
  lastUpdated: number | null;
  now: number;
  errored: boolean;
  staleMs: number;
}

export function computePhase(i: PhaseInput): VitalsPhase {
  if (i.errored) return 'error';
  if (i.lastValue === undefined) return 'loading';
  if (i.lastValue === null) return 'empty';
  if (i.lastUpdated !== null && i.now - i.lastUpdated > i.staleMs) return 'stale';
  return 'ready';
}
