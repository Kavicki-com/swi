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
 * Uma medição do evento. A origem padrão é APPLE_WATCH, que é quem produz as
 * sete medições do monitoramento; pressão e temperatura declaram as delas.
 */
export interface OutboxMeasurement<
  U extends string,
  S extends string = 'APPLE_WATCH',
  V = number,
> {
  value: V;
  unit: U;
  source: S;
}

/** O par da pressão, em mmHg inteiro, como o backend exige. */
export interface OutboxBloodPressure {
  systolic: number;
  diastolic: number;
}

/**
 * As sete medições que o relógio produz, mais as duas que o iPhone lê do app
 * Saúde, todas opcionais. Nem todo retorno do HealthKit traz batimento: um
 * evento pode ser só passos, ou só bateria, e exigir batimento descartaria
 * leitura real.
 *
 * CONTRATO DE VARIAÇÃO: `stepDelta`, `distanceDeltaM`, `activeEnergyKcal` e
 * `motionCount` são a mudança desde o evento anterior da mesma sessão, nunca o
 * acumulado. O backend os SOMA. Enviar acumulado passa em toda validação e
 * infla o total em silêncio.
 *
 * `oxygenSaturation` é medição pontual: o relógio só mede em repouso, e a
 * medição sai no evento seguinte à entrega dela pelo HealthKit.
 *
 * `bloodPressure` e `bodyTemperature` não vêm do relógio: são a última medição
 * registrada no app Saúde, e saem num evento só delas, com o horário em que
 * foram medidas (healthReadings.ts).
 */
export interface OutboxMeasurements {
  heartRate?: OutboxMeasurement<'bpm'>;
  stepDelta?: OutboxMeasurement<'steps'>;
  activeEnergyKcal?: OutboxMeasurement<'kcal'>;
  motionCount?: OutboxMeasurement<'count'>;
  battery?: OutboxMeasurement<'%'>;
  distanceDeltaM?: OutboxMeasurement<'m'>;
  oxygenSaturation?: OutboxMeasurement<'%'>;
  bloodPressure?: OutboxMeasurement<'mmHg', 'EXTERNAL_CUFF' | 'MANUAL_HEALTHKIT', OutboxBloodPressure>;
  bodyTemperature?: OutboxMeasurement<'°C', 'MANUAL_HEALTHKIT'>;
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

interface MeasurementRule {
  unit: string;
  /** Origens que o backend aceita para esta medição, e que este app produz. */
  sources: readonly string[];
  integer?: true;
  min?: number;
  max?: number;
  /** Pressão é a única que chega como par, e não como um número. */
  pair?: true;
}

const FROM_WATCH = ['APPLE_WATCH'] as const;

/**
 * Unidade, origem e restrição de cada medição, do domínio do backend
 * (`metric-state.ts`). O Record cobre a chave inteira de propósito: uma
 * medição nova no contrato não compila até alguém dizer como é validada.
 */
const MEASUREMENT_RULES: Record<keyof OutboxMeasurements, MeasurementRule> = {
  heartRate: { unit: 'bpm', sources: FROM_WATCH },
  stepDelta: { unit: 'steps', sources: FROM_WATCH, integer: true, min: 0 },
  activeEnergyKcal: { unit: 'kcal', sources: FROM_WATCH, min: 0 },
  motionCount: { unit: 'count', sources: FROM_WATCH, min: 0 },
  battery: { unit: '%', sources: FROM_WATCH, min: 0, max: 100 },
  distanceDeltaM: { unit: 'm', sources: FROM_WATCH, min: 0 },
  oxygenSaturation: { unit: '%', sources: FROM_WATCH, min: 0, max: 100 },
  bloodPressure: { unit: 'mmHg', sources: ['EXTERNAL_CUFF', 'MANUAL_HEALTHKIT'], pair: true },
  bodyTemperature: { unit: '°C', sources: ['MANUAL_HEALTHKIT'] },
};

/** O que há de errado com um número de medição, ou null. */
function numberProblem(label: string, value: unknown, rule: MeasurementRule): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} não é número finito`;
  if (rule.integer && !Number.isInteger(value)) return `${label} não é inteiro`;
  if (rule.min !== undefined && value < rule.min) return `${label} abaixo de ${rule.min}`;
  if (rule.max !== undefined && value > rule.max) return `${label} acima de ${rule.max}`;
  return null;
}

/** O par da pressão: dois inteiros. A faixa plausível fica com o backend. */
function pairProblem(key: string, value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return `${key}.value não é o par da pressão`;
  const { systolic, diastolic } = value as Partial<OutboxBloodPressure>;
  for (const [name, part] of [
    ['systolic', systolic],
    ['diastolic', diastolic],
  ] as const) {
    if (typeof part !== 'number' || !Number.isInteger(part)) {
      return `${key}.value.${name} não é inteiro`;
    }
  }
  return null;
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
   * Muitos de uma vez, com UMA leitura e UMA escrita do arquivo. É o que o
   * dreno do arquivo durável usa: depois de um turno em segundo plano ele traz
   * milhares de eventos, e um `append` por evento reescreveria a fila inteira
   * a cada um. Evento fora do contrato é pulado com aviso, como em `append`.
   * Devolve quantos entraram.
   */
  appendMany(events: readonly OutboxEvent[]): Promise<number>;
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
  // Pela chave própria, e não por `in`: `constructor` e `toString` existem em
  // todo objeto, passariam por conhecidas e a regra lida adiante seria lixo.
  const unknown = keys.find(
    (key) => !Object.prototype.hasOwnProperty.call(MEASUREMENT_RULES, key),
  );
  if (unknown !== undefined) return `medição desconhecida: ${unknown}`;
  // Evento sem medição nenhuma não tem por que existir e ocuparia sequência.
  if (keys.length === 0) return 'sem nenhuma medição';

  for (const key of keys as (keyof OutboxMeasurements)[]) {
    const measurement = measurements[key];
    const rule = MEASUREMENT_RULES[key];
    if (typeof measurement !== 'object' || measurement === null) return `${key} não é objeto`;
    const valueProblem = rule.pair
      ? pairProblem(key, measurement.value)
      : numberProblem(`${key}.value`, measurement.value, rule);
    if (valueProblem !== null) return valueProblem;
    if (measurement.unit !== rule.unit) return `${key}.unit não é ${rule.unit}`;
    if (!rule.sources.includes(measurement.source)) {
      return `${key}.source não é ${rule.sources.join(' nem ')}`;
    }
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

    appendMany: (events) =>
      serialized(async () => {
        const accepted: OutboxEvent[] = [];
        for (const event of events) {
          const problem = outboxEventProblem(event);
          if (problem !== null) {
            console.warn(
              `[telemetryOutbox] amostra recusada, ${problem} (evento ${String(event?.eventId)})`,
            );
            continue;
          }
          accepted.push(event);
        }
        if (accepted.length === 0) return 0;
        const state = await read();
        state.events.push(...accepted);
        await write(state);
        return accepted.length;
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
