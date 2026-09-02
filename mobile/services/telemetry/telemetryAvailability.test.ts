import { deriveTelemetryAvailability } from './telemetryAvailability';
import type { WatchDiagnosticsState } from './watchDiagnostics';

// Vocabulário em CONTEXT.md: sem suporte, indisponível, aguardando leitura,
// atual, desatualizado. Limiares congelados no plano do piloto: atual até 45s,
// desatualizado até 120s, indisponível acima disso.
//
// O relógio é injetado (`nowMs`); a função nunca lê o próprio.

const AGORA = Date.parse('2026-09-02T13:00:00.000Z');
const haSegundos = (s: number) => new Date(AGORA - s * 1000).toISOString();

const pronto = (over: Partial<Omit<WatchDiagnosticsState & { support: 'ready' }, 'support'>> = {}) =>
  ({
    support: 'ready',
    session: 'none',
    sessionChangedAt: null,
    lastSample: null,
    ...over,
  }) as WatchDiagnosticsState;

describe('deriveTelemetryAvailability', () => {
  it('sem módulo nativo é sem suporte, e não é confundido com indisponível', () => {
    expect(deriveTelemetryAvailability({ support: 'unsupported' }, AGORA)).toEqual({
      kind: 'unsupported',
    });
  });

  it('leitura recém-chegada é atual, com o BPM e o horário preservados', () => {
    const state = pronto({
      session: 'running',
      lastSample: { bpm: 72, measuredAt: haSegundos(0) },
    });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({
      kind: 'current',
      bpm: 72,
      measuredAt: haSegundos(0),
    });
  });

  it('45 segundos ainda é atual: a fronteira pertence ao estado melhor', () => {
    const state = pronto({ lastSample: { bpm: 70, measuredAt: haSegundos(45) } });
    expect(deriveTelemetryAvailability(state, AGORA).kind).toBe('current');
  });

  it('46 segundos é desatualizado', () => {
    const state = pronto({ lastSample: { bpm: 70, measuredAt: haSegundos(46) } });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({
      kind: 'stale',
      bpm: 70,
      measuredAt: haSegundos(46),
    });
  });

  it('120 segundos ainda é desatualizado', () => {
    const state = pronto({ lastSample: { bpm: 70, measuredAt: haSegundos(120) } });
    expect(deriveTelemetryAvailability(state, AGORA).kind).toBe('stale');
  });

  it('sessão ativa sem nenhuma leitura é aguardando leitura, não indisponível', () => {
    const state = pronto({ session: 'running', sessionChangedAt: haSegundos(3) });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({ kind: 'awaiting' });
  });

  it('sessão ativa com leitura velha demais volta a aguardar, porque o relógio está ligado', () => {
    const state = pronto({
      session: 'running',
      lastSample: { bpm: 70, measuredAt: haSegundos(121) },
    });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({ kind: 'awaiting' });
  });

  it('sem sessão e sem leitura é indisponível', () => {
    expect(deriveTelemetryAvailability(pronto(), AGORA)).toEqual({ kind: 'unavailable' });
  });

  it('sessão encerrada com leitura velha demais é indisponível', () => {
    const state = pronto({
      session: 'ended',
      lastSample: { bpm: 70, measuredAt: haSegundos(121) },
    });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({ kind: 'unavailable' });
  });

  it('sessão encerrada com leitura recente continua atual: a última leitura vale', () => {
    const state = pronto({
      session: 'ended',
      lastSample: { bpm: 65, measuredAt: haSegundos(10) },
    });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({
      kind: 'current',
      bpm: 65,
      measuredAt: haSegundos(10),
    });
  });

  it('horário ilegível é tratado como ausência de leitura, nunca como agora', () => {
    const state = pronto({ session: 'ended', lastSample: { bpm: 70, measuredAt: 'ontem' } });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({ kind: 'unavailable' });
  });

  it('leitura com horário no futuro não vira atual por acidente de relógio', () => {
    const state = pronto({
      session: 'ended',
      lastSample: { bpm: 70, measuredAt: haSegundos(-600) },
    });
    expect(deriveTelemetryAvailability(state, AGORA)).toEqual({ kind: 'unavailable' });
  });
});
