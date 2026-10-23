import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// A evacuação em curso, vista pelo rastreio: de quem, qual e desde quando.
// Fica em arquivo pelo mesmo motivo da janela da jornada (trackingWindow.ts):
// a tarefa de localização roda sem interface e é por aqui que ela sabe que
// deve gravar cada leitura, com ou sem jornada.
//
// Arquivo separado da janela da jornada de propósito: a jornada segue com o
// próprio teto de 12 h e a escuta da pulseira continua seguindo só ela.
//
// A evacuação dura até o gestor encerrar no painel. O teto abaixo vale só
// para o caso de o aparelho nunca mais saber do encerramento (sem rede até o
// fim): o rastreio não fica ligado para sempre.

export const EVACUATION_TRACKING_MAX_MS = 12 * 60 * 60 * 1000;

export const EVACUATION_WINDOW_FILE_NAME = 'position-evacuation.v1.json';

export interface EvacuationWindow {
  userId: string;
  evacuationId: string;
  /** Quando o rastreio desta evacuação começou no aparelho, em ISO-8601. */
  startedAt: string;
}

export interface EvacuationWindowStore {
  read(): Promise<EvacuationWindow | null>;
  /**
   * Grava a evacuação da pessoa. A mesma evacuação da mesma pessoa fica com o
   * início que já tinha: consultar de novo não recomeça o teto.
   */
  open(userId: string, evacuationId: string, now: Date): Promise<EvacuationWindow>;
  /** Evacuação encerrada ou logout. */
  close(): Promise<void>;
}

export function isEvacuationOpen(window: EvacuationWindow | null, now: Date): boolean {
  if (!window) return false;
  const started = Date.parse(window.startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started < EVACUATION_TRACKING_MAX_MS;
}

function parseWindow(text: string | null): EvacuationWindow | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { userId, evacuationId, startedAt } = parsed as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof evacuationId !== 'string' || typeof startedAt !== 'string') {
    return null;
  }
  return { userId, evacuationId, startedAt };
}

export function createEvacuationWindowStore(storage: OutboxStorage): EvacuationWindowStore {
  async function read(): Promise<EvacuationWindow | null> {
    try {
      return parseWindow(await storage.read());
    } catch {
      return null;
    }
  }

  return {
    read,
    async open(userId, evacuationId, now) {
      const current = await read();
      if (current?.userId === userId && current.evacuationId === evacuationId) return current;
      const window = { userId, evacuationId, startedAt: now.toISOString() };
      await storage.write(JSON.stringify(window));
      return window;
    },
    async close() {
      await storage.write('');
    },
  };
}
