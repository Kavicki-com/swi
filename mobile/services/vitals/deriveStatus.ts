import type { Vitals, WorkerStatus } from './types';

// SAFETY: absent/stale data is 'unknown' (neutral), never 'good'.
export function deriveStatus(vitals: Vitals | null): WorkerStatus {
  if (!vitals) return 'unknown';
  if (vitals.oxygenation < 90 || vitals.heartRate > 110 || vitals.fatiguePct >= 90) return 'low';
  if (vitals.oxygenation < 94 || vitals.heartRate > 95 || vitals.fatiguePct >= 80) return 'alert';
  return 'good';
}
