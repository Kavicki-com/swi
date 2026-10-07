import type { JourneySnapshot } from './journeyTransitions';
import type { JourneySession, JourneyState, Task, TaskStatus } from './types';
import { createFilePositionStorage } from '../positions/positionOutbox';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// Cópia da última jornada lida do servidor, para a tela abrir sem sinal. Tem
// dono: a de outra pessoa não vale. Guarda o que serve sem rede (títulos,
// descrições, tempos, nomes dos responsáveis) e deixa de fora as fotos e os
// avatares: são endereços assinados, que dão acesso às imagens enquanto valem
// e que sem rede não abrem de qualquer jeito.
//
// Apagada no logout e quando o servidor recusa a sessão.

export const JOURNEY_CACHE_FILE_NAME = 'journey-cache.v1.json';
const VERSION = 1;

export interface JourneyCache {
  /** Ausente, ilegível, de forma errada ou de outro dono: null. */
  read(owner: string): Promise<JourneySnapshot | null>;
  write(owner: string, snapshot: JourneySnapshot): Promise<void>;
  clear(): Promise<void>;
}

const JOURNEY_STATES: readonly JourneyState[] = ['idle', 'ongoing', 'paused'];
const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'paused', 'done'];

const isText = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTextOrNull = (v: unknown) => v === null || isText(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readJourney(v: unknown): JourneySession | null {
  if (!isRecord(v)) return null;
  const { state, activeTaskId, startedAt, accumulatedSeconds } = v;
  if (!JOURNEY_STATES.includes(state as JourneyState)) return null;
  if (!isTextOrNull(activeTaskId) || !isTextOrNull(startedAt) || !isNumber(accumulatedSeconds)) return null;
  return {
    state: state as JourneyState,
    activeTaskId: activeTaskId as string | null,
    startedAt: startedAt as string | null,
    accumulatedSeconds,
  };
}

function readTask(v: unknown): Task | null {
  if (!isRecord(v)) return null;
  const t = v;
  if (
    !isText(t.id) || !isText(t.title) || !isText(t.description) || !isText(t.objective) ||
    !isNumber(t.estimatedMinutes) || !TASK_STATUSES.includes(t.status as TaskStatus) ||
    !isTextOrNull(t.startedAt) || !isNumber(t.accumulatedSeconds) || !isNumber(t.progressPct) ||
    !isNumber(t.responsibleCount) || !Array.isArray(t.responsibleNames) ||
    !t.responsibleNames.every(isText)
  ) {
    return null;
  }
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    objective: t.objective,
    estimatedMinutes: t.estimatedMinutes,
    status: t.status as TaskStatus,
    startedAt: t.startedAt as string | null,
    accumulatedSeconds: t.accumulatedSeconds,
    progressPct: t.progressPct,
    images: [],
    responsibleCount: t.responsibleCount,
    responsibleNames: t.responsibleNames as string[],
    responsibleAvatars: [],
  };
}

// O que vai para o arquivo, campo a campo: campo novo que o servidor passe a
// mandar só entra aqui por decisão de alguém.
function storedJourney(j: JourneySession) {
  return {
    state: j.state,
    activeTaskId: j.activeTaskId,
    startedAt: j.startedAt,
    accumulatedSeconds: j.accumulatedSeconds,
  };
}

function storedTask(t: Task) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    objective: t.objective,
    estimatedMinutes: t.estimatedMinutes,
    status: t.status,
    startedAt: t.startedAt,
    accumulatedSeconds: t.accumulatedSeconds,
    progressPct: t.progressPct,
    responsibleCount: t.responsibleCount,
    responsibleNames: t.responsibleNames,
  };
}

export function createJourneyCache(storage: OutboxStorage): JourneyCache {
  return {
    async read(owner) {
      let text: string | null;
      try {
        text = await storage.read();
      } catch {
        return null;
      }
      if (!text) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }
      if (!isRecord(parsed) || parsed.v !== VERSION || parsed.owner !== owner) return null;
      const journey = readJourney(parsed.journey);
      if (!journey || !Array.isArray(parsed.tasks)) return null;
      const tasks = parsed.tasks.map(readTask);
      if (tasks.some((t) => t === null)) return null;
      return { journey, tasks: tasks as Task[] };
    },

    async write(owner, snapshot) {
      await storage.write(
        JSON.stringify({
          v: VERSION,
          owner,
          journey: storedJourney(snapshot.journey),
          tasks: snapshot.tasks.map(storedTask),
        }),
      );
    },

    async clear() {
      await storage.write('');
    },
  };
}

let cache: JourneyCache | null = null;

/** A cópia real, em arquivo, criada no primeiro uso. */
export function getJourneyCache(): JourneyCache {
  return (cache ??= createJourneyCache(createFilePositionStorage(JOURNEY_CACHE_FILE_NAME)));
}
