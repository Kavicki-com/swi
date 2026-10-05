import {
  createSendDrainer,
  type RefusalReason,
  type SendDrainer,
  type SendTransport,
} from './sendDrain';
import type { SendFiles } from './sendFiles';
import { MAX_QUEUED_SENDS, type SendItem, type SendOutbox } from './sendOutbox';

// O controle da fila de envios: um só para o app. As telas enfileiram por
// aqui, leem daqui o que está aguardando e ouvem daqui o que foi confirmado ou
// recusado. Todo envio passa pela fila, com sinal ou sem: é um caminho só, e
// com sinal o item sai na mesma hora.
//
// A fila é de uma pessoa. `start` toma a fila para quem entrou (os envios de
// outra pessoa são descartados), `stop` fecha a sessão sem apagar nada: quem
// sair e entrar de novo reencontra os seus envios.

/** O envio como a tela o entrega: fotos ainda pela uri do seletor. */
export type SendDraft =
  | { kind: 'chat.message'; conversationId: string; body: string; imageUri?: string }
  | {
      kind: 'report';
      title: string;
      summary: string;
      details: string;
      responsibles: string[];
      imageUris: string[];
    }
  | { kind: 'report.comment'; reportId: string; body: string };

/** `full`: a fila está no teto e o envio não entrou. */
export type EnqueueResult = 'queued' | 'full';

export interface RefusedSend {
  item: SendItem;
  reason: RefusalReason;
}

export interface SendQueueState {
  /** Aguardando envio, na ordem em que a pessoa enviou. */
  items: readonly SendItem[];
  /** Recusados nesta sessão. Só na memória: somem ao fechar o app. */
  refused: readonly RefusedSend[];
}

export type SendQueueEvent =
  | { type: 'sent'; item: SendItem; result: unknown }
  | { type: 'refused'; item: SendItem; reason: RefusalReason };

export interface SendQueue {
  /** Abre a sessão de quem entrou e já tenta enviar o que ficou. */
  start(owner: string): Promise<void>;
  /** Fecha a sessão. A fila fica guardada no arquivo. */
  stop(): void;
  /**
   * Põe o envio na fila e dispara a tentativa. Rejeita quando uma foto é
   * recusada na entrada (sumiu, ou passa de 15 MB): nada entra na fila.
   */
  enqueue(draft: SendDraft): Promise<EnqueueResult>;
  /** Tenta enviar agora. Nunca rejeita. */
  kick(): Promise<void>;
  /** Mesma referência enquanto nada mudar (contrato do useSyncExternalStore). */
  getState(): SendQueueState;
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: SendQueueEvent) => void): () => void;
}

interface SendQueueDeps {
  outbox: SendOutbox;
  files: SendFiles;
  transport: SendTransport;
  now(): number;
  /** UUID v4: é a chave de idempotência do envio. */
  newId(): string;
}

const EMPTY_STATE: SendQueueState = { items: [], refused: [] };

const localUris = (items: readonly SendItem[]) =>
  items.flatMap((item) => item.images.map((image) => image.localUri));

const draftImageUris = (draft: SendDraft): string[] => {
  if (draft.kind === 'report') return draft.imageUris;
  if (draft.kind === 'chat.message' && draft.imageUri) return [draft.imageUri];
  return [];
};

export function createSendQueue(deps: SendQueueDeps): SendQueue {
  const { outbox, files, transport, now, newId } = deps;

  let owner: string | null = null;
  // Cada `start` e cada `stop` abrem uma sessão nova. O que voltar de uma
  // sessão antiga (a resposta de um envio de quem já saiu) é ignorado.
  let session = 0;
  let drainer: SendDrainer | null = null;
  // Vira true com o 401: nada mais sai até a pessoa entrar de novo.
  let halted = false;
  let state: SendQueueState = EMPTY_STATE;
  // A abertura da sessão em andamento. Um envio feito nesse intervalo espera
  // por ela: a varredura das cópias órfãs não pode cruzar com a cópia da foto
  // de um envio que ainda não entrou na fila.
  let opening: Promise<void> = Promise.resolve();

  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<(event: SendQueueEvent) => void>();

  function setState(next: SendQueueState) {
    if (next === state) return;
    state = next;
    for (const listener of [...stateListeners]) listener();
  }

  function emit(event: SendQueueEvent) {
    for (const listener of [...eventListeners]) listener(event);
  }

  const discard = (uris: string[]) => {
    if (uris.length === 0) return;
    void files.discard(uris).catch(() => undefined);
  };

  /** O item saiu da fila (confirmado ou recusado): some do estado antes do aviso. */
  function settle(token: number, item: SendItem, event: SendQueueEvent, refusal?: RefusedSend) {
    if (token !== session) return;
    setState({
      items: state.items.filter((queued) => queued.id !== item.id),
      refused: refusal ? [...state.refused, refusal] : state.refused,
    });
    discard(localUris([item]));
    emit(event);
  }

  function drainerFor(token: number): SendDrainer {
    return createSendDrainer({
      outbox,
      // A uri guardada no item pode ser a de antes de uma atualização do app
      // (no iOS o caminho da pasta muda): quem sobe usa o caminho atual.
      transport: {
        upload: (item, localUri) => transport.upload(item, files.locate(localUri)),
        send: (item) => transport.send(item),
      },
      now,
      isCurrent: () => token === session,
      onSent: (item, result) => settle(token, item, { type: 'sent', item, result }),
      onRefused: (item, reason) =>
        settle(token, item, { type: 'refused', item, reason }, { item, reason }),
    });
  }

  async function kick(): Promise<void> {
    const current = drainer;
    const token = session;
    if (!owner || !current || halted) return;
    try {
      const outcome = await current.drain(owner);
      if (outcome === 'unauthorized' && token === session) halted = true;
    } catch {
      // Falha de disco no meio da rodada. O item que estava saindo continua na
      // fila e a próxima rodada repete o envio, que o backend reconhece.
      console.warn('[sendQueue] rodada de envio interrompida');
    }
  }

  function buildItem(draft: SendDraft, staged: string[]): SendItem {
    const base = {
      id: newId(),
      createdAt: new Date(now()).toISOString(),
      images: staged.map((localUri) => ({ localUri, key: null })),
    };
    switch (draft.kind) {
      case 'chat.message':
        return { ...base, kind: draft.kind, conversationId: draft.conversationId, body: draft.body };
      case 'report':
        return {
          ...base,
          kind: draft.kind,
          title: draft.title,
          summary: draft.summary,
          details: draft.details,
          responsibles: draft.responsibles,
        };
      case 'report.comment':
        return { ...base, kind: draft.kind, reportId: draft.reportId, body: draft.body };
    }
  }

  async function open(token: number, nextOwner: string): Promise<void> {
    const dropped = await outbox.claim(nextOwner);
    discard(localUris(dropped));
    const items = await outbox.pending(nextOwner);
    if (token !== session) return;
    setState(items.length > 0 ? { items, refused: [] } : EMPTY_STATE);
    await files.sweep(localUris(items)).catch(() => undefined);
  }

  return {
    async start(nextOwner) {
      session += 1;
      const token = session;
      owner = nextOwner;
      halted = false;
      drainer = drainerFor(token);

      const run = open(token, nextOwner);
      opening = run.catch(() => undefined);
      await run;
      if (token === session) void kick();
    },

    stop() {
      session += 1;
      owner = null;
      drainer = null;
      halted = false;
      setState(EMPTY_STATE);
    },

    async enqueue(draft) {
      const currentOwner = owner;
      const token = session;
      if (!currentOwner) throw new Error('Não há sessão aberta para enviar.');
      await opening;
      if (token !== session) throw new Error('Não há sessão aberta para enviar.');
      // Antes de copiar foto: com a fila no teto a cópia seria trabalho perdido.
      if (state.items.length >= MAX_QUEUED_SENDS) return 'full';

      const staged: string[] = [];
      try {
        for (const uri of draftImageUris(draft)) staged.push(await files.stage(uri));
      } catch (error) {
        discard(staged);
        throw error;
      }

      // A pessoa saiu enquanto a foto era copiada: gravar agora poria o envio
      // dela na fila de quem entrou depois.
      if (token !== session) {
        discard(staged);
        throw new Error('Não há sessão aberta para enviar.');
      }

      const item = buildItem(draft, staged);
      const accepted = await outbox.append(currentOwner, item);
      if (!accepted) {
        discard(staged);
        return 'full';
      }
      if (token === session) {
        setState({ items: [...state.items, item], refused: state.refused });
        void kick();
      }
      return 'queued';
    },

    kick,

    getState: () => state,

    subscribe(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  };
}
