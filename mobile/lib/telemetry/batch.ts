export interface Stamped { recordedAt: number; }

/** Keep at most one sample per intervalMs window (earliest wins per window). */
export function downsample<T extends Stamped>(samples: T[], intervalMs: number): T[] {
  const out: T[] = [];
  let lastKept: number | null = null;
  for (const s of [...samples].sort((a, b) => a.recordedAt - b.recordedAt)) {
    if (lastKept === null || s.recordedAt - lastKept >= intervalMs) { out.push(s); lastKept = s.recordedAt; }
  }
  return out;
}

export function shouldFlush(bufferLen: number, oldestTs: number | null, now: number, maxSize: number, maxAgeMs: number): boolean {
  if (bufferLen >= maxSize) return true;
  if (oldestTs !== null && now - oldestTs >= maxAgeMs) return true;
  return false;
}

export function aggregate(values: number[]): { avg: number; min: number; max: number } {
  if (values.length === 0) return { avg: 0, min: 0, max: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: sum / values.length, min: Math.min(...values), max: Math.max(...values) };
}
