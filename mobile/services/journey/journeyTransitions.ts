import type { JourneySession, Task } from './types';
import {
  startAnchors,
  pauseAnchors,
  resumeAnchors,
  endAnchors,
  progressPct,
  type Anchors,
} from './progress';

// As transições da jornada, puras. Copiam as regras do servidor
// (swi-backend/src/journey/journey.service.ts) e servem a dois lugares: o
// backend de demonstração, que guarda o estado em memória, e a tela, que
// aplica na hora do toque as ações que ainda esperam na fila de envios.
//
// Toda transição pode ser aplicada duas vezes sem mudar o resultado. A fila
// manda um item por vez e só o tira depois da resposta, então o estado lido do
// servidor pode já conter a ação da frente da fila: reaplicá-la não conta duas
// vezes.

export interface JourneySnapshot {
  journey: JourneySession;
  tasks: Task[];
}

/** `at`: a hora em que a ação vale, em epoch ms. */
export type JourneyAction =
  | { type: 'task.start' | 'task.complete' | 'task.cancel'; taskId: string; at: number }
  | { type: 'pause' | 'resume' | 'end'; at: number }
  | { type: 'task.photo'; taskId: string; uri: string };

/**
 * Por que o servidor recusaria a ação: a tarefa não é (mais) da pessoa (404)
 * ou já foi concluída (409, só para iniciar e cancelar).
 */
export type JourneyActionProblem = 'not_found' | 'done';

const IDLE: JourneySession = {
  state: 'idle',
  activeTaskId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};

// ---- Fronteira: domínio (ISO + status) ↔ Anchors (epoch ms) ----

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

export function journeyActionProblem(
  s: JourneySnapshot,
  a: JourneyAction,
): JourneyActionProblem | null {
  if (!('taskId' in a)) return null;
  const target = s.tasks.find((t) => t.id === a.taskId);
  if (!target) return 'not_found';
  if ((a.type === 'task.start' || a.type === 'task.cancel') && target.status === 'done') return 'done';
  return null;
}

function updateTask(s: JourneySnapshot, id: string, update: (t: Task) => Task): Task[] {
  return s.tasks.map((t) => (t.id === id ? update(t) : t));
}

// Pausar, retomar e encerrar mexem na tarefa ativa. Como no servidor, a ativa
// que sumiu da lista ou que outro responsável já concluiu fica como está.
function updateActive(s: JourneySnapshot, update: (t: Task) => Task): Task[] {
  const { activeTaskId } = s.journey;
  if (!activeTaskId) return s.tasks;
  return updateTask(s, activeTaskId, (t) => (t.status === 'done' ? t : update(t)));
}

// Concluir e cancelar liberam o ponteiro da ativa, e o turno segue correndo.
function release(journey: JourneySession, taskId: string): JourneySession {
  return journey.activeTaskId === taskId ? { ...journey, activeTaskId: null } : journey;
}

export function applyJourneyAction(s: JourneySnapshot, a: JourneyAction): JourneySnapshot {
  if (journeyActionProblem(s, a)) return s;
  switch (a.type) {
    case 'task.start': {
      const tasks = updateTask(s, a.taskId, (t) => {
        const ta = startAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'in_progress',
          startedAt: isoOrNull(ta.startedAt),
          accumulatedSeconds: ta.accumulatedSeconds,
        };
      });
      const ja = startAnchors(journeyAnchors(s.journey), a.at);
      return {
        tasks,
        journey: {
          state: 'ongoing',
          activeTaskId: a.taskId,
          startedAt: isoOrNull(ja.startedAt),
          accumulatedSeconds: ja.accumulatedSeconds,
        },
      };
    }

    case 'task.complete': {
      // Concluído é pleno: crava 100%, independente do estimado. Concluir de
      // novo (outro responsável chegou antes) não re-banca o tempo.
      const tasks = updateTask(s, a.taskId, (t) => {
        if (t.status === 'done') return t;
        const ta = endAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'done',
          startedAt: null,
          accumulatedSeconds: ta.accumulatedSeconds,
          progressPct: 100,
        };
      });
      return { tasks, journey: release(s.journey, a.taskId) };
    }

    case 'task.cancel': {
      // Volta para pendente com o tempo bancado. O progresso zera: pendente
      // não pode mostrar o percentual de antes.
      const tasks = updateTask(s, a.taskId, (t) => {
        const ta = pauseAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'pending',
          startedAt: null,
          accumulatedSeconds: ta.accumulatedSeconds,
          progressPct: 0,
        };
      });
      return { tasks, journey: release(s.journey, a.taskId) };
    }

    case 'pause': {
      const tasks = updateActive(s, (t) => {
        const ta = pauseAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'paused',
          startedAt: isoOrNull(ta.startedAt),
          accumulatedSeconds: ta.accumulatedSeconds,
          progressPct: progressPct(ta.accumulatedSeconds, t.estimatedMinutes),
        };
      });
      const ja = pauseAnchors(journeyAnchors(s.journey), a.at);
      return {
        tasks,
        journey: {
          ...s.journey,
          state: 'paused',
          startedAt: isoOrNull(ja.startedAt),
          accumulatedSeconds: ja.accumulatedSeconds,
        },
      };
    }

    case 'resume': {
      const tasks = updateActive(s, (t) => {
        const ta = resumeAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'in_progress',
          startedAt: isoOrNull(ta.startedAt),
          accumulatedSeconds: ta.accumulatedSeconds,
        };
      });
      const ja = resumeAnchors(journeyAnchors(s.journey), a.at);
      return {
        tasks,
        journey: {
          ...s.journey,
          state: 'ongoing',
          startedAt: isoOrNull(ja.startedAt),
          accumulatedSeconds: ja.accumulatedSeconds,
        },
      };
    }

    case 'end': {
      // Encerrar o turno PAUSA a tarefa ativa, não conclui: concluir é ação
      // própria. O turno zera o relógio, senão o tempo vazaria para o próximo.
      const tasks = updateActive(s, (t) => {
        const ta = endAnchors(taskAnchors(t), a.at);
        return {
          ...t,
          status: 'paused',
          startedAt: isoOrNull(ta.startedAt),
          accumulatedSeconds: ta.accumulatedSeconds,
          progressPct: progressPct(ta.accumulatedSeconds, t.estimatedMinutes),
        };
      });
      return { tasks, journey: IDLE };
    }

    case 'task.photo': {
      // A mesma foto enviada de novo não duplica, como no servidor.
      const tasks = updateTask(s, a.taskId, (t) =>
        t.images.includes(a.uri) ? t : { ...t, images: [...t.images, a.uri] },
      );
      return { ...s, tasks };
    }
  }
}

/** Aplica as ações na ordem em que foram feitas. */
export function replayJourneyActions(
  s: JourneySnapshot,
  actions: readonly JourneyAction[],
): JourneySnapshot {
  return actions.reduce(applyJourneyAction, s);
}
