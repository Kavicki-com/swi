import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// A janela do rastreio em segundo plano: quem está sendo rastreado e desde
// quando. Fica em arquivo porque a tarefa de localização roda sem interface,
// sem React e sem a sessão em memória, e é por aqui que ela sabe se ainda
// deve gravar e de quem é o ponto.
//
// O rastreio para sozinho 12 h depois de começar, mesmo com a jornada ainda
// aberta: é o teto combinado para um turno esquecido não virar vigilância.

export const TRACKING_MAX_MS = 12 * 60 * 60 * 1000;

export const TRACKING_WINDOW_FILE_NAME = 'position-tracking.v1.json';

export interface TrackingWindow {
  userId: string;
  /** Quando o rastreio desta jornada começou, em ISO-8601. */
  startedAt: string;
}

export interface TrackingWindowStore {
  read(): Promise<TrackingWindow | null>;
  /**
   * Abre a janela da pessoa. Se já existe uma dela, fica a que existe, mesmo
   * vencida: pausar, retomar ou reabrir o app não recomeça as 12 h.
   */
  open(userId: string, now: Date): Promise<TrackingWindow>;
  /** Fim da jornada ou logout. */
  close(): Promise<void>;
}

export function isWindowOpen(window: TrackingWindow | null, now: Date): boolean {
  if (!window) return false;
  const started = Date.parse(window.startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started < TRACKING_MAX_MS;
}

function parseWindow(text: string | null): TrackingWindow | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { userId, startedAt } = parsed as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof startedAt !== 'string') return null;
  return { userId, startedAt };
}

export function createTrackingWindowStore(storage: OutboxStorage): TrackingWindowStore {
  async function read(): Promise<TrackingWindow | null> {
    try {
      return parseWindow(await storage.read());
    } catch {
      return null;
    }
  }

  return {
    read,
    async open(userId, now) {
      const current = await read();
      if (current?.userId === userId) return current;
      const window = { userId, startedAt: now.toISOString() };
      await storage.write(JSON.stringify(window));
      return window;
    },
    async close() {
      await storage.write('');
    },
  };
}
