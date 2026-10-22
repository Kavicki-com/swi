import { File, Paths } from 'expo-file-system';
import { uuid } from 'expo-modules-core';
import type { OutboxEvent, OutboxStorage, TelemetryOutbox } from '../telemetryOutbox';
import { UNKNOWN_BAND_LABEL } from '../telemetryCopy';
import {
  HEALTH_CONNECT_RECORD_TYPES,
  HEALTH_CONNECT_WINDOW_MS,
  mapHealthConnectRecords,
  type HealthConnectRecord,
  type HealthConnectRecordType,
} from './healthConnectMapping';
import {
  HEALTH_CONNECT_MAX_PAGES,
  healthConnectSource,
  type HealthConnectAvailability,
  type HealthConnectSource,
} from './healthConnectSource';

// Leitor do Health Connect: o equivalente Android do caminho do relógio no
// iPhone. A pulseira (Amazfit, Mi Band, Galaxy Fit, ...) grava no Health
// Connect pelo app dela; este leitor lê de lá, transforma em eventos
// (healthConnectMapping.ts) e põe na fila de envio (telemetryOutbox.ts).
//
// Uma rodada é de um de dois tipos:
//
// - leitura das 48 h: pega um token de mudanças ANTES de ler (o que for
//   gravado no meio da leitura aparece na rodada seguinte, em vez de cair no
//   vão entre as duas), lê a janela inteira dos tipos com permissão e detecta
//   a pulseira. É a primeira rodada, a que segue um token expirado, a que
//   segue uma mudança nas permissões e TODA rodada enquanto não houver
//   pulseira detectada;
// - mudanças: só o que o Health Connect diz ter mudado desde o token guardado.
//
// Repetir uma leitura é inofensivo por construção: o evento sai inteiro do
// próprio registro (id, sessão e sequência determinísticos), e o backend
// responde repetição. Por isso o estado só avança DEPOIS de a fila gravar, e
// uma falha no meio deixa a próxima rodada refazer o mesmo trecho.
//
// INSTÂNCIA ÚNICA: a serialização daqui (rodadas, `redetect`, reset do
// pareamento, leitura e escrita do estado) vale só dentro de UMA instância do
// leitor, e a da fila só dentro de uma instância da fila. Leitor e fila
// precisam ser únicos por runtime JS: o primeiro plano e a tarefa de segundo
// plano compartilham as mesmas instâncias. Duas filas sobre o mesmo arquivo
// apagariam eventos uma da outra (cada uma lê, muda e escreve o arquivo
// inteiro) enquanto o leitor já teria avançado o token, e aqueles eventos não
// voltariam mais. Quem garante a instância única é a fiação (M5, M6), não
// este arquivo.

/**
 * Intervalo mínimo entre duas rodadas, contado do INÍCIO da última tentativa
 * (inclusive a que falhou ou não leu nada). O envio drena a cada 15 s, e o
 * Health Connect não é fonte ao vivo: a pulseira sincroniza com o app dela de
 * tempos em tempos, e consultar mais que isso só gastaria bateria.
 */
export const HEALTH_CONNECT_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export const HEALTH_CONNECT_STATE_FILE_NAME = 'healthconnect-state.json';

/**
 * Nome legível do app de cada pulseira, pelo pacote Android que aparece em
 * `metadata.dataOrigin`. Só pacotes conferidos; um desconhecido aparece em
 * tela como "Pulseira" (`bandLabelOf`).
 */
export const BAND_LABELS: Readonly<Record<string, string>> = {
  // O app das Amazfit.
  'com.huami.watch.hmwatchmanager': 'Zepp',
  'com.xiaomi.hm.health': 'Zepp Life',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.huawei.health': 'Huawei Health',
};

/** O nome para mostrar: o legível quando conhecido, senão "Pulseira"; nulo sem pacote. */
export function bandLabelOf(bandPackage: string | null): string | null {
  if (bandPackage === null) return null;
  // Pela chave própria: `toString` existe em todo objeto e não é pulseira.
  return Object.prototype.hasOwnProperty.call(BAND_LABELS, bandPackage)
    ? BAND_LABELS[bandPackage]
    : UNKNOWN_BAND_LABEL;
}

type Loose = Record<string, unknown>;

const obj = (value: unknown): Loose | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;

/**
 * O pacote da pulseira: a origem (`metadata.dataOrigin`) mais frequente entre
 * os registros de batimento. Batimento porque é o que só a pulseira mede; o
 * celular também conta passos. No empate, o menor nome em ordem de código
 * (comparação de texto simples, sem localidade), para a mesma leitura dar
 * sempre a mesma pulseira em qualquer aparelho.
 */
export function detectBandPackage(records: readonly HealthConnectRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const record of records) {
    const r = obj(record);
    if (r === null || r.recordType !== 'HeartRate') continue;
    const origin = obj(r.metadata)?.dataOrigin;
    if (typeof origin !== 'string' || origin === '') continue;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [origin, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && origin < best)) {
      best = origin;
      bestCount = count;
    }
  }
  return best;
}

export type HealthConnectPermission = 'granted' | 'denied';

/** O que as telas mostram (M7). */
export interface HealthConnectState {
  /** Nulo antes da primeira rodada. */
  availability: HealthConnectAvailability | null;
  /** Permissão de ler batimento; nula antes de saber (ou sem Health Connect). */
  permission: HealthConnectPermission | null;
  bandPackage: string | null;
  bandLabel: string | null;
  /** A última leitura das 48 h não achou batimento nenhum. */
  noBand: boolean;
  /**
   * INÍCIO da última rodada completa, em ISO (até onde os dados foram lidos:
   * o que entrou no Health Connect depois disso vem na rodada seguinte); nulo
   * se nunca houve.
   */
  lastSyncAt: string | null;
}

/** O estado gravado em arquivo. Disponibilidade e permissão ficam em memória. */
interface PersistedState {
  /**
   * Uuid v4 gerado uma vez por instalação e trocado a cada pareamento novo
   * (`resetForNewPairing`); entra na sessão de todo evento
   * (healthConnectMapping.ts). Perdê-lo fora disso muda a sessão dos eventos
   * relidos, e o backend os recusaria como conflito de id em vez de repetição.
   */
  sessionSalt: string;
  changesToken: string | null;
  /**
   * Os tipos com que o token foi criado. O token só traz mudança dos tipos
   * dele; se a permissão de um tipo novo chegar depois, as mudanças nunca o
   * trariam. Tipos diferentes dos concedidos agora = reler as 48 h.
   */
  tokenTypes: string[];
  firstSyncDone: boolean;
  bandPackage: string | null;
  noBand: boolean;
  lastSyncAt: string | null;
}

const initialState = (sessionSalt: string): PersistedState => ({
  sessionSalt,
  changesToken: null,
  tokenTypes: [],
  firstSyncDone: false,
  bandPackage: null,
  noBand: false,
  lastSyncAt: null,
});

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * O estado do arquivo, ou null quando não há sal legível (arquivo ausente,
 * vazio, ilegível ou de outra forma). Com sal, cada campo torto volta ao valor
 * inicial sozinho, e o sal fica: trocá-lo por causa de um campo vizinho
 * mudaria a sessão de tudo o que for relido. Um campo inicial só custa uma
 * leitura das 48 h.
 */
function parseState(text: string | null): PersistedState | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const s = obj(parsed);
  const sessionSalt = textOrNull(s?.sessionSalt);
  if (s === null || sessionSalt === null) return null;
  return {
    sessionSalt,
    changesToken: textOrNull(s.changesToken),
    tokenTypes: Array.isArray(s.tokenTypes)
      ? s.tokenTypes.filter((t): t is string => typeof t === 'string')
      : [],
    firstSyncDone: s.firstSyncDone === true,
    bandPackage: textOrNull(s.bandPackage),
    noBand: s.noBand === true,
    lastSyncAt: textOrNull(s.lastSyncAt),
  };
}

/**
 * Armazenamento real do estado, em `Paths.document`, no mesmo padrão de
 * `createFileOutboxStorage`: pasta que sobrevive a reinício e não é limpa sob
 * pressão de espaço, e o `File` instanciado aqui dentro para o módulo poder
 * ser importado onde `expo-file-system` é dublê.
 */
export function createFileHealthConnectStateStorage(): OutboxStorage {
  const file = new File(Paths.document, HEALTH_CONNECT_STATE_FILE_NAME);
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

export interface HealthConnectReaderDeps {
  outbox: TelemetryOutbox;
  source?: HealthConnectSource;
  /** Onde o estado mora; o padrão é `healthconnect-state.json` em `Paths.document`. */
  storage?: OutboxStorage;
  /** Relógio injetável, em milissegundos. */
  now?: () => number;
  /** Gera o sal da sessão; em produção, `uuid.v4` do expo-modules-core. */
  uuidV4?: () => string;
  /** Repassado ao mapeamento; em produção, `uuid.v5` do expo-modules-core. */
  uuidV5?: (name: string, namespace: string) => string;
}

export interface HealthConnectReader {
  /**
   * Uma rodada: lê o Health Connect e põe na fila o que ainda não pôs.
   * Devolve quantos eventos entraram. Nunca rejeita: sem leitura, o envio do
   * resto da fila segue. No máximo uma a cada 15 min; `force` ignora o
   * intervalo ("Sincronizar agora"). Chamada durante uma rodada em curso
   * recebe o resultado dela, em vez de começar outra.
   */
  run(opts?: { force?: boolean }): Promise<number>;
  state(): Promise<HealthConnectState>;
  /**
   * Esquece a pulseira detectada. A próxima rodada, sem esperar o intervalo,
   * relê as 48 h e detecta de novo. Espera a rodada em curso terminar, para
   * ela não regravar a pulseira antiga por cima. Rejeita se o estado não
   * puder ser gravado: é um pedido da pessoa, e ela precisa saber que falhou.
   */
  redetect(): Promise<void>;
  /**
   * Pareamento novo neste celular. O backend cria outro aparelho a cada
   * pareamento e recusa evento de sessão do aparelho anterior; com o sal
   * antigo, tudo o que fosse lido até a meia-noite UTC se perderia. Grava o
   * estado inicial com sal novo (sem token, sem primeira leitura, sem
   * pulseira) e tira da fila os eventos do Health Connect ainda não enviados,
   * que estão na sessão antiga: a próxima rodada, sem esperar o intervalo,
   * relê as 48 h e os recria na sessão nova. Espera a rodada em curso
   * terminar, como `redetect`. Rejeita se o estado ou a fila não puderem ser
   * gravados.
   */
  resetForNewPairing(): Promise<void>;
  /**
   * Abre o pedido de permissão do sistema e devolve se a leitura de batimento
   * ficou concedida. Concedida, a próxima rodada não espera o intervalo.
   * Sem prazo: quem responde é a pessoa, no tempo dela.
   */
  requestPermissions(): Promise<HealthConnectPermission>;
  /**
   * Confere o acesso sem fazer rodada: se há Health Connect no aparelho e,
   * havendo, se a leitura de batimento está concedida. Guarda as duas
   * respostas na memória (`state()`) e devolve a disponibilidade. É o que a
   * tela de pareamento usa antes de pedir a permissão (até a primeira rodada
   * as duas são nulas) e na volta dos ajustes do Health Connect ou da Play
   * Store, onde a pessoa pode ter concedido ou revogado. Concedida agora e
   * não antes, a próxima rodada não espera o intervalo, como depois de um
   * pedido. Não lê registros nem grava o arquivo. Nunca rejeita.
   */
  checkAccess(): Promise<HealthConnectAvailability>;
  openSettings(): void;
}

/**
 * Evento lido do Health Connect: alguma medição com essa origem (a origem
 * mora em cada medição, não no evento). Os do relógio nunca a têm.
 */
const fromHealthConnect = (event: OutboxEvent) =>
  Object.values(event.measurements).some((measurement) => measurement?.source === 'HEALTH_CONNECT');

const permissionOf = (granted: readonly string[]): HealthConnectPermission =>
  granted.includes('HeartRate') ? 'granted' : 'denied';

const sameTypes = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((type, i) => type === b[i]);

export function createHealthConnectReader(deps: HealthConnectReaderDeps): HealthConnectReader {
  const {
    outbox,
    source = healthConnectSource,
    storage = createFileHealthConnectStateStorage(),
    now = Date.now,
    uuidV4 = () => uuid.v4(),
    uuidV5 = (name: string, namespace: string) => uuid.v5(name, namespace),
  } = deps;

  // Sem prazo aqui: a porta já põe um em cada chamada à biblioteca (por
  // página), e um segundo embrulho por cima só mediria a mesma espera.

  // Em memória de propósito: mudam fora do app (a pessoa revoga nos ajustes)
  // e são perguntadas de novo a cada rodada.
  let availability: HealthConnectAvailability | null = null;
  let permission: HealthConnectPermission | null = null;
  // Sobe a cada `requestPermissions` concluído. A rodada guarda o valor do
  // início e só escreve `permission` se ele não mudou: a consulta dela pode ter
  // sido respondida antes da concessão, e desfaria a resposta mais nova.
  let permissionVersion = 0;

  // Leitura e escrita do arquivo serializadas, como em telemetryOutbox.ts:
  // duas operações que lessem o mesmo estado fariam a segunda escrita apagar
  // a primeira. O arquivo é a única verdade; não há cópia em memória.
  let fileChain: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = fileChain.then(operation, operation);
    fileChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Null só para arquivo ausente, vazio ou ilegível. Um `read` que LANÇA sobe
   * como erro, de propósito: ao contrário da fila, aqui "ausente" gera sal
   * novo, e um disco que falhou por um instante trocaria o sal de uma
   * instalação que já tem eventos enviados. A rodada aborta e tenta depois.
   */
  async function readState(): Promise<PersistedState | null> {
    return parseState(await storage.read());
  }

  /** O estado gravado, ou o inicial com sal novo, já gravado antes de ser usado. */
  async function stateOrInitial(): Promise<PersistedState> {
    const state = await readState();
    if (state !== null) return state;
    const fresh = initialState(uuidV4());
    await storage.write(JSON.stringify(fresh));
    return fresh;
  }

  const loadState = () => serialized(stateOrInitial);

  const updateState = (patch: Partial<PersistedState>) =>
    serialized(async () => {
      const next = { ...(await stateOrInitial()), ...patch };
      await storage.write(JSON.stringify(next));
      return next;
    });

  // Rodadas, `redetect` e `resetForNewPairing` em fila única: um só mexe no
  // estado de cada vez.
  let exclusiveChain: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = exclusiveChain.then(operation, operation);
    exclusiveChain = run.catch(() => undefined);
    return run;
  }

  let inFlight: Promise<number> | null = null;
  let lastAttemptAt: number | null = null;
  // Libera a próxima rodada do intervalo: depois de `redetect`, de um
  // pareamento novo e de uma permissão concedida, esperar 15 min deixaria a
  // tela sem resposta.
  let intervalFree = false;

  /** Mapeia e enfileira; devolve quantos entraram. Lança se a fila falhar. */
  async function enqueue(
    records: readonly HealthConnectRecord[],
    state: PersistedState,
    bandPackage: string | null,
    at: number,
  ): Promise<number> {
    const { events } = mapHealthConnectRecords(records, {
      sessionSalt: state.sessionSalt,
      nowMs: at,
      bandPackage,
      uuidV5,
    });
    if (events.length === 0) return 0;
    // O que uma rodada anterior deixou na fila e ainda não subiu: a releitura
    // das 48 h traz de novo, e enfileirar outra vez só custaria recusas.
    const pending = new Set((await outbox.pending()).map((event) => event.eventId));
    const fresh = events.filter((event) => !pending.has(event.eventId));
    return fresh.length === 0 ? 0 : outbox.appendMany(fresh);
  }

  async function readWindow(
    state: PersistedState,
    types: readonly HealthConnectRecordType[],
    at: number,
  ): Promise<number> {
    // O token ANTES da leitura: o que entrar durante ela vem nas mudanças.
    const token = await source.changesToken(types);
    const records: HealthConnectRecord[] = [];
    for (const type of types) {
      records.push(...(await source.readRecords(type, at - HEALTH_CONNECT_WINDOW_MS)));
    }
    // Pulseira já conhecida fica (só `redetect` a troca); sem ela, detecta.
    const bandPackage = state.bandPackage ?? detectBandPackage(records);
    const added = await enqueue(records, state, bandPackage, at);
    await updateState({
      changesToken: token,
      tokenTypes: [...types],
      firstSyncDone: true,
      bandPackage,
      noBand: bandPackage === null,
      lastSyncAt: new Date(at).toISOString(),
    });
    return added;
  }

  /**
   * As mudanças desde `fromToken`; `expired` pede a releitura das 48 h. O
   * limite de páginas aqui só avisa e segue na próxima rodada, ao contrário
   * do da porta: o token de cada página já enfileirada é um ponto de retomada
   * correto, e nada se perde ao parar no meio.
   */
  async function readChanges(
    state: PersistedState,
    fromToken: string,
    types: readonly HealthConnectRecordType[],
    at: number,
  ): Promise<{ added: number; expired: boolean }> {
    let token = fromToken;
    let added = 0;
    for (let page = 0; page < HEALTH_CONNECT_MAX_PAGES; page += 1) {
      const result = await source.getChanges(types, token);
      if (result.expired) return { added, expired: true };
      added += await enqueue(result.records, state, state.bandPackage, at);
      // O token da página só DEPOIS de ela estar na fila. Sem token seguinte
      // (resposta torta), grava nulo: a próxima rodada relê as 48 h em vez de
      // guardar um token vazio que nunca funcionaria.
      const next = result.nextToken === '' ? null : result.nextToken;
      if (next === null || !result.hasMore) {
        await updateState({ changesToken: next, lastSyncAt: new Date(at).toISOString() });
        return { added, expired: false };
      }
      await updateState({ changesToken: next });
      token = next;
    }
    console.warn(
      `[healthConnectReader] mudanças pararam no limite de ${HEALTH_CONNECT_MAX_PAGES} páginas; o resto vem na próxima rodada`,
    );
    return { added, expired: false };
  }

  async function round(at: number): Promise<number> {
    const version = permissionVersion;
    const setPermission = (value: HealthConnectPermission | null) => {
      if (permissionVersion === version) permission = value;
    };
    try {
      availability = await source.availability();
      if (availability !== 'available') {
        setPermission(null);
        return 0;
      }
      const granted = await source.grantedPermissions();
      const roundPermission = permissionOf(granted);
      setPermission(roundPermission);
      // Sem batimento não há pulseira a detectar nem monitoramento a fazer.
      // A rodada decide pela própria consulta; se um pedido concedeu no meio,
      // ele já liberou a próxima rodada do intervalo.
      if (roundPermission === 'denied') return 0;
      // Só os tipos concedidos, na ordem do contrato: ler um tipo sem
      // permissão faz o Health Connect lançar e perderia a rodada inteira.
      const types = HEALTH_CONNECT_RECORD_TYPES.filter((type) => granted.includes(type));
      const state = await loadState();
      const { changesToken } = state;
      // Sem pulseira, toda rodada é leitura completa com detecção: quando ela
      // aparecer, os passos e a distância das 48 h ainda entram (pelas
      // mudanças, os anteriores ao token se perderiam). Sem pulseira quase não
      // há registro, e a leitura completa sai barata.
      if (
        state.firstSyncDone &&
        changesToken !== null &&
        state.bandPackage !== null &&
        sameTypes(state.tokenTypes, types)
      ) {
        const changes = await readChanges(state, changesToken, types, at);
        if (!changes.expired) return changes.added;
        return changes.added + (await readWindow(state, types, at));
      }
      return await readWindow(state, types, at);
    } catch (error) {
      console.warn(
        `[healthConnectReader] leitura do Health Connect não enfileirada: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
      );
      return 0;
    }
  }

  return {
    run(opts = {}) {
      if (inFlight !== null) return inFlight;
      const at = now();
      if (
        !opts.force &&
        !intervalFree &&
        lastAttemptAt !== null &&
        at - lastAttemptAt < HEALTH_CONNECT_SYNC_INTERVAL_MS
      ) {
        return Promise.resolve(0);
      }
      lastAttemptAt = at;
      intervalFree = false;
      const current = exclusive(() => round(at)).finally(() => {
        if (inFlight === current) inFlight = null;
      });
      inFlight = current;
      return current;
    },

    async state() {
      // Só lê: a tela pode perguntar antes da primeira rodada, e gerar o sal
      // é trabalho da rodada. Disco que lança vira "nada gravado" só para a
      // tela, que nunca recebe rejeição; o arquivo não é tocado.
      const persisted = await serialized(readState).catch(() => null);
      const bandPackage = persisted?.bandPackage ?? null;
      return {
        availability,
        permission,
        bandPackage,
        bandLabel: bandLabelOf(bandPackage),
        noBand: persisted?.noBand ?? false,
        lastSyncAt: persisted?.lastSyncAt ?? null,
      };
    },

    async redetect() {
      intervalFree = true;
      await exclusive(() => updateState({ bandPackage: null, noBand: false }));
    },

    async resetForNewPairing() {
      intervalFree = true;
      await exclusive(async () => {
        // O estado antes da fila. Se a fila falhar depois, o sal já é o novo
        // e só os pendentes antigos se perdem (sobem e voltam recusados). Na
        // ordem inversa, um estado que não grava deixaria a fila já limpa e o
        // sal antigo: perderia os pendentes e o resto do dia.
        await serialized(() => storage.write(JSON.stringify(initialState(uuidV4()))));
        const stale = (await outbox.pending()).filter(fromHealthConnect);
        await outbox.remove(stale.map((event) => event.eventId));
      });
    },

    async requestPermissions() {
      const result = permissionOf(await source.requestPermissions());
      permission = result;
      permissionVersion += 1;
      // Negado não libera: a próxima rodada não leria nada de qualquer jeito.
      if (result === 'granted') intervalFree = true;
      return result;
    },

    async checkAccess() {
      // Como na rodada: só escreve a permissão se nenhum pedido terminou no
      // meio desta conferência, e sobe a versão ao escrever, para uma rodada
      // em curso (com uma consulta de antes da volta dos ajustes) não
      // desfazer a resposta mais nova.
      const version = permissionVersion;
      const setPermission = (value: HealthConnectPermission | null) => {
        if (permissionVersion !== version) return;
        // Concedida agora e não antes (voltou dos ajustes): o momento de ler,
        // sem esperar os 15 min. Já concedida e só conferida de novo, a cada
        // volta ao primeiro plano, não pula o intervalo outra vez.
        if (value === 'granted' && permission !== 'granted') intervalFree = true;
        permission = value;
        permissionVersion += 1;
      };
      // A porta promete nunca rejeitar; o `catch` é para a tela nunca receber
      // erro mesmo se ela mudar, e sem resposta não há Health Connect a usar.
      availability = await source.availability().catch(() => 'unavailable' as const);
      if (availability !== 'available') {
        setPermission(null);
        return availability;
      }
      try {
        setPermission(permissionOf(await source.grantedPermissions()));
      } catch {
        // Sem resposta sobre as permissões não se afirma nada novo: fica a
        // última que se sabia, e a próxima rodada pergunta de novo.
      }
      return availability;
    },

    openSettings() {
      source.openSettings();
    },
  };
}
