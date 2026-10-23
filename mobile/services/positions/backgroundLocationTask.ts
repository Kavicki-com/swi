import {
  shouldKeepPoint,
  type PointSpacing,
  type PositionOutbox,
  type QueuedPoint,
} from './positionOutbox';
import type { PositionDrainer } from './positionDrain';
import { isEvacuationOpen, type EvacuationWindowStore } from './evacuationWindow';
import { isWindowOpen, type TrackingWindowStore } from './trackingWindow';

// O que a tarefa de localização faz com cada entrega do sistema. Roda sem
// interface: no Android o serviço segue vivo com o app fechado, e o sistema
// pode relançar o processo só para a tarefa. Por isso tudo o que ela precisa
// (de quem é o ponto, se ainda deve rastrear, como enviar) vem de arquivo, e
// nada daqui depende do React.
//
// O servidor entra só para a evacuação, que o gestor começa e encerra no
// painel com o app possivelmente em segundo plano: a tarefa pergunta de
// tempos em tempos e grava ou apaga a evacuação no arquivo.

/** Nome da tarefa registrada no TaskManager. Trocar o nome órfã a anterior. */
export const LOCATION_TASK_NAME = 'swi-background-location';

/**
 * Intervalo mínimo entre tentativas de envio. Com o app aberto o iPhone
 * entrega uma leitura por segundo; enviar a cada uma gastaria bateria e rede
 * sem mover o pino mais depressa do que o painel mostra.
 */
export const DRAIN_MIN_INTERVAL_MS = 10_000;

/**
 * Na evacuação, cada leitura de 10 s sai assim que chega. A folga abaixo dos
 * 10 s é a mesma do espaçamento da fila: a leitura que chega um pouco antes
 * da hora não fica esperando a seguinte.
 */
const EVACUATION_DRAIN_MIN_INTERVAL_MS = 8_000;

/**
 * De quanto em quanto tempo a tarefa pergunta ao servidor pela evacuação. O
 * gestor começa e encerra no painel, e o app pode estar em segundo plano, sem
 * tela que consulte: é a tarefa que fica sabendo. Com evacuação gravada,
 * pergunta se ela acabou; só com a jornada aberta, se uma começou.
 */
export const EVACUATION_CHECK_INTERVAL_MS = 60_000;

/**
 * O que o servidor diz da evacuação ativa na empresa: qual é, `null` para
 * nenhuma, ou `'unknown'` quando não deu para saber (sem rede). Sem saber,
 * nada muda: a evacuação gravada segue, e nenhuma é gravada.
 */
export type ActiveEvacuationCheck = { evacuationId: string } | null | 'unknown';

/** A parte de uma leitura do expo-location que a tarefa usa. */
export interface TaskLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number };
}

interface LocationHandlerDeps {
  window: TrackingWindowStore;
  evacuation: EvacuationWindowStore;
  outbox: PositionOutbox;
  drainer: Pick<PositionDrainer, 'drain'>;
  /** Desliga as leituras do sistema: a tarefa para de ser chamada. */
  stopUpdates(): Promise<void>;
  /** A evacuação ativa na empresa, segundo o servidor. */
  activeEvacuation(): Promise<ActiveEvacuationCheck>;
  /**
   * O servidor disse que a evacuação acabou e ela já foi apagada. A tarefa
   * não religa as leituras; é o aviso para o processo da tela, se houver, pôr
   * as opções (e a notificação fixa) de volta na jornada.
   */
  onEvacuationEnded?(): void;
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
  let lastCheckAt = Number.NEGATIVE_INFINITY;

  /** Os pontos do lote que viram amostra depois de `lastKept`, nesta régua. */
  function sample(locations: readonly TaskLocation[], spacing: PointSpacing): QueuedPoint[] {
    const kept: QueuedPoint[] = [];
    let last = lastKept;
    for (const location of locations) {
      const point = toPoint(location);
      if (!point || !shouldKeepPoint(last, point, spacing)) continue;
      kept.push(point);
      last = point;
    }
    return kept;
  }

  async function askServer(): Promise<ActiveEvacuationCheck> {
    try {
      return await deps.activeEvacuation();
    } catch {
      return 'unknown';
    }
  }

  /**
   * O servidor diz que a evacuação acabou: apaga a gravada. Outra evacuação
   * ativa no lugar da gravada não muda nada aqui: o rastreio segue, e a
   * consulta do app em primeiro plano grava a nova.
   */
  async function evacuationEnded(): Promise<boolean> {
    if ((await askServer()) !== null) return false;
    try {
      await deps.evacuation.close();
    } catch {
      // Sem conseguir apagar, a próxima consulta tenta de novo.
    }
    return true;
  }

  /**
   * O servidor diz que começou uma evacuação: grava para a pessoa da jornada.
   * As leituras do sistema ficam como estão (religar com o app em segundo
   * plano o Android pode recusar), e a notificação fixa segue falando em
   * jornada até o app voltar para a frente; os pontos já seguem a evacuação,
   * porque a próxima entrega lê o arquivo.
   */
  async function evacuationStarted(owner: string, now: Date): Promise<void> {
    const active = await askServer();
    if (active === null || active === 'unknown') return;
    try {
      await deps.evacuation.open(owner, active.evacuationId, now);
    } catch {
      // Sem gravar, a próxima consulta tenta de novo.
    }
  }

  async function handle(locations: readonly TaskLocation[]): Promise<void> {
    // Filtro em memória antes de tocar o disco, pela régua mais folgada (a da
    // evacuação): a leitura de cada segundo do iPhone aberto não lê arquivo.
    // A régua da jornada, mais estreita, vem depois de saber se há evacuação.
    if (sample(locations, 'evacuation').length === 0) return;

    const now = deps.now();
    const [window, evacuation] = await Promise.all([deps.window.read(), deps.evacuation.read()]);
    const journey = window !== null && isWindowOpen(window, now) ? window : null;
    const evacuating = evacuation !== null && isEvacuationOpen(evacuation, now) ? evacuation : null;
    const journeyOpen = journey !== null;
    // A evacuação tem a vez: cada leitura entra, e o dono é o dela. Sem
    // evacuação, a régua e o dono da jornada.
    const owner = evacuating?.userId ?? journey?.userId;
    if (owner === undefined) {
      // Jornada encerrada, logout ou 12 h, e nenhuma evacuação: os arquivos
      // são a fonte, e quem os fecha pode não ter conseguido desligar as
      // leituras (app já fechado).
      lastKept = null;
      await deps.stopUpdates();
      return;
    }
    const spacing: PointSpacing = evacuating ? 'evacuation' : 'journey';

    // Ao ligar as leituras o sistema pode entregar primeiro uma posição que
    // tinha guardada, medida antes de o rastreio começar. Ela não entra. Com
    // a jornada da mesma pessoa aberta, vale o início mais antigo dos dois.
    const starts: number[] = [];
    if (evacuating) starts.push(Date.parse(evacuating.startedAt));
    if (journey?.userId === owner) starts.push(Date.parse(journey.startedAt));
    const startedAt = Math.min(...starts);
    const points = sample(locations, spacing).filter((p) => Date.parse(p.recordedAt) >= startedAt);

    if (points.length > 0) {
      lastKept = points[points.length - 1];
      await deps.outbox.append(owner, points, spacing);
      const drainEvery = evacuating ? EVACUATION_DRAIN_MIN_INTERVAL_MS : DRAIN_MIN_INTERVAL_MS;
      if (now.getTime() - lastDrainAt >= drainEvery) {
        lastDrainAt = now.getTime();
        try {
          await deps.drainer.drain(owner);
        } catch {
          // O ponto já está no arquivo; a próxima leitura tenta de novo.
        }
      }
    }

    // A consulta ao servidor vem depois de o ponto já estar guardado: sem rede,
    // ele não se perde. Um relógio só para as duas perguntas, uma consulta por
    // minuto no máximo.
    if (now.getTime() - lastCheckAt < EVACUATION_CHECK_INTERVAL_MS) return;
    lastCheckAt = now.getTime();
    // Só a jornada aberta: a evacuação que o gestor começou, vista daqui.
    if (!evacuating) {
      await evacuationStarted(owner, now);
      return;
    }
    // O encerramento pelo gestor. Com a jornada aberta as leituras seguem, na
    // régua dela; sem jornada, desligam.
    if (!(await evacuationEnded())) return;
    if (!journeyOpen) {
      lastKept = null;
      await deps.stopUpdates();
    }
    deps.onEvacuationEnded?.();
  }

  return {
    handle,
    reset() {
      lastKept = null;
    },
  };
}
