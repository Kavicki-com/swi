import { shouldKeepPoint, type PositionOutbox, type QueuedPoint } from './positionOutbox';
import type { PositionDrainer } from './positionDrain';
import { isWindowOpen, type TrackingWindowStore } from './trackingWindow';

// O que a tarefa de localização faz com cada entrega do sistema. Roda sem
// interface: no Android o serviço segue vivo com o app fechado, e o sistema
// pode relançar o processo só para a tarefa. Por isso tudo o que ela precisa
// (de quem é o ponto, se ainda deve rastrear, como enviar) vem de arquivo, e
// nada daqui depende do React.

/** Nome da tarefa registrada no TaskManager. Trocar o nome órfã a anterior. */
export const LOCATION_TASK_NAME = 'swi-background-location';

/**
 * Intervalo mínimo entre tentativas de envio. Com o app aberto o iPhone
 * entrega uma leitura por segundo; enviar a cada uma gastaria bateria e rede
 * sem mover o pino mais depressa do que o painel mostra.
 */
export const DRAIN_MIN_INTERVAL_MS = 10_000;

/** A parte de uma leitura do expo-location que a tarefa usa. */
export interface TaskLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number };
}

interface LocationHandlerDeps {
  window: TrackingWindowStore;
  outbox: PositionOutbox;
  drainer: Pick<PositionDrainer, 'drain'>;
  /** Desliga as leituras do sistema: a tarefa para de ser chamada. */
  stopUpdates(): Promise<void>;
  now(): Date;
}

const toPoint = (location: TaskLocation): QueuedPoint | null => {
  const coords = location?.coords;
  if (!coords || !Number.isFinite(location.timestamp)) return null;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    recordedAt: new Date(location.timestamp).toISOString(),
  };
};

export interface LocationHandler {
  handle(locations: readonly TaskLocation[]): Promise<void>;
  /** Esquece o filtro em memória. Chamado quando o rastreio desliga. */
  reset(): void;
}

export function createLocationHandler(deps: LocationHandlerDeps): LocationHandler {
  // Só nesta instância do processo. Um processo novo começa sem nada e lê o
  // arquivo uma vez a mais, que é o custo certo.
  let lastKept: QueuedPoint | null = null;
  let lastDrainAt = Number.NEGATIVE_INFINITY;

  async function handle(locations: readonly TaskLocation[]): Promise<void> {
    // Filtro em memória antes de tocar o disco: a leitura parada de cada
    // segundo não vira amostra, e não precisa ler nem escrever arquivo.
    const candidates: QueuedPoint[] = [];
    let last = lastKept;
    for (const location of locations) {
      const point = toPoint(location);
      if (!point || !shouldKeepPoint(last, point)) continue;
      candidates.push(point);
      last = point;
    }
    if (candidates.length === 0) return;

    const now = deps.now();
    const window = await deps.window.read();
    if (!window || !isWindowOpen(window, now)) {
      // Jornada encerrada, logout ou 12 h: a janela é a fonte, e quem a fecha
      // pode não ter conseguido desligar as leituras (app já fechado).
      lastKept = null;
      await deps.stopUpdates();
      return;
    }

    // Ao ligar as leituras o sistema pode entregar primeiro uma posição que
    // tinha guardada, medida antes de a jornada começar. Ela não é da jornada.
    const startedAt = Date.parse(window.startedAt);
    const points = candidates.filter((p) => Date.parse(p.recordedAt) >= startedAt);
    if (points.length === 0) return;
    lastKept = points[points.length - 1];

    await deps.outbox.append(window.userId, points);
    if (now.getTime() - lastDrainAt < DRAIN_MIN_INTERVAL_MS) return;
    lastDrainAt = now.getTime();
    try {
      await deps.drainer.drain(window.userId);
    } catch {
      // O ponto já está no arquivo; a próxima leitura tenta de novo.
    }
  }

  return {
    handle,
    reset() {
      lastKept = null;
    },
  };
}
