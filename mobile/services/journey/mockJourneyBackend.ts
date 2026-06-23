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
// descrições), agora enriquecido com `objective`, `estimatedMinutes` e
// `interested*`. lib/journeyMockData.ts NÃO é deletado aqui — uma unidade
// posterior remove depois que as telas pararem de importá-lo.
//
// As transições usam os reducers puros de progress.ts; convertemos entre o
// domínio (`startedAt` ISO string + status/state) e `Anchors` (epoch ms +
// `running` derivado) na fronteira. `Date.now()` é a fonte de `nowMs` em runtime.

// 5 avatares demo distintos de /assets/avatars/worker-{1..5}.png.
// Asset.fromModule resolve cada require() pra uma uri servida pelo Metro
// (DS Avatar/AvatarGroup só aceita `uri: string`). Espelha os thumbnails
// variados do cluster "Interessados" no Figma.
const INTERESTED_AVATARS: string[] = [
  Asset.fromModule(require('../../assets/avatars/worker-1.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-2.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-3.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-4.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-5.png')).uri,
];

// Worker demo único pra todas as tasks nesta fase.
const DEMO_WORKER = 'worker-demo';

// scheduledDate = hoje (ISO date, sem horário).
const TODAY = new Date().toISOString().slice(0, 10);

// estimatedMinutes 120 por task × 4 = 480min = 8h → bate com o "8h" idle do
// donut da jornada.
const ESTIMATED_MINUTES = 120;
const INTERESTED_COUNT = 18;

// Seed base migrado de lib/journeyMockData.ts (TASKS), com `objective`
// adicionado (uma frase sobre a meta de cada tarefa).
type SeedBase = {
  id: string;
  title: string;
  description: string;
  objective: string;
};

const SEED_BASE: SeedBase[] = [
  {
    id: 'inspecao',
    title: 'Inspeção de Equipamentos',
    description:
      'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
    objective:
      'Garantir que cada equipamento esteja em condições seguras de operação, identificando desgastes antes que virem falhas.',
  },
  {
    id: 'manutencao',
    title: 'Manutenção Preventiva',
    description:
      'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
    objective:
      'Prolongar a vida útil dos equipamentos e minimizar paradas não planejadas executando a manutenção dentro do cronograma.',
  },
  {
    id: 'diagnostico',
    title: 'Diagnóstico de Falhas',
    description:
      'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
    objective:
      'Determinar com precisão a causa-raiz de cada mau funcionamento para direcionar o reparo correto.',
  },
  {
    id: 'reparo',
    title: 'Reparo de Componentes',
    description:
      'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
    objective:
      'Restaurar o funcionamento pleno dos equipamentos substituindo ou consertando as peças defeituosas identificadas.',
  },
];

function seedTask(base: SeedBase): Task {
  return {
    ...base,
    assignedTo: DEMO_WORKER,
    estimatedMinutes: ESTIMATED_MINUTES,
    status: 'pending',
    startedAt: null,
    accumulatedSeconds: 0,
    progressPct: 0,
    scheduledDate: TODAY,
    images: [],
    interestedCount: INTERESTED_COUNT,
    interestedAvatars: INTERESTED_AVATARS,
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
      const ta = endAnchors(taskAnchors(active), now);
      active.progressPct = progressPct(ta.accumulatedSeconds, active.estimatedMinutes);
      active.status = 'done';
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
