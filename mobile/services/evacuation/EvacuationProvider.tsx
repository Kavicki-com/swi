import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { RouteSnapshot } from './types';
import { getEvacuationBackend } from './getEvacuationBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface EvacuationContextValue {
  loadStatus: LoadStatus;
  route: RouteSnapshot | null;
  load: () => Promise<void>;   // lazy: busca só na 1ª chamada (telas chamam no mount)
  reload: () => Promise<void>; // força refetch
}

const EvacuationContext = createContext<EvacuationContextValue | null>(null);

export function EvacuationProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getEvacuationBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [route, setRoute] = useState<RouteSnapshot | null>(null);
  const started = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(() => {
    started.current = true;
    setLoadStatus('loading');
    const p = backend.getRoute().then(
      (r) => { setRoute(r); setLoadStatus('ready'); },
      () => { setLoadStatus('error'); }, // .then(ok,err), NÃO .finally (lição do Chat)
    );
    inFlight.current = p;
    return p;
  }, [backend]);

  // Lazy + dedupe: 1º load() dispara o fetch; chamadas seguintes reusam a promise
  // em voo (ou no-op se já carregou). Evacuação é tela rara → sem fetch no boot.
  const load = useCallback(() => {
    if (started.current) return inFlight.current ?? Promise.resolve();
    return reload();
  }, [reload]);

  const value = useMemo<EvacuationContextValue>(
    () => ({ loadStatus, route, load, reload }),
    [loadStatus, route, load, reload],
  );
  return <EvacuationContext.Provider value={value}>{children}</EvacuationContext.Provider>;
}

export function useEvacuation(): EvacuationContextValue {
  const ctx = useContext(EvacuationContext);
  if (!ctx) throw new Error('useEvacuation must be used inside EvacuationProvider');
  return ctx;
}
