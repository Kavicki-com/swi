import {
  elapsedSeconds, progressPct, formatDuration,
  startAnchors, pauseAnchors, resumeAnchors, endAnchors,
  type Anchors,
} from './progress';

const T0 = 1_000_000_000_000; // epoch ms fixo (determinístico)

describe('progress: elapsedSeconds', () => {
  it('parado retorna accumulatedSeconds', () => {
    const a: Anchors = { startedAt: null, accumulatedSeconds: 120, running: false };
    expect(elapsedSeconds(a, T0)).toBe(120);
  });
  it('rodando soma o segmento atual', () => {
    const a: Anchors = { startedAt: T0, accumulatedSeconds: 100, running: true };
    expect(elapsedSeconds(a, T0 + 30_000)).toBe(130); // +30s
  });
  it('nunca negativo se now < startedAt (clock skew)', () => {
    const a: Anchors = { startedAt: T0, accumulatedSeconds: 50, running: true };
    expect(elapsedSeconds(a, T0 - 5_000)).toBe(50);
  });
});

describe('progress: progressPct', () => {
  it('proporcional ao estimado, cap 100', () => {
    expect(progressPct(90 * 60, 180)).toBe(50);   // 90min de 180min
    expect(progressPct(999 * 60, 180)).toBe(100); // cap
  });
  it('estimado 0 → 0 (sem divisão por zero)', () => {
    expect(progressPct(100, 0)).toBe(0);
  });
});

describe('progress: formatDuration', () => {
  it('formata h:mm:ss', () => {
    expect(formatDuration(7 * 3600 + 55 * 60 + 12)).toBe('7:55:12');
    expect(formatDuration(0)).toBe('0:00:00');
  });
});

describe('progress: transições (reducers puros)', () => {
  it('start começa um segmento rodando', () => {
    const a = startAnchors({ startedAt: null, accumulatedSeconds: 0, running: false }, T0);
    expect(a).toEqual({ startedAt: T0, accumulatedSeconds: 0, running: true });
  });
  it('pause banca o elapsed e para', () => {
    const a = pauseAnchors({ startedAt: T0, accumulatedSeconds: 10, running: true }, T0 + 20_000);
    expect(a).toEqual({ startedAt: null, accumulatedSeconds: 30, running: false });
  });
  it('resume reabre um segmento sem perder o banco', () => {
    const a = resumeAnchors({ startedAt: null, accumulatedSeconds: 30, running: false }, T0 + 50_000);
    expect(a).toEqual({ startedAt: T0 + 50_000, accumulatedSeconds: 30, running: true });
  });
  it('end banca o segmento final e para', () => {
    const a = endAnchors({ startedAt: T0, accumulatedSeconds: 5, running: true }, T0 + 15_000);
    expect(a).toEqual({ startedAt: null, accumulatedSeconds: 20, running: false });
  });
});
