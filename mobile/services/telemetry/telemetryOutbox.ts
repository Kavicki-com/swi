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

/**
 * Uma medição do evento. `source` é sempre APPLE_WATCH aqui: pressão arterial,
 * que tem outras origens, não vem do relógio e não passa por esta fila.
 */
export interface OutboxMeasurement<U extends string> {
  value: number;
  unit: U;
  source: 'APPLE_WATCH';
}

/**
 * As cinco medições que o relógio produz, todas opcionais. Nem todo retorno do
 * HealthKit traz batimento: um evento pode ser só passos, ou só bateria, e
 * exigir batimento descartaria leitura real.
 *
 * CONTRATO DE VARIAÇÃO: `stepDelta`, `activeEnergyKcal` e `motionCount` são a
 * mudança desde o evento anterior da mesma sessão, nunca o acumulado. O backend
 * os SOMA. Enviar acumulado passa em toda validação e infla o total em silêncio.
 */
export interface OutboxMeasurements {
  heartRate?: OutboxMeasurement<'bpm'>;
  stepDelta?: OutboxMeasurement<'steps'>;
  activeEnergyKcal?: OutboxMeasurement<'kcal'>;
  motionCount?: OutboxMeasurement<'count'>;
  battery?: OutboxMeasurement<'%'>;
}

/** Exatamente a forma que POST /telemetry/v1/batches aceita (telemetry-batch.dto.ts). */
export interface OutboxEvent {
  eventId: string;
  monitoringSessionId: string;
  sequence: number;
  eventTime: string;
  origin: 'REAL';
  measurements: OutboxMeasurements;
}

/**
 * Unidade e restrição de cada medição, do domínio do backend
 * (`metric-state.ts`). O Record cobre a chave inteira de propósito: uma
 * medição nova no contrato não compila até alguém dizer como é validada.
 */
const MEASUREMENT_RULES: Record<
  keyof OutboxMeasurements,
  { unit: string; integer?: true; min?: number; max?: number }
> = {
  heartRate: { unit: 'bpm' },
  stepDelta: { unit: 'steps', integer: true, min: 0 },
  activeEnergyKcal: { unit: 'kcal', min: 0 },
  motionCount: { unit: 'count', min: 0 },
  battery: { unit: '%', min: 0, max: 100 },
};

export interface OutboxState {
  /** Na ordem em que entraram. */
  events: OutboxEvent[];
  /**
   * Último número de sequência usado por sessão. O backend tem chave única em
   * (sessão, sequência) e recusa repetição; um contador só em memória voltaria
   * a 0 num reinício do app e colidiria com o que já foi gravado.
   */
  sequences: Record<string, number>;
  /**
   * Sessões que `forgetSession` quis esquecer enquanto ainda tinham evento na
   * fila. O contador delas sai quando o último evento sair (em `remove`), e
   * não antes: se o relógio reconectar a sessão espelhada com o mesmo id, um
   * contador zerado repetiria uma sequência já gravada.
   */
  forgotten: string[];
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
  /**
   * Resolve só depois de o estado inteiro estar no arquivo. Evento fora do
   * contrato do backend é recusado com aviso e NÃO entra; a promessa resolve
   * do mesmo jeito, porque uma amostra ruim não pode derrubar quem grava.
   */
  append(event: OutboxEvent): Promise<void>;
  /**
   * Ids desconhecidos são ignorados; sem mudança, não escreve. Quando o último
   * evento de uma sessão esquecida sai, o contador dela sai junto.
   */
  remove(eventIds: readonly string[]): Promise<void>;
  /** Lê, incrementa, persiste, devolve. A primeira da sessão é 0. */
  nextSequence(sessionId: string): Promise<number>;
  /**
   * Apaga o contador daquela sessão se nenhum evento dela espera envio. Se
   * ainda há, marca a sessão como esquecida e o contador sai com o último
   * evento, em `remove`. Os eventos ficam: ainda precisam ser enviados.
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
  return { events: [], sequences: {}, forgotten: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Só o envelope é conferido: `events` array e `sequences` objeto. Qualquer
 * outra coisa é estado vazio, nunca exceção: um arquivo corrompido não pode
 * impedir a próxima amostra de entrar, e a próxima escrita o conserta.
 * `forgotten` chegou depois; arquivo sem ele lê como lista vazia.
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
  const { events, sequences, forgotten } = parsed;
  if (!Array.isArray(events) || !isPlainObject(sequences)) return emptyState();
  return {
    events: events as OutboxEvent[],
    sequences: sequences as Record<string, number>,
    forgotten: Array.isArray(forgotten)
      ? forgotten.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

// O mesmo regex do validador do backend (validator.js, isUUID 'all'): versão
// 1 a 8 e variante 89ab. Recusar aqui o que ele recusaria lá é o objetivo.
const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

// Data e hora completas com Z ou fuso, que é o que `toISOString` e o Swift
// produzem. O `Date.parse` depois pega mês 13 e dia 45, que o regex deixa passar.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * Descreve o que está fora do contrato de telemetry-batch.dto.ts e do domínio
 * (unidade e origem da medição), ou null se o evento pode ir à rede. Um único
 * evento fora do contrato dá 400 no lote inteiro, e o 400 descarta o lote:
 * a amostra ruim é recusada na porta para as boas não pagarem por ela.
 *
 * A faixa (20 a 300 bpm) fica com o backend: ele a recusa por evento, dentro
 * de um 2xx, e isso não custa o lote.
 */
export function outboxEventProblem(event: OutboxEvent): string | null {
  if (!isUuid(event.eventId)) return 'eventId não é UUID';
  if (!isUuid(event.monitoringSessionId)) return 'monitoringSessionId não é UUID';
  if (!Number.isInteger(event.sequence) || event.sequence < 0) {
    return 'sequence não é inteiro não negativo';
  }
  if (
    typeof event.eventTime !== 'string' ||
    !ISO_DATE_TIME.test(event.eventTime) ||
    Number.isNaN(Date.parse(event.eventTime))
  ) {
    return 'eventTime não é ISO-8601';
  }
  if (event.origin !== 'REAL') return 'origin não é REAL';

  const measurements = event.measurements;
  if (typeof measurements !== 'object' || measurements === null) return 'sem measurements';

  const keys = Object.keys(measurements);
  // Chave fora do contrato dá 400 no lote inteiro, então não pode entrar.
  const unknown = keys.find((key) => !(key in MEASUREMENT_RULES));
  if (unknown !== undefined) return `medição desconhecida: ${unknown}`;
  // Evento sem medição nenhuma não tem por que existir e ocuparia sequência.
  if (keys.length === 0) return 'sem nenhuma medição';

  for (const key of keys as (keyof OutboxMeasurements)[]) {
    const measurement = measurements[key];
    const rule = MEASUREMENT_RULES[key];
    if (typeof measurement !== 'object' || measurement === null) return `${key} não é objeto`;
    if (typeof measurement.value !== 'number' || !Number.isFinite(measurement.value)) {
      return `${key}.value não é número finito`;
    }
    if (rule.integer && !Number.isInteger(measurement.value)) {
      return `${key}.value não é inteiro`;
    }
    if (rule.min !== undefined && measurement.value < rule.min) {
      return `${key}.value abaixo de ${rule.min}`;
    }
    if (rule.max !== undefined && measurement.value > rule.max) {
      return `${key}.value acima de ${rule.max}`;
    }
    if (measurement.unit !== rule.unit) return `${key}.unit não é ${rule.unit}`;
    if (measurement.source !== 'APPLE_WATCH') return `${key}.source não é APPLE_WATCH`;
  }
  return null;
}

const hasEventOf = (state: OutboxState, sessionId: string) =>
  state.events.some((event) => event.monitoringSessionId === sessionId);

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
        const problem = outboxEventProblem(event);
        if (problem !== null) {
          console.warn(
            `[telemetryOutbox] amostra recusada, ${problem} (evento ${String(event?.eventId)})`,
          );
          return;
        }
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
        const next: OutboxState = { ...state, events: kept };
        // Sessão esquecida cujo último evento acabou de sair: agora sim o
        // contador pode ir embora.
        for (const sessionId of state.forgotten) {
          if (hasEventOf(next, sessionId)) continue;
          delete next.sequences[sessionId];
          next.forgotten = next.forgotten.filter((id) => id !== sessionId);
        }
        await write(next);
      }),

    nextSequence: (sessionId) =>
      serialized(async () => {
        const state = await read();
        const last = state.sequences[sessionId];
        // Valor que não é número (arquivo editado, versão antiga) recomeça do
        // 0: o backend recusa a colisão evento a evento e a fila segue viva.
        const next = typeof last === 'number' && Number.isFinite(last) ? last + 1 : 0;
        state.sequences[sessionId] = next;
        // Voltou a gerar amostra: está viva, e o contador não sai mais com o
        // último evento dela.
        state.forgotten = state.forgotten.filter((id) => id !== sessionId);
        await write(state);
        return next;
      }),

    forgetSession: (sessionId) =>
      serialized(async () => {
        const state = await read();
        if (hasEventOf(state, sessionId)) {
          if (state.forgotten.includes(sessionId)) return;
          state.forgotten.push(sessionId);
          await write(state);
          return;
        }
        const known = sessionId in state.sequences || state.forgotten.includes(sessionId);
        if (!known) return;
        delete state.sequences[sessionId];
        state.forgotten = state.forgotten.filter((id) => id !== sessionId);
        await write(state);
      }),

    pending: () => serialized(async () => (await read()).events),
  };
}
