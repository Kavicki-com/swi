// Matemática PURA de âncoras de tempo, compartilhada por Task + Journey, pelo
// mock backend (grava nas transições) e pelo tick do cliente (display). Tempos
// em segundos; `startedAt`/`nowMs` em epoch ms pra ser determinístico e
// injetável em teste.

export interface Anchors {
  startedAt: number | null;   // epoch ms; null quando parado
  accumulatedSeconds: number; // segundos bancados antes do segmento atual
  running: boolean;           // true enquanto o segmento atual roda
}

export function elapsedSeconds(a: Anchors, nowMs: number): number {
  if (!a.running || a.startedAt == null) return a.accumulatedSeconds;
  return a.accumulatedSeconds + Math.max(0, Math.floor((nowMs - a.startedAt) / 1000));
}

export function progressPct(elapsedSec: number, estimatedMinutes: number): number {
  if (estimatedMinutes <= 0) return 0;
  return Math.min(100, (elapsedSec / (estimatedMinutes * 60)) * 100);
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

// Iniciar ou retomar o que já está correndo não mexe em nada, igual ao
// servidor (swi-backend/src/journey/time-anchors.ts). A fila de envios reaplica
// na tela ações que o servidor talvez já tenha aplicado; reiniciar o segmento
// aqui jogaria fora o tempo corrido.
export function startAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a;
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true };
}
export function pauseAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false };
}
export function resumeAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a;
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true };
}
export function endAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false };
}
