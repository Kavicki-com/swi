import { Asset } from 'expo-asset';
import type {
  JourneyBackend,
  JourneySend,
  Task,
} from './types';
import {
  applyJourneyAction,
  journeyActionProblem,
  type JourneyAction,
  type JourneySnapshot,
} from './journeyTransitions';

// Backend demo in-memory pra slice Jornada/Tarefas. Mirrors
// services/reports/mockReportsBackend.ts: um store mutável module-level semeado
// no load, servido com um tiny async hop (`tick`) pra os callers se comportarem
// como rede real. Seed migrado de lib/journeyMockData.ts (4 tasks, títulos +
// descrições) pra cá, agora enriquecido com `estimatedMinutes` e os campos da
// WorkOrder pai (`objective`, `responsible*`). O antigo lib/journeyMockData.ts
// foi removido nesta slice (as telas agora consomem só este backend via
// JourneyProvider).
//
// Modelo WorkOrder: as 4 tasks são o checklist de UMA ordem, então compartilham
// o mesmo `objective` (summary da ordem), `images` e `responsible*`. Espelha
// `taskToDto` de swi-backend/src/journey/journey.service.ts.
//
// As transições são as de journeyTransitions.ts, as mesmas que a tela usa para
// aplicar na hora do toque o que espera na fila. A ação vinda da fila vale na
// hora do toque (`occurredAt`), como no servidor; sem ela, `Date.now()`.

// Campos herdados da WorkOrder pai — compartilhados pelas 4 tasks do checklist.
// `objective` = summary da ordem; `responsibleNames`/`responsibleCount` = os
// responsáveis da ordem (primeiro nome dirige o caption "N e mais X pessoas...").
const ORDER_OBJECTIVE =
  'Checklist de manutenção preventiva e reparos necessários no maquinário B2.';
const RESPONSIBLE_NAMES = ['Joacir Alves', 'Romulo Cardoso', 'Marina Souza'];
const RESPONSIBLE_COUNT = RESPONSIBLE_NAMES.length;

// 3 avatares demo distintos de /assets/avatars/worker-{1..3}.png — um por
// responsável. Asset.fromModule resolve cada require() pra uma uri servida pelo
// Metro (DS Avatar/AvatarGroup só aceita `uri: string`). Invariante do backend
// real: responsibleAvatars.length === responsibleNames.length === responsibleCount.
const RESPONSIBLE_AVATARS: string[] = [
  Asset.fromModule(require('../../assets/avatars/worker-1.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-2.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-3.png')).uri,
];

// estimatedMinutes 120 por task × 4 = 480min = 8h → bate com o "8h" idle do
// donut da jornada.
const ESTIMATED_MINUTES = 120;

// Seed base migrado de lib/journeyMockData.ts (TASKS): só id/título/descrição
// por item; `objective` e `responsible*` vêm da ordem pai (constantes acima).
type SeedBase = {
  id: string;
  title: string;
  description: string;
};

const SEED_BASE: SeedBase[] = [
  {
    id: 'inspecao',
    title: 'Inspeção de Equipamentos',
    description:
      'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
  },
  {
    id: 'manutencao',
    title: 'Manutenção Preventiva',
    description:
      'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
  },
  {
    id: 'diagnostico',
    title: 'Diagnóstico de Falhas',
    description:
      'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
  },
  {
    id: 'reparo',
    title: 'Reparo de Componentes',
    description:
      'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
  },
];

function seedTask(base: SeedBase): Task {
  return {
    ...base,
    objective: ORDER_OBJECTIVE,
    estimatedMinutes: ESTIMATED_MINUTES,
    status: 'pending',
    startedAt: null,
    accumulatedSeconds: 0,
    progressPct: 0,
    images: [],
    responsibleCount: RESPONSIBLE_COUNT,
    responsibleNames: RESPONSIBLE_NAMES,
    responsibleAvatars: RESPONSIBLE_AVATARS,
  };
}

// ---- Store mutável module-level ----

let store: JourneySnapshot = {
  journey: {
    state: 'idle',
    activeTaskId: null,
    startedAt: null,
    accumulatedSeconds: 0,
  },
  tasks: SEED_BASE.map(seedTask),
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function findTask(id: string): Task | undefined {
  return store.tasks.find((t) => t.id === id);
}

/** A hora em que a ação vale: a do toque, quando veio da fila. */
function actionTime(send?: JourneySend): number {
  const touched = send ? Date.parse(send.occurredAt) : NaN;
  return Number.isNaN(touched) ? Date.now() : touched;
}

/** O erro como a API o devolve: com status e marcado como dela. */
function apiError(status: 404 | 409, message: string): Error {
  return Object.assign(new Error(message), { status, apiError: true });
}

/** Aplica a ação no store, ou recusa como o servidor recusaria. */
function act(action: JourneyAction): JourneySnapshot {
  const problem = journeyActionProblem(store, action);
  if (problem === 'not_found') throw apiError(404, 'Tarefa não encontrada');
  if (problem === 'done') throw apiError(409, 'Tarefa já concluída');
  store = applyJourneyAction(store, action);
  return store;
}

function taskResult(taskId: string) {
  return { journey: { ...store.journey }, task: { ...findTask(taskId)! } };
}

export const mockJourneyBackend: JourneyBackend = {
  async getJourney() {
    await tick();
    return { ...store.journey };
  },

  async listTasks() {
    await tick();
    return store.tasks.map((t) => ({ ...t }));
  },

  async getTask(id) {
    await tick();
    const found = findTask(id);
    return found ? { ...found } : null;
  },

  async startTask(taskId, send) {
    await tick();
    act({ type: 'task.start', taskId, at: actionTime(send) });
    return taskResult(taskId);
  },

  async completeTask(taskId, send) {
    await tick();
    act({ type: 'task.complete', taskId, at: actionTime(send) });
    return taskResult(taskId);
  },

  async cancelTask(taskId, send) {
    await tick();
    act({ type: 'task.cancel', taskId, at: actionTime(send) });
    return taskResult(taskId);
  },

  async pauseJourney(send) {
    await tick();
    return { ...act({ type: 'pause', at: actionTime(send) }).journey };
  },

  async resumeJourney(send) {
    await tick();
    return { ...act({ type: 'resume', at: actionTime(send) }).journey };
  },

  async endJourney(send) {
    await tick();
    return { ...act({ type: 'end', at: actionTime(send) }).journey };
  },

  // Sem servidor, a "key" da foto é a própria uri local, que a tela mostra.
  async uploadImage(localUri) {
    return localUri;
  },

  async addTaskPhoto(taskId, imageKey) {
    await tick();
    act({ type: 'task.photo', taskId, uri: imageKey });
    return { ...findTask(taskId)! };
  },
};
