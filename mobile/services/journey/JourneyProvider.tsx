import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { JourneyState, JourneySession, Task } from './types';
import { getJourneyBackend } from './getJourneyBackend';

// Shared journey state, agora backed pelo backend (services/journey). Consumido
// por:
//   - journey/index.tsx → idle vs ongoing/paused layout switch + donut real
//   - journey/task/[id].tsx → state machine das CTAs + progress real
//
// O provider fica montado em app/(app)/_layout.tsx — a sessão vive durante o
// login e remonta no logout. `load()` busca journey + tasks no mount; as
// mutações (start/pause/resume/end/addTaskPhoto) são async + persistidas no
// backend, e atualizam o estado local com o resultado.
//
// `startedAt`/`accumulatedSeconds` da sessão ficam expostos pro donut do index
// derivar o tempo decorrido real via progress.ts (âncoras epoch ms).

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface JourneyContextValue {
  loadStatus: LoadStatus;
  tasks: Task[];
  state: JourneyState;
  activeTaskId: string | null;
  /** Âncoras da sessão (ISO string + segundos bancados) pro donut do index. */
  startedAt: string | null;
  accumulatedSeconds: number;
  load: () => Promise<void>;
  getTask: (id: string) => Promise<Task | null>;
  startTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  pauseJourney: () => Promise<void>;
  resumeJourney: () => Promise<void>;
  endJourney: () => Promise<void>;
  addTaskPhoto: (taskId: string, uri: string) => Promise<Task>;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getJourneyBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [session, setSession] = useState<JourneySession>({
    state: 'idle',
    activeTaskId: null,
    startedAt: null,
    accumulatedSeconds: 0,
  });

  const load = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const [j, t] = await Promise.all([backend.getJourney(), backend.listTasks()]);
      setSession(j);
      setTasks(t);
      setLoadStatus(t.length ? 'ready' : 'empty');
    } catch {
      setLoadStatus('error');
    }
  }, [backend]);

  useEffect(() => {
    load();
  }, [load]);

  const getTask = useCallback((id: string) => backend.getTask(id), [backend]);

  const startTask = useCallback(
    async (taskId: string) => {
      const { journey, task } = await backend.startTask(taskId);
      setSession(journey);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    },
    [backend],
  );

  const completeTask = useCallback(
    async (taskId: string) => {
      const { journey, task } = await backend.completeTask(taskId);
      setSession(journey);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    },
    [backend],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      const { journey, task } = await backend.cancelTask(taskId);
      setSession(journey);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    },
    [backend],
  );

  const pauseJourney = useCallback(async () => {
    setSession(await backend.pauseJourney());
    setTasks(await backend.listTasks()); // a task ativa virou 'paused' (snapshot) — barra congela
  }, [backend]);
  const resumeJourney = useCallback(async () => {
    setSession(await backend.resumeJourney());
    setTasks(await backend.listTasks()); // a task ativa voltou a 'in_progress' — barra retoma
  }, [backend]);
  const endJourney = useCallback(async () => {
    setSession(await backend.endJourney());
    setTasks(await backend.listTasks()); // Decisão E: a ativa virou 'paused' (não 'done')
  }, [backend]);

  const addTaskPhoto = useCallback(
    async (taskId: string, uri: string) => {
      const updated = await backend.addTaskPhoto(taskId, uri);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      return updated;
    },
    [backend],
  );

  const value = useMemo<JourneyContextValue>(
    () => ({
      loadStatus,
      tasks,
      state: session.state,
      activeTaskId: session.activeTaskId,
      startedAt: session.startedAt,
      accumulatedSeconds: session.accumulatedSeconds,
      load,
      getTask,
      startTask,
      completeTask,
      cancelTask,
      pauseJourney,
      resumeJourney,
      endJourney,
      addTaskPhoto,
    }),
    [
      loadStatus,
      tasks,
      session,
      load,
      getTask,
      startTask,
      completeTask,
      cancelTask,
      pauseJourney,
      resumeJourney,
      endJourney,
      addTaskPhoto,
    ],
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error('useJourney must be used inside JourneyProvider');
  return ctx;
}
