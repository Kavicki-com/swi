import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { WeatherSnapshot, WeatherAlert } from './types';
import { getWeatherBackend } from './getWeatherBackend';
import { activeAlert as pickActiveAlert } from './weatherFormat';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherContextValue {
  loadStatus: LoadStatus;
  snapshot: WeatherSnapshot | null;
  activeAlert: WeatherAlert | null;
  reload: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextValue | null>(null);

export function WeatherProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getWeatherBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);

  const reload = useCallback(() => {
    setLoadStatus('loading');
    return backend.getWeather().then(
      (s) => { setSnapshot(s); setLoadStatus('ready'); },
      () => { setLoadStatus('error'); },   // .then(ok,err), NÃO .finally (lição do Chat)
    );
  }, [backend]);

  useEffect(() => { reload(); }, [reload]);

  // Alerta vigente derivado do snapshot (filtra expirados).
  const activeAlert = useMemo(() => (snapshot ? pickActiveAlert(snapshot) : null), [snapshot]);

  const value = useMemo<WeatherContextValue>(
    () => ({ loadStatus, snapshot, activeAlert, reload }),
    [loadStatus, snapshot, activeAlert, reload],
  );
  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather(): WeatherContextValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather must be used inside WeatherProvider');
  return ctx;
}
