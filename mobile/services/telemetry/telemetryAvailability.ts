import type { WatchDiagnosticsState } from './watchDiagnostics';

// Disponibilidade da telemetria do Apple Watch, derivada só do que chegou.
//
// O iOS não conta se o funcionário negou leitura ao HealthKit (ADR-0004), então
// nenhum estado aqui representa "negado". Indisponível é ausência de dado, e a
// tela mostra o caminho de conserto sem afirmar o motivo.
//
// Termos em CONTEXT.md. Limiares congelados no plano do piloto.

/** Até aqui a leitura é atual. */
const ATUAL_ATE_MS = 45_000;
/** Acima disto a leitura não conta mais. */
const DESATUALIZADO_ATE_MS = 120_000;

export type TelemetryAvailability =
  | { kind: 'unsupported' }
  | { kind: 'unavailable' }
  | { kind: 'awaiting' }
  | { kind: 'stale'; bpm: number; measuredAt: string }
  | { kind: 'current'; bpm: number; measuredAt: string };

/**
 * Idade da leitura em milissegundos, ou null quando não há leitura utilizável.
 *
 * Horário ilegível e horário no futuro devolvem null em vez de uma idade
 * plausível: um relógio adiantado não pode transformar ausência em "atual".
 */
function idadeMs(measuredAt: string, nowMs: number): number | null {
  const medidoEm = Date.parse(measuredAt);
  if (Number.isNaN(medidoEm)) return null;
  const idade = nowMs - medidoEm;
  return idade < 0 ? null : idade;
}

/**
 * Recebe o instante por parâmetro, nunca lê o próprio relógio: é o que permite
 * ao teste fixar as fronteiras de 45 e 120 segundos sem tolerância.
 */
export function deriveTelemetryAvailability(
  state: WatchDiagnosticsState,
  nowMs: number,
): TelemetryAvailability {
  if (state.support === 'unsupported') return { kind: 'unsupported' };

  const { lastSample } = state;
  const idade = lastSample ? idadeMs(lastSample.measuredAt, nowMs) : null;

  if (lastSample && idade !== null && idade <= ATUAL_ATE_MS) {
    return { kind: 'current', bpm: lastSample.bpm, measuredAt: lastSample.measuredAt };
  }
  if (lastSample && idade !== null && idade <= DESATUALIZADO_ATE_MS) {
    return { kind: 'stale', bpm: lastSample.bpm, measuredAt: lastSample.measuredAt };
  }

  // Sessão espelhada ativa e nenhuma leitura utilizável: o relógio está ligado
  // e a leitura está a caminho. O conselho é ajustar o relógio no pulso, não ir
  // ao Ajustes, então isto não pode se dobrar em indisponível.
  if (state.session === 'running') return { kind: 'awaiting' };

  return { kind: 'unavailable' };
}
