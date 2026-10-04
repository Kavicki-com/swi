import { File, Paths } from 'expo-file-system';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// Fila das posições do rastreio em segundo plano, persistida em arquivo no
// padrão do telemetryOutbox: o arquivo é a única verdade, sem cache entre
// chamadas, e as operações são serializadas por uma corrente de promessas.
//
// Existe porque a tarefa de localização roda sem interface e muitas vezes sem
// rede: o ponto entra aqui antes de qualquer tentativa de envio e só sai
// quando POST /positions/batch confirmar (positionDrain.ts).

/** Exatamente a forma de um ponto de POST /positions/batch. */
export interface QueuedPoint {
  lat: number;
  lng: number;
  /** Quando o aparelho mediu, em ISO-8601. */
  recordedAt: string;
}

export interface PositionOutbox {
  /**
   * Guarda os pontos que a regra de espaçamento deixa, na ordem recebida, e
   * devolve quantos entraram. Ponto fora do contrato é recusado com aviso.
   * Fila de outro dono é descartada antes: o rastreio é de uma pessoa só.
   */
  append(owner: string, points: readonly QueuedPoint[]): Promise<number>;
  /** Os pontos do dono, na ordem. Ponto de outro dono é apagado, nunca enviado. */
  pending(owner: string): Promise<QueuedPoint[]>;
  /** Tira os pontos com estas horas. Horas desconhecidas são ignoradas. */
  remove(owner: string, recordedAts: readonly string[]): Promise<void>;
}

export const POSITION_OUTBOX_FILE_NAME = 'position-outbox.v1.json';

/**
 * Teto da fila. Um ponto por minuto parado dá 720 numa jornada de 12 h; o
 * teto cobre dias sem rede andando, e acima dele os mais velhos saem primeiro,
 * porque a posição de agora vale mais que a de ontem.
 */
export const MAX_QUEUED_POINTS = 5000;

// A mesma regra do backend (position-history.ts): uma amostra a cada minuto
// parado, ou a cada 25 m andando. Aplicar aqui evita gravar e enviar o que o
// backend jogaria fora.
const KEEP_MIN_INTERVAL_MS = 60_000;
const KEEP_MIN_DISTANCE_M = 25;
const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distância de superfície (haversine), em metros. */
function distanceM(a: QueuedPoint, b: QueuedPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Se `next` vira amostra depois de `last`. Ponto com a hora de `last` ou mais
 * velho não entra: é repetição, e a fila anda só para a frente.
 */
export function shouldKeepPoint(last: QueuedPoint | null, next: QueuedPoint): boolean {
  if (last === null) return true;
  const elapsed = Date.parse(next.recordedAt) - Date.parse(last.recordedAt);
  if (elapsed <= 0) return false;
  if (elapsed >= KEEP_MIN_INTERVAL_MS) return true;
  return distanceM(last, next) >= KEEP_MIN_DISTANCE_M;
}

// Data e hora completas com Z ou fuso, como o `toISOString` produz. O
// `Date.parse` depois pega mês 13 e dia 45, que o regex deixa passar.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const inRange = (value: unknown, limit: number) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * O que está fora do contrato de PositionPointDto, ou null. Um ponto fora dá
 * 400 no lote inteiro, então é recusado na porta.
 */
function pointProblem(point: QueuedPoint): string | null {
  if (!inRange(point.lat, 90)) return 'lat fora de -90 a 90';
  if (!inRange(point.lng, 180)) return 'lng fora de -180 a 180';
  if (
    typeof point.recordedAt !== 'string' ||
    !ISO_DATE_TIME.test(point.recordedAt) ||
    Number.isNaN(Date.parse(point.recordedAt))
  ) {
    return 'recordedAt não é ISO-8601';
  }
  return null;
}

interface State {
  owner: string | null;
  points: QueuedPoint[];
  /** O último ponto guardado, enviado ou não: a régua do espaçamento. */
  last: QueuedPoint | null;
}

const emptyState = (): State => ({ owner: null, points: [], last: null });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Qualquer coisa fora do envelope é estado vazio: a próxima escrita conserta. */
function parseState(text: string | null): State {
  if (!text) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.points)) return emptyState();
  return {
    owner: typeof parsed.owner === 'string' ? parsed.owner : null,
    points: parsed.points as QueuedPoint[],
    last: isPlainObject(parsed.last) ? (parsed.last as unknown as QueuedPoint) : null,
  };
}

/**
 * Armazenamento real, em `Paths.document`, que sobrevive a reinício e não é
 * limpo pelo sistema. O `File` nasce no primeiro uso, e não aqui: o controle
 * do rastreio é montado pela raiz do app, inclusive onde `expo-file-system` é
 * dublê sem `File`, e lá a falha cai no `read` protegido da fila.
 */
export function createFilePositionStorage(
  fileName: string = POSITION_OUTBOX_FILE_NAME,
): OutboxStorage {
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

export function createPositionOutbox(storage: OutboxStorage): PositionOutbox {
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
    state.owner === owner ? state : { owner, points: [], last: null };

  return {
    append: (owner, points) =>
      serialized(async () => {
        const accepted: QueuedPoint[] = [];
        for (const point of points) {
          const problem = pointProblem(point);
          if (problem !== null) {
            console.warn(`[positionOutbox] ponto recusado, ${problem}`);
            continue;
          }
          accepted.push(point);
        }
        if (accepted.length === 0) return 0;

        const state = ownedBy(await read(), owner);
        let kept = 0;
        for (const point of accepted) {
          if (!shouldKeepPoint(state.last, point)) continue;
          state.points.push(point);
          state.last = point;
          kept += 1;
        }
        if (kept === 0) return 0;
        if (state.points.length > MAX_QUEUED_POINTS) {
          state.points = state.points.slice(state.points.length - MAX_QUEUED_POINTS);
        }
        await write(state);
        return kept;
      }),

    pending: (owner) =>
      serialized(async () => {
        const state = await read();
        if (state.owner === owner) return state.points;
        // Pontos de outra pessoa saem já, antes de qualquer envio com o token
        // de quem está logado agora.
        if (state.points.length > 0) await write(ownedBy(state, owner));
        return [];
      }),

    remove: (owner, recordedAts) =>
      serialized(async () => {
        const state = await read();
        if (state.owner !== owner || recordedAts.length === 0) return;
        const drop = new Set(recordedAts);
        const points = state.points.filter((p) => !drop.has(p.recordedAt));
        if (points.length === state.points.length) return;
        await write({ ...state, points });
      }),
  };
}
