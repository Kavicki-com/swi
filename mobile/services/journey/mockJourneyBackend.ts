import { Asset } from 'expo-asset';
import type {
  JourneyBackend,
  JourneySession,
  Task,
} from './types';
import {
  startAnchors,
  pauseAnchors,
  resumeAnchors,
  endAnchors,
  elapsedSeconds,
  progressPct,
  type Anchors,
} from './progress';

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
// As transições usam os reducers puros de progress.ts; convertemos entre o
// domínio (`startedAt` ISO string + status/state) e `Anchors` (epoch ms +
// `running` derivado) na fronteira. `Date.now()` é a fonte de `nowMs` em runtime.

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

// ---- Boundary: domínio (ISO string + status) ↔ Anchors (epoch ms) ----

function taskAnchors(t: Task): Anchors {
  return {
    startedAt: t.startedAt ? new Date(t.startedAt).getTime() : null,
    accumulatedSeconds: t.accumulatedSeconds,
    running: t.status === 'in_progress',
  };
}

function journeyAnchors(j: JourneySession): Anchors {
  return {
    startedAt: j.startedAt ? new Date(j.startedAt).getTime() : null,
    accumulatedSeconds: j.accumulatedSeconds,
    running: j.state === 'ongoing',
  };
}

function isoOrNull(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

// ---- Store mutável module-level ----

let tasks: Task[] = SEED_BASE.map(seedTask);
let journey: JourneySession = {
  state: 'idle',
  activeTaskId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function findTask(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export const mockJourneyBackend: JourneyBackend = {
  async getJourney() {
    await tick();
    return { ...journey };
  },

  async listTasks() {
    await tick();
    return tasks.map((t) => ({ ...t }));
  },

  async getTask(id) {
    await tick();
    const found = findTask(id);
    return found ? { ...found } : null;
  },

  async startTask(taskId) {
    await tick();
    const task = findTask(taskId);
    if (!task) throw new Error(`mockJourneyBackend.startTask: task ${taskId} não encontrada`);
    const now = Date.now();

    // Modelo single-active-task: uma task previamente ativa NÃO é auto-pausada
    // aqui (caveat aceito no design — só uma task ativa por vez na prática).
    const ta = startAnchors(taskAnchors(task), now);
    task.status = 'in_progress';
    task.startedAt = isoOrNull(ta.startedAt);
    task.accumulatedSeconds = ta.accumulatedSeconds;

    const ja = startAnchors(journeyAnchors(journey), now);
    journey = {
      state: 'ongoing',
      activeTaskId: taskId,
      startedAt: isoOrNull(ja.startedAt),
      accumulatedSeconds: ja.accumulatedSeconds,
    };

    return { journey: { ...journey }, task: { ...task } };
  },

  async completeTask(taskId) {
    await tick();
    const task = findTask(taskId);
    if (!task) throw new Error(`mockJourneyBackend.completeTask: task ${taskId} não encontrada`);
    const now = Date.now();

    // Conclui o item: banca o tempo corrido e crava 100% (concluído = pleno,
    // independente do estimado). O turno segue rodando — só o slot ativo libera.
    const ta = endAnchors(taskAnchors(task), now);
    task.status = 'done';
    task.startedAt = isoOrNull(ta.startedAt);
    task.accumulatedSeconds = ta.accumulatedSeconds;
    task.progressPct = 100;

    if (journey.activeTaskId === taskId) {
      journey = { ...journey, activeTaskId: null };
    }

    return { journey: { ...journey }, task: { ...task } };
  },

  async cancelTask(taskId) {
    await tick();
    const task = findTask(taskId);
    if (!task) throw new Error(`mockJourneyBackend.cancelTask: task ${taskId} não encontrada`);
    const now = Date.now();

    // Devolve o item pro pool de pendentes preservando os segundos bancados
    // (pauseAnchors banca o segmento corrente). O turno segue rodando.
    const ta = pauseAnchors(taskAnchors(task), now);
    task.status = 'pending';
    task.startedAt = isoOrNull(ta.startedAt);
    task.accumulatedSeconds = ta.accumulatedSeconds;

    if (journey.activeTaskId === taskId) {
      journey = { ...journey, activeTaskId: null };
    }

    return { journey: { ...journey }, task: { ...task } };
  },

  async pauseJourney() {
    await tick();
    const now = Date.now();
    const active = journey.activeTaskId ? findTask(journey.activeTaskId) : undefined;
    if (active) {
      const ta = pauseAnchors(taskAnchors(active), now);
      active.progressPct = progressPct(
        elapsedSeconds(taskAnchors(active), now),
        active.estimatedMinutes,
      );
      active.status = 'paused';
      active.startedAt = isoOrNull(ta.startedAt);
      active.accumulatedSeconds = ta.accumulatedSeconds;
    }
    const ja = pauseAnchors(journeyAnchors(journey), now);
    journey = {
      ...journey,
      state: 'paused',
      startedAt: isoOrNull(ja.startedAt),
      accumulatedSeconds: ja.accumulatedSeconds,
    };
    return { ...journey };
  },

  async resumeJourney() {
    await tick();
    const now = Date.now();
    const active = journey.activeTaskId ? findTask(journey.activeTaskId) : undefined;
    if (active) {
      const ta = resumeAnchors(taskAnchors(active), now);
      active.status = 'in_progress';
      active.startedAt = isoOrNull(ta.startedAt);
      active.accumulatedSeconds = ta.accumulatedSeconds;
    }
    const ja = resumeAnchors(journeyAnchors(journey), now);
    journey = {
      ...journey,
      state: 'ongoing',
      startedAt: isoOrNull(ja.startedAt),
      accumulatedSeconds: ja.accumulatedSeconds,
    };
    return { ...journey };
  },

  async endJourney() {
    await tick();
    const now = Date.now();
    const active = journey.activeTaskId ? findTask(journey.activeTaskId) : undefined;
    if (active) {
      // Decision E (espelha o backend): encerrar o turno PAUSA o item ativo —
      // não o conclui. Concluir é ação explícita via completeTask.
      const ta = endAnchors(taskAnchors(active), now);
      active.progressPct = progressPct(ta.accumulatedSeconds, active.estimatedMinutes);
      active.status = 'paused';
      active.startedAt = isoOrNull(ta.startedAt);
      active.accumulatedSeconds = ta.accumulatedSeconds;
    }
    // Turno encerrado zera o relógio: o próximo turno (idle→ongoing via
    // startTask) preserva o accumulatedSeconds da jornada, então qualquer
    // tempo banked aqui vazaria pro donut do turno seguinte. O banking de
    // tarefa é separado (cada task é seu próprio objeto) e não é afetado.
    journey = {
      state: 'idle',
      activeTaskId: null,
      startedAt: null,
      accumulatedSeconds: 0,
    };
    return { ...journey };
  },

  async addTaskPhoto(taskId, uri) {
    await tick();
    const task = findTask(taskId);
    if (!task) throw new Error(`mockJourneyBackend.addTaskPhoto: task ${taskId} não encontrada`);
    task.images = [...task.images, uri];
    return { ...task };
  },
};
