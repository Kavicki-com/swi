import * as HealthConnectLibrary from 'react-native-health-connect';
import { withTimeout } from '../withTimeout';
import {
  HEALTH_CONNECT_RECORD_TYPES,
  type HealthConnectRecord,
  type HealthConnectRecordType,
} from './healthConnectMapping';

// Porta fina sobre `react-native-health-connect`. É o ÚNICO arquivo do app que
// importa a biblioteca em tempo de execução: o leitor (healthConnectReader.ts)
// e as telas falam com esta porta, que devolve tipos simples e já conferidos.
// O que sobe da ponte nativa é JSON sem garantia de forma, e o tipo da
// biblioteca é uma promessa sobre ele, não uma garantia.
//
// A fábrica recebe as funções da biblioteca injetadas, no mesmo padrão de
// `createHealthReadingsSource` (modules/swi-watch-control): o teste passa um
// dublê, e a instância real é montada no fim do arquivo. Importar o módulo não
// chama nada nativo: fora do Android a biblioteca é um proxy que só lança
// quando uma função é chamada, e quem impede a chamada é o gate
// `healthConnect` (só no Android compilado). Por isso não há caso especial de
// plataforma aqui além do que `availability` já cobre.

/** O que a tela e o leitor precisam saber do Health Connect no aparelho. */
export type HealthConnectAvailability = 'available' | 'unavailable' | 'update_required';

/** Permissão especial de leitura com o app fora da tela (tarefa da M6). */
export const BACKGROUND_ACCESS_PERMISSION = 'BackgroundAccessPermission';

/**
 * Registros por página pedidos à biblioteca. O Health Connect aceita até
 * 5.000; mil mantém cada resposta da ponte pequena sem multiplicar as idas.
 */
export const HEALTH_CONNECT_PAGE_SIZE = 1000;

/**
 * Limite defensivo de páginas por leitura. Com mil por página, 48 h de
 * registros cabem com folga enorme; o limite só existe para uma resposta que
 * repete `pageToken` para sempre não prender a rodada (e o envio que espera
 * por ela). Atingi-lo é falha, e não leitura parcial (ver `readRecords`).
 */
export const HEALTH_CONNECT_MAX_PAGES = 50;

/**
 * Prazo de CADA chamada à biblioteca (uma página, não a paginação inteira).
 * A leitura roda dentro do ciclo de envio, e uma chamada que nunca responde
 * seguraria o envio inteiro. Mais folgado que o do app Saúde (10 s) porque
 * uma página de mil registros atravessa a ponte. Por página, e não pela
 * leitura de um tipo, para 48 h com muitas páginas saudáveis não estourarem
 * um prazo pensado para uma resposta só.
 */
export const HEALTH_CONNECT_CALL_TIMEOUT_MS = 20_000;

export interface HealthConnectSourceOptions {
  /** Prazo de cada chamada; o padrão é HEALTH_CONNECT_CALL_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Os valores de `SdkAvailabilityStatus` da biblioteca, sem importar a constante. */
const SDK_AVAILABLE = 3;
const SDK_UPDATE_REQUIRED = 2;

interface PermissionLike {
  accessType: string;
  recordType: string;
}

type PermissionRequest =
  | { accessType: 'read'; recordType: HealthConnectRecordType }
  | { accessType: 'read'; recordType: typeof BACKGROUND_ACCESS_PERMISSION };

type TimeRangeFilter =
  | { operator: 'after'; startTime: string }
  | { operator: 'between'; startTime: string; endTime: string };

/**
 * As funções da biblioteca que a porta usa, com tipos frouxos de propósito: a
 * resposta é conferida aqui, campo a campo, e não confiada.
 */
export interface HealthConnectLib {
  getSdkStatus(): Promise<number>;
  initialize(): Promise<boolean>;
  getGrantedPermissions(): Promise<readonly PermissionLike[]>;
  requestPermission(permissions: PermissionRequest[]): Promise<readonly PermissionLike[]>;
  readRecords(
    recordType: HealthConnectRecordType,
    options: { timeRangeFilter: TimeRangeFilter; pageSize?: number; pageToken?: string },
  ): Promise<{ records: readonly unknown[]; pageToken?: string }>;
  getChanges(request: { changesToken?: string; recordTypes?: HealthConnectRecordType[] }): Promise<{
    upsertionChanges: readonly { record: unknown }[];
    nextChangesToken: string;
    changesTokenExpired: boolean;
    hasMore: boolean;
  }>;
  openHealthConnectSettings(): void;
}

/** Uma página de mudanças, já sem as deleções. */
export interface HealthConnectChangesPage {
  records: HealthConnectRecord[];
  /** O token que retoma DEPOIS desta página; vazio quando expirado. */
  nextToken: string;
  hasMore: boolean;
  /** Token velho demais (o Health Connect o guarda por 30 dias): reler do zero. */
  expired: boolean;
}

export interface HealthConnectSource {
  /** Nunca rejeita: exceção da biblioteca é `unavailable`. */
  availability(): Promise<HealthConnectAvailability>;
  /** Os `recordType` de leitura concedidos, inclusive `BackgroundAccessPermission`. */
  grantedPermissions(): Promise<string[]>;
  /** Abre o pedido do sistema; devolve o que foi concedido, como `grantedPermissions`. */
  requestPermissions(): Promise<string[]>;
  /** Todas as páginas desde `sinceMs` (até `untilMs`, se dado), com `recordType` reposto. */
  readRecords(
    type: HealthConnectRecordType,
    sinceMs: number,
    untilMs?: number,
  ): Promise<HealthConnectRecord[]>;
  /** Um token de mudanças novo, que começa a contar de agora. */
  changesToken(types: readonly HealthConnectRecordType[]): Promise<string>;
  /** Uma página de mudanças a partir de `token`. */
  getChanges(
    types: readonly HealthConnectRecordType[],
    token: string,
  ): Promise<HealthConnectChangesPage>;
  openSettings(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Os tipos de leitura de uma lista de permissões, sem repetir e sem lixo. */
function readTypes(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  const types = new Set<string>();
  for (const permission of permissions) {
    if (!isObject(permission) || permission.accessType !== 'read') continue;
    if (typeof permission.recordType === 'string') types.add(permission.recordType);
  }
  return [...types];
}

/**
 * Os registros que são objeto. Lista ausente vira vazia: uma página torta não
 * pode derrubar a rodada, e o mapeamento descartaria o resto de qualquer jeito.
 */
const objectsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isObject) : [];

export function createHealthConnectSource(
  lib: HealthConnectLib,
  options: HealthConnectSourceOptions = {},
): HealthConnectSource {
  const { timeoutMs = HEALTH_CONNECT_CALL_TIMEOUT_MS } = options;
  // Toda chamada à biblioteca passa por aqui, menos `requestPermission`, que
  // espera a pessoa responder no tempo dela.
  const call = <T>(promise: Promise<T>) => withTimeout(promise, timeoutMs);

  // `initialize` precisa rodar antes de qualquer outra chamada da biblioteca.
  // Guardado como promessa para chamadas concorrentes esperarem a mesma
  // inicialização; uma falha limpa a memória e a próxima chamada tenta de novo
  // (o provedor pode ter sido instalado ou atualizado nesse meio-tempo).
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    if (ready === null) {
      const attempt = call(lib.initialize()).then((ok) => {
        if (!ok) throw new Error('Health Connect não inicializou');
      });
      attempt.catch(() => {
        if (ready === attempt) ready = null;
      });
      ready = attempt;
    }
    return ready;
  }

  return {
    async availability() {
      try {
        const status = await call(lib.getSdkStatus());
        if (status === SDK_UPDATE_REQUIRED) return 'update_required';
        if (status !== SDK_AVAILABLE) return 'unavailable';
        await ensureReady();
        return 'available';
      } catch {
        return 'unavailable';
      }
    },

    async grantedPermissions() {
      await ensureReady();
      return readTypes(await call(lib.getGrantedPermissions()));
    },

    async requestPermissions() {
      await ensureReady();
      // `ReadHealthDataHistory` NÃO é pedida de propósito: sem ela o Health
      // Connect libera os 30 dias anteriores à concessão, e o monitoramento só
      // olha 48 h para trás. Pedir uma permissão a mais seria uma tela a mais
      // de consentimento sem ganho nenhum. Sem prazo: a tela do sistema fica
      // aberta enquanto a pessoa lê e decide.
      const granted = await lib.requestPermission([
        ...HEALTH_CONNECT_RECORD_TYPES.map((recordType) => ({
          accessType: 'read' as const,
          recordType,
        })),
        { accessType: 'read', recordType: BACKGROUND_ACCESS_PERMISSION },
      ]);
      return readTypes(granted);
    },

    async readRecords(type, sinceMs, untilMs) {
      await ensureReady();
      const startTime = new Date(sinceMs).toISOString();
      const timeRangeFilter: TimeRangeFilter =
        untilMs === undefined
          ? { operator: 'after', startTime }
          : { operator: 'between', startTime, endTime: new Date(untilMs).toISOString() };
      const records: HealthConnectRecord[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < HEALTH_CONNECT_MAX_PAGES; page += 1) {
        const response = await call(
          lib.readRecords(type, {
            timeRangeFilter,
            pageSize: HEALTH_CONNECT_PAGE_SIZE,
            ...(pageToken === undefined ? {} : { pageToken }),
          }),
        );
        // O `readRecords` da ponte NÃO põe `recordType` no registro (só o
        // `getChanges` põe, conferido no Kotlin da 4.1.3), e o mapeamento
        // decide tudo por ele. O tipo pedido é a verdade, mesmo que o objeto
        // traga outro.
        for (const record of objectsOf(response?.records)) {
          records.push({ ...record, recordType: type } as unknown as HealthConnectRecord);
        }
        const next = response?.pageToken;
        if (typeof next !== 'string' || next === '') return records;
        pageToken = next;
      }
      // Falha, e não leitura parcial: o leitor gravaria o token de mudanças
      // pego antes da leitura, e o que ficou nas páginas não lidas nunca mais
      // voltaria. Lançando, a rodada é refeita inteira mais tarde.
      throw new Error(
        `leitura de ${type} passou do limite de ${HEALTH_CONNECT_MAX_PAGES} páginas`,
      );
    },

    async changesToken(types) {
      await ensureReady();
      // A biblioteca não expõe `getChangesToken`: `getChanges` sem token cria
      // um para os tipos pedidos e o devolve em `nextChangesToken`.
      const response = await call(lib.getChanges({ recordTypes: [...types] }));
      const token = response?.nextChangesToken;
      if (typeof token !== 'string' || token === '') {
        throw new Error('Health Connect respondeu sem token de mudanças');
      }
      return token;
    },

    async getChanges(types, token) {
      await ensureReady();
      // Com token, os tipos já estão gravados nele; mandá-los de novo não muda
      // nada na ponte e deixa a chamada legível.
      const response = await call(
        lib.getChanges({ changesToken: token, recordTypes: [...types] }),
      );
      // Só as inserções e alterações. As deleções ficam de fora aqui mesmo: o
      // backend não apaga amostra já recebida, e não há o que fazer com elas.
      // O registro da mudança já traz `recordType` (a ponte o põe); um que
      // venha sem ele é descartado pelo mapeamento, porque numa página com
      // vários tipos não há de onde tirá-lo.
      const changes: readonly unknown[] = Array.isArray(response?.upsertionChanges)
        ? response.upsertionChanges
        : [];
      const records = changes
        .map((change) => (isObject(change) ? change.record : null))
        .filter(isObject) as unknown as HealthConnectRecord[];
      return {
        records,
        nextToken: typeof response?.nextChangesToken === 'string' ? response.nextChangesToken : '',
        hasMore: response?.hasMore === true,
        expired: response?.changesTokenExpired === true,
      };
    },

    openSettings() {
      lib.openHealthConnectSettings();
    },
  };
}

export const healthConnectSource: HealthConnectSource =
  createHealthConnectSource(HealthConnectLibrary);
