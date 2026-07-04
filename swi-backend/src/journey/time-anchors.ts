// Matemática PURA de âncoras de tempo — porta de mobile/services/journey/progress.ts.
// Servidor grava nas transições; cliente ticka o display. Tempos em segundos;
// startedAt/nowMs em epoch ms (determinístico, injetável em teste).
export interface Anchors {
  startedAt: number | null
  accumulatedSeconds: number
  running: boolean
}

export function elapsedSeconds(a: Anchors, nowMs: number): number {
  if (!a.running || a.startedAt == null) return a.accumulatedSeconds
  return a.accumulatedSeconds + Math.max(0, Math.floor((nowMs - a.startedAt) / 1000))
}

export function progressPct(elapsedSec: number, estimatedMinutes: number): number {
  if (estimatedMinutes <= 0) return 0
  return Math.min(100, (elapsedSec / (estimatedMinutes * 60)) * 100)
}

export function startAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
export function pauseAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false }
}
export function resumeAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
export function endAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false }
}
