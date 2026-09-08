import { File, Paths } from 'expo-file-system';

// Fila de telemetria persistida em arquivo. Existe porque falha de rede não
// pode perder amostra: o batimento entra aqui antes de qualquer tentativa de
// envio, e só sai quando a confirmação do backend o citar (telemetryUploader).
//
// Cada operação lê o arquivo, muda e escreve. Não há cache em memória entre
// chamadas de propósito: o arquivo é a única verdade, e um reinício do app é
// só outra fábrica sobre o mesmo arquivo. As operações são serializadas por
// uma corrente de promessas, porque duas chamadas concorrentes que lessem o
// mesmo estado fariam a segunda escrita apagar a primeira.

/** Exatamente a forma que POST /telemetry/v1/batches aceita (telemetry-batch.dto.ts). */
export interface OutboxEvent {
  eventId: string;
  monitoringSessionId: string;
  sequence: number;
  eventTime: string;
  origin: 'REAL';
  measurements: { heartRate: { value: number; unit: 'bpm'; source: 'APPLE_WATCH' } };
}

export interface OutboxState {
  /** Na ordem em que entraram. */
  events: OutboxEvent[];
  /**
   * Último número de sequência usado por sessão. O backend tem chave única em
   * (sessão, sequência) e recusa repetição; um contador só em memória voltaria
   * a 0 num reinício do app e colidiria com o que já foi gravado.
   */
  sequences: Record<string, number>;
}

/**
 * Acesso ao arquivo, injetável. A implementação real usa `expo-file-system`;
 * o teste usa um texto em memória. `read` devolve null quando não há arquivo.
 */
export interface OutboxStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export interface TelemetryOutbox {
  /** Ausência, arquivo vazio, ilegível ou de forma errada: estado vazio. */
  load(): Promise<OutboxState>;
  /** Resolve só depois de o estado inteiro estar no arquivo. */
  append(event: OutboxEvent): Promise<void>;
  /** Ids desconhecidos são ignorados; sem mudança, não escreve. */
  remove(eventIds: readonly string[]): Promise<void>;
  /** Lê, incrementa, persiste, devolve. A primeira da sessão é 0. */
  nextSequence(sessionId: string): Promise<number>;
  /**
   * Apaga só o contador daquela sessão. Os eventos dela que ainda estão na
   * fila ficam: ainda precisam ser enviados.
   */
  forgetSession(sessionId: string): Promise<void>;
  /** Os eventos, na ordem em que entraram. */
  pending(): Promise<readonly OutboxEvent[]>;
}

export const OUTBOX_FILE_NAME = 'telemetry-outbox.v1.json';

/**
 * Armazenamento real, em `Paths.document`: é a pasta que sobrevive a reinício
 * e não é limpa pelo sistema sob pressão de espaço, ao contrário de `cache`.
 * O `File` é instanciado aqui e não no topo do módulo, para o módulo poder ser
 * importado onde `expo-file-system` é dublê sem `File` (a suíte).
 */
export function createFileOutboxStorage(): OutboxStorage {
  const file = new File(Paths.document, OUTBOX_FILE_NAME);
  return {
    async read() {
      if (!file.exists) return null;
      return file.text();
    },
    async write(text) {
      // `write` exige o arquivo existente; `create` recusa se já existir.
      if (!file.exists) file.create();
      file.write(text);
    },
  };
}

function emptyState(): OutboxState {
  return { events: [], sequences: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Só o envelope é conferido: `events` array e `sequences` objeto. Qualquer
 * outra coisa é estado vazio, nunca exceção: um arquivo corrompido não pode
 * impedir a próxima amostra de entrar, e a próxima escrita o conserta.
 */
function parseState(text: string | null): OutboxState {
  if (!text) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isPlainObject(parsed)) return emptyState();
  const { events, sequences } = parsed;
  if (!Array.isArray(events) || !isPlainObject(sequences)) return emptyState();
  return { events: events as OutboxEvent[], sequences: sequences as Record<string, number> };
}

export function createTelemetryOutbox(storage: OutboxStorage): TelemetryOutbox {
  // Corrente de operações. Cada uma começa quando a anterior terminou, com
  // sucesso ou não: uma falha não pode travar a fila para sempre.
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = chain.then(operation, operation);
    chain = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<OutboxState> {
    let text: string | null;
    try {
      text = await storage.read();
    } catch {
      // Disco que não responde é o mesmo que arquivo ausente para quem chama.
      text = null;
    }
    return parseState(text);
  }

  function write(state: OutboxState): Promise<void> {
    return storage.write(JSON.stringify(state));
  }

  return {
    load: () => serialized(read),

    append: (event) =>
      serialized(async () => {
        const state = await read();
        state.events.push(event);
        await write(state);
      }),

    remove: (eventIds) =>
      serialized(async () => {
        if (eventIds.length === 0) return;
        const state = await read();
        const drop = new Set(eventIds);
        const kept = state.events.filter((event) => !drop.has(event.eventId));
        if (kept.length === state.events.length) return;
        await write({ ...state, events: kept });
      }),

    nextSequence: (sessionId) =>
      serialized(async () => {
        const state = await read();
        const last = state.sequences[sessionId];
        // Valor que não é número (arquivo editado, versão antiga) recomeça do
        // 0: o backend recusa a colisão evento a evento e a fila segue viva.
        const next = typeof last === 'number' && Number.isFinite(last) ? last + 1 : 0;
        state.sequences[sessionId] = next;
        await write(state);
        return next;
      }),

    forgetSession: (sessionId) =>
      serialized(async () => {
        const state = await read();
        if (!(sessionId in state.sequences)) return;
        delete state.sequences[sessionId];
        await write(state);
      }),

    pending: () => serialized(async () => (await read()).events),
  };
}
