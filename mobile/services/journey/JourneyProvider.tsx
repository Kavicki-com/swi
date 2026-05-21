import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

// Shared journey state. Consumido por:
//   - journey/index.tsx → idle vs ongoing/paused layout switch
//   - journey/task/[id].tsx → state machine das CTAs + progress crawl
//
// Demo phase: state em memória (sem AsyncStorage). Um cold start zera a
// jornada — aceitável pra demo. Produção: persistir activeTaskId/state em
// AsyncStorage + sincronizar com backend (timer real, posição na fila).

export type JourneyState = 'idle' | 'ongoing' | 'paused';

interface JourneyContextValue {
  state: JourneyState;
  /** ID da task atualmente ativa, ou null se state === 'idle'. */
  activeTaskId: string | null;
  /** Inicia uma task. Sobrescreve qualquer task ativa anterior. */
  startTask: (taskId: string) => void;
  /** Pausa a jornada atual. No-op se não há jornada ativa. */
  pauseJourney: () => void;
  /** Retoma a jornada pausada. No-op se não está pausada. */
  resumeJourney: () => void;
  /** Encerra a jornada (finalizar OU cancelar). Volta pro estado idle. */
  endJourney: () => void;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<JourneyState>('idle');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const startTask = useCallback((taskId: string) => {
    setActiveTaskId(taskId);
    setState('ongoing');
  }, []);

  const pauseJourney = useCallback(() => {
    setState((prev) => (prev === 'ongoing' ? 'paused' : prev));
  }, []);

  const resumeJourney = useCallback(() => {
    setState((prev) => (prev === 'paused' ? 'ongoing' : prev));
  }, []);

  const endJourney = useCallback(() => {
    setState('idle');
    setActiveTaskId(null);
  }, []);

  const value = useMemo<JourneyContextValue>(
    () => ({
      state,
      activeTaskId,
      startTask,
      pauseJourney,
      resumeJourney,
      endJourney,
    }),
    [state, activeTaskId, startTask, pauseJourney, resumeJourney, endJourney],
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) {
    throw new Error('useJourney must be used inside JourneyProvider');
  }
  return ctx;
}
