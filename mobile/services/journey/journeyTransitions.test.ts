import {
  applyJourneyAction,
  journeyActionProblem,
  replayJourneyActions,
  type JourneyAction,
  type JourneySnapshot,
} from './journeyTransitions';
import type { JourneySession, Task } from './types';

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const sec = (n: number) => n * 1000;

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Tarefa ${id}`,
    description: '',
    objective: '',
    estimatedMinutes: 60,
    status: 'pending',
    startedAt: null,
    accumulatedSeconds: 0,
    progressPct: 0,
    images: [],
    responsibleCount: 1,
    responsibleNames: ['Ana'],
    responsibleAvatars: [''],
    ...over,
  };
}

const IDLE: JourneySession = { state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 };

const snap = (tasks: Task[], journey: JourneySession = IDLE): JourneySnapshot => ({ journey, tasks });
const find = (s: JourneySnapshot, id: string) => s.tasks.find((t) => t.id === id)!;

/** Turno em andamento desde T0 com a tarefa `a` correndo desde T0. */
const running = (): JourneySnapshot =>
  snap(
    [task('a', { status: 'in_progress', startedAt: iso(T0), accumulatedSeconds: 30 }), task('b')],
    { state: 'ongoing', activeTaskId: 'a', startedAt: iso(T0), accumulatedSeconds: 100 },
  );

describe('journeyTransitions: iniciar tarefa', () => {
  it('liga a tarefa e o turno na hora da ação, sem mexer no estado de entrada', () => {
    const before = snap([task('a', { accumulatedSeconds: 20 }), task('b')]);
    const after = applyJourneyAction(before, { type: 'task.start', taskId: 'a', at: T0 });

    expect(find(after, 'a')).toMatchObject({ status: 'in_progress', startedAt: iso(T0), accumulatedSeconds: 20 });
    expect(after.journey).toEqual({ state: 'ongoing', activeTaskId: 'a', startedAt: iso(T0), accumulatedSeconds: 0 });
    expect(find(before, 'a').status).toBe('pending');
    expect(before.journey).toBe(IDLE);
  });

  it('com o turno pausado, retoma o relógio do turno sem perder o que estava bancado', () => {
    const before = snap([task('a')], { state: 'paused', activeTaskId: null, startedAt: null, accumulatedSeconds: 100 });
    const after = applyJourneyAction(before, { type: 'task.start', taskId: 'a', at: T0 });
    expect(after.journey).toEqual({ state: 'ongoing', activeTaskId: 'a', startedAt: iso(T0), accumulatedSeconds: 100 });
  });

  it('na tarefa que já está correndo não reinicia o relógio dela nem o do turno', () => {
    const after = applyJourneyAction(running(), { type: 'task.start', taskId: 'a', at: T0 + sec(90) });
    expect(after).toEqual(running());
  });

  it('não vale para tarefa concluída nem para tarefa que não está na lista', () => {
    const before = snap([task('a', { status: 'done', progressPct: 100 })]);
    const done: JourneyAction = { type: 'task.start', taskId: 'a', at: T0 };
    const missing: JourneyAction = { type: 'task.start', taskId: 'zzz', at: T0 };

    expect(journeyActionProblem(before, done)).toBe('done');
    expect(journeyActionProblem(before, missing)).toBe('not_found');
    expect(applyJourneyAction(before, done)).toBe(before);
    expect(applyJourneyAction(before, missing)).toBe(before);
  });
});

describe('journeyTransitions: concluir e cancelar tarefa', () => {
  it('concluir banca o tempo, crava 100%, libera a ativa e deixa o turno correndo', () => {
    const after = applyJourneyAction(running(), { type: 'task.complete', taskId: 'a', at: T0 + sec(60) });
    expect(find(after, 'a')).toMatchObject({ status: 'done', startedAt: null, accumulatedSeconds: 90, progressPct: 100 });
    expect(after.journey).toEqual({ state: 'ongoing', activeTaskId: null, startedAt: iso(T0), accumulatedSeconds: 100 });
  });

  it('concluir de novo não mexe em nada', () => {
    const once = applyJourneyAction(running(), { type: 'task.complete', taskId: 'a', at: T0 + sec(60) });
    const twice = applyJourneyAction(once, { type: 'task.complete', taskId: 'a', at: T0 + sec(500) });
    expect(twice).toEqual(once);
  });

  it('concluir outra tarefa não solta a ativa', () => {
    const after = applyJourneyAction(running(), { type: 'task.complete', taskId: 'b', at: T0 + sec(60) });
    expect(after.journey.activeTaskId).toBe('a');
    expect(find(after, 'b').status).toBe('done');
  });

  it('cancelar devolve para pendente com o tempo bancado e o progresso zerado', () => {
    const before = running();
    before.tasks[0] = { ...before.tasks[0], progressPct: 40 };
    const after = applyJourneyAction(before, { type: 'task.cancel', taskId: 'a', at: T0 + sec(45) });
    expect(find(after, 'a')).toMatchObject({ status: 'pending', startedAt: null, accumulatedSeconds: 75, progressPct: 0 });
    expect(after.journey).toMatchObject({ state: 'ongoing', activeTaskId: null });
  });

  it('cancelar tarefa concluída não vale', () => {
    const before = snap([task('a', { status: 'done', progressPct: 100 })]);
    const action: JourneyAction = { type: 'task.cancel', taskId: 'a', at: T0 };
    expect(journeyActionProblem(before, action)).toBe('done');
    expect(applyJourneyAction(before, action)).toBe(before);
  });
});

describe('journeyTransitions: pausar, retomar e encerrar o turno', () => {
  it('pausar para a tarefa ativa e o turno, bancando o tempo e o progresso', () => {
    const after = applyJourneyAction(running(), { type: 'pause', at: T0 + sec(1800) });
    // 30 s bancados + 1800 s correndo = 1830 s de 3600 s estimados.
    expect(find(after, 'a')).toMatchObject({ status: 'paused', startedAt: null, accumulatedSeconds: 1830 });
    expect(find(after, 'a').progressPct).toBeCloseTo(50.83, 1);
    expect(after.journey).toEqual({ state: 'paused', activeTaskId: 'a', startedAt: null, accumulatedSeconds: 1900 });
  });

  it('pausar de novo não mexe em nada', () => {
    const once = applyJourneyAction(running(), { type: 'pause', at: T0 + sec(60) });
    expect(applyJourneyAction(once, { type: 'pause', at: T0 + sec(600) })).toEqual(once);
  });

  it('pausar não faz voltar uma tarefa ativa que já foi concluída', () => {
    const before = running();
    before.tasks[0] = { ...before.tasks[0], status: 'done', startedAt: null, progressPct: 100 };
    const after = applyJourneyAction(before, { type: 'pause', at: T0 + sec(60) });
    expect(find(after, 'a')).toEqual(before.tasks[0]);
    expect(after.journey.state).toBe('paused');
  });

  it('retomar volta a tarefa ativa e o turno a correr na hora da ação', () => {
    const paused = applyJourneyAction(running(), { type: 'pause', at: T0 + sec(60) });
    const after = applyJourneyAction(paused, { type: 'resume', at: T0 + sec(120) });
    expect(find(after, 'a')).toMatchObject({ status: 'in_progress', startedAt: iso(T0 + sec(120)), accumulatedSeconds: 90 });
    expect(after.journey).toEqual({ state: 'ongoing', activeTaskId: 'a', startedAt: iso(T0 + sec(120)), accumulatedSeconds: 160 });
  });

  it('retomar o que já está correndo não mexe em nada', () => {
    expect(applyJourneyAction(running(), { type: 'resume', at: T0 + sec(90) })).toEqual(running());
  });

  it('encerrar deixa a tarefa ativa pausada e zera o turno', () => {
    const after = applyJourneyAction(running(), { type: 'end', at: T0 + sec(60) });
    expect(find(after, 'a')).toMatchObject({ status: 'paused', startedAt: null, accumulatedSeconds: 90 });
    expect(after.journey).toEqual(IDLE);
  });

  it('encerrar de novo não mexe em nada', () => {
    const once = applyJourneyAction(running(), { type: 'end', at: T0 + sec(60) });
    expect(applyJourneyAction(once, { type: 'end', at: T0 + sec(600) })).toEqual(once);
  });
});

describe('journeyTransitions: foto da tarefa', () => {
  it('anexa a foto uma vez só', () => {
    const before = snap([task('a', { images: ['https://cdn/1.jpg'] })]);
    const action: JourneyAction = { type: 'task.photo', taskId: 'a', uri: 'file:///foto.jpg' };
    const once = applyJourneyAction(before, action);
    expect(find(once, 'a').images).toEqual(['https://cdn/1.jpg', 'file:///foto.jpg']);
    expect(applyJourneyAction(once, action)).toEqual(once);
  });

  it('não vale para tarefa que não está na lista', () => {
    const before = snap([task('a')]);
    const action: JourneyAction = { type: 'task.photo', taskId: 'zzz', uri: 'file:///foto.jpg' };
    expect(journeyActionProblem(before, action)).toBe('not_found');
    expect(applyJourneyAction(before, action)).toBe(before);
  });
});

describe('journeyTransitions: reaplicar a fila', () => {
  const actions: JourneyAction[] = [
    { type: 'task.start', taskId: 'a', at: T0 },
    { type: 'pause', at: T0 + sec(60) },
    { type: 'resume', at: T0 + sec(120) },
    { type: 'task.complete', taskId: 'a', at: T0 + sec(180) },
  ];

  it('aplica as ações na ordem', () => {
    const after = replayJourneyActions(snap([task('a'), task('b')]), actions);
    expect(find(after, 'a')).toMatchObject({ status: 'done', accumulatedSeconds: 120, progressPct: 100 });
    expect(after.journey).toEqual({ state: 'ongoing', activeTaskId: null, startedAt: iso(T0 + sec(120)), accumulatedSeconds: 60 });
  });

  it('a ação que o servidor já aplicou e ainda está na fila não conta duas vezes', () => {
    const base = snap([task('a'), task('b')]);
    const expected = replayJourneyActions(base, actions);
    for (let applied = 1; applied <= actions.length; applied += 1) {
      // O servidor já recebeu as `applied` primeiras; a da frente ainda está na fila.
      const server = replayJourneyActions(base, actions.slice(0, applied));
      expect(replayJourneyActions(server, actions.slice(applied - 1))).toEqual(expected);
    }
  });

  it('sem ações devolve o mesmo estado', () => {
    const base = running();
    expect(replayJourneyActions(base, [])).toBe(base);
  });
});
