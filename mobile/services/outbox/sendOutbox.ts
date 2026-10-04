import { File, Paths } from 'expo-file-system';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// Fila dos envios que a pessoa faz no app (mensagem do chat, relatório,
// comentário), persistida em arquivo no padrão do positionOutbox: o arquivo é
// a única verdade, sem cache entre chamadas, e as operações são serializadas
// por uma corrente de promessas.
//
// O envio entra aqui antes de qualquer tentativa de rede e só sai quando o
// backend confirmar ou recusar de vez (sendDrain.ts). O `id` do item é a
// chave de idempotência: vai igual em toda tentativa, e é o que deixa o
// backend devolver o registro já criado em vez de gravar outro.

/** Uma foto do envio: a cópia local e, depois de subir, a referência dela. */
export interface QueuedImage {
  localUri: string;
  /** null até subir. Gravada antes do POST, para a foto subir uma vez só. */
  key: string | null;
}

interface SendItemBase {
  /** UUID v4. É também o cabeçalho Idempotency-Key do envio. */
  id: string;
  /** Quando a pessoa enviou, em ISO-8601. Régua da validade do item. */
  createdAt: string;
  images: QueuedImage[];
}

export interface ChatMessageItem extends SendItemBase {
  kind: 'chat.message';
  conversationId: string;
  body: string;
}

export interface ReportItem extends SendItemBase {
  kind: 'report';
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
}

export interface ReportCommentItem extends SendItemBase {
  kind: 'report.comment';
  reportId: string;
  body: string;
}

export type SendItem = ChatMessageItem | ReportItem | ReportCommentItem;
export type SendKind = SendItem['kind'];

export interface SendOutbox {
  /**
   * Toma a fila para quem entrou agora. Os itens de outra pessoa saem do
   * arquivo e voltam aqui, para as cópias das fotos serem apagadas.
   */
  claim(owner: string): Promise<SendItem[]>;
  /**
   * Guarda o item no fim da fila. Devolve false quando a fila está no teto: o
   * item não entra. Fila de outro dono é descartada antes.
   */
  append(owner: string, item: SendItem): Promise<boolean>;
  /**
   * Os itens do dono, na ordem. Fila de outra pessoa devolve vazio, e ler não
   * apaga: um envio antigo ainda em andamento não pode levar os itens de quem
   * entrou depois.
   */
  pending(owner: string): Promise<SendItem[]>;
  /** Tira o item. Id desconhecido é ignorado. */
  remove(owner: string, id: string): Promise<void>;
  /**
   * Grava a referência da foto `index` do item, depois de ela subir. Devolve
   * false quando não havia onde gravar (o item saiu, ou a fila é de outra
   * pessoa): sem a key gravada, o POST do item não pode sair.
   */
  setImageKey(owner: string, id: string, index: number, key: string): Promise<boolean>;
}

export const SEND_OUTBOX_FILE_NAME = 'send-outbox.v1.json';

/**
 * Teto da fila. Um turno inteiro sem sinal não chega perto disso; o teto
 * existe para o arquivo não crescer sem fim se o envio parar de vez.
 */
export const MAX_QUEUED_SENDS = 200;

interface State {
  owner: string | null;
  items: SendItem[];
}

const emptyState = (): State => ({ owner: null, items: [] });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isImage = (value: unknown): value is QueuedImage =>
  isPlainObject(value) && isString(value.localUri) && (value.key === null || isString(value.key));

/**
 * Só passa o item que a fila sabe enviar. Um item de forma desconhecida (de
 * uma versão futura do app, ou de um arquivo estragado) nunca sairia, e
 * travaria tudo o que vem atrás dele.
 */
function isSendItem(value: unknown): value is SendItem {
  if (!isPlainObject(value)) return false;
  if (!isString(value.id) || !isString(value.createdAt)) return false;
  if (!Array.isArray(value.images) || !value.images.every(isImage)) return false;
  switch (value.kind) {
    case 'chat.message':
      return isString(value.conversationId) && isString(value.body);
    case 'report':
      return (
        isString(value.title) &&
        isString(value.summary) &&
        isString(value.details) &&
        Array.isArray(value.responsibles) &&
        value.responsibles.every(isString)
      );
    case 'report.comment':
      return isString(value.reportId) && isString(value.body);
    default:
      return false;
  }
}

/** Qualquer coisa fora do envelope é estado vazio: a próxima escrita conserta. */
function parseState(text: string | null): State {
  if (!text) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.items)) return emptyState();
  return {
    owner: isString(parsed.owner) ? parsed.owner : null,
    items: parsed.items.filter(isSendItem),
  };
}

/**
 * Armazenamento real, em `Paths.document`, que sobrevive a reinício e não é
 * limpo pelo sistema. O `File` nasce no primeiro uso, e não aqui: a fila é
 * montada inclusive onde `expo-file-system` é dublê sem `File` (a suíte).
 */
export function createFileSendStorage(fileName: string = SEND_OUTBOX_FILE_NAME): OutboxStorage {
  let file: File | null = null;
  const open = () => (file ??= new File(Paths.document, fileName));
  return {
    async read() {
      const f = open();
      if (!f.exists) return null;
      return f.text();
    },
    async write(text) {
      const f = open();
      if (!f.exists) f.create();
      f.write(text);
    },
  };
}

/** Sem arquivo (web): a fila vive enquanto a aba estiver aberta. */
export function createMemorySendStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    async read() {
      return text;
    },
    async write(next) {
      text = next;
    },
  };
}

export function createSendOutbox(storage: OutboxStorage): SendOutbox {
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = chain.then(operation, operation);
    chain = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<State> {
    let text: string | null;
    try {
      text = await storage.read();
    } catch {
      text = null;
    }
    return parseState(text);
  }

  const write = (state: State) => storage.write(JSON.stringify(state));

  /** O estado do dono: o de outro dono vira vazio, com o dono trocado. */
  const ownedBy = (state: State, owner: string): State =>
    state.owner === owner ? state : { owner, items: [] };

  return {
    append: (owner, item) =>
      serialized(async () => {
        const state = ownedBy(await read(), owner);
        if (state.items.length >= MAX_QUEUED_SENDS) return false;
        await write({ owner, items: [...state.items, item] });
        return true;
      }),

    claim: (owner) =>
      serialized(async () => {
        const state = await read();
        if (state.owner === owner) return [];
        // Envios de outra pessoa saem já, antes de qualquer tentativa com o
        // token de quem está logado agora.
        await write({ owner, items: [] });
        return state.items;
      }),

    pending: (owner) =>
      serialized(async () => {
        const state = await read();
        return state.owner === owner ? state.items : [];
      }),

    remove: (owner, id) =>
      serialized(async () => {
        const state = await read();
        if (state.owner !== owner) return;
        const items = state.items.filter((item) => item.id !== id);
        if (items.length === state.items.length) return;
        await write({ owner, items });
      }),

    setImageKey: (owner, id, index, key) =>
      serialized(async () => {
        const state = await read();
        if (state.owner !== owner) return false;
        const target = state.items.find((item) => item.id === id);
        if (!target || index < 0 || index >= target.images.length) return false;
        const items = state.items.map((item) =>
          item === target
            ? { ...item, images: item.images.map((image, i) => (i === index ? { ...image, key } : image)) }
            : item,
        );
        await write({ owner, items });
        return true;
      }),
  };
}
