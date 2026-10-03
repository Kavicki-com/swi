import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import type { WeatherSnapshot, WeatherAlert } from './types';
import { getWeatherBackend } from './getWeatherBackend';
import { activeAlert as pickActiveAlert } from './weatherFormat';
import { useAuth } from '../auth/AuthProvider';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherContextValue {
  loadStatus: LoadStatus;
  snapshot: WeatherSnapshot | null;
  activeAlert: WeatherAlert | null;
  reload: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextValue | null>(null);

// Releitura periódica com o app aberto. O backend guarda a leitura em cache,
// então perguntar de cinco em cinco minutos não custa uma ida ao provedor.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Teto do setTimeout (int32): acima disso ele dispara na hora.
const MAX_TIMEOUT_MS = 2_147_483_647;

export function WeatherProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getWeatherBackend(), []);
  const { user } = useAuth();
  const signedIn = user !== null;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  // Relógio do alerta vigente. Anda quando chega leitura, quando o app volta
  // pro primeiro plano e na hora em que o próximo alerta acaba (efeito abaixo).
  const [now, setNow] = useState(() => Date.now());
  const hasSnapshot = useRef(false);
  // Muda a cada sessão: resposta de pedido feito antes do logout é descartada.
  const session = useRef(0);

  // Com leitura na tela a releitura é silenciosa: não volta pra 'loading' e,
  // se falhar, mantém o último snapshot. Leitura de minutos atrás vale mais
  // que tela vazia por uma falha de rede momentânea.
  const reload = useCallback(() => {
    const mine = session.current;
    if (!hasSnapshot.current) setLoadStatus('loading');
    return backend.getWeather().then(
      (s) => {
        if (session.current !== mine) return;
        hasSnapshot.current = true;
        setSnapshot(s);
        setNow(Date.now());
        setLoadStatus('ready');
      },
      () => {   // .then(ok,err), NÃO .finally (lição do Chat)
        if (session.current !== mine) return;
        if (!hasSnapshot.current) setLoadStatus('error');
      },
    );
  }, [backend]);

  // O clima é rota autenticada e o provider mora acima do login: só busca com
  // sessão, e limpa ao sair (mesmo padrão do ProfileProvider). Com sessão, três
  // gatilhos: a entrada, o relógio e a volta do segundo plano, que cobre o
  // tempo em que o app ficou parado com os timers suspensos.
  useEffect(() => {
    if (!signedIn) return;
    void reload();
    const timer = setInterval(() => { void reload(); }, REFRESH_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setNow(Date.now());
      void reload();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      session.current += 1;
      hasSnapshot.current = false;
      setSnapshot(null);
      setLoadStatus('idle');
    };
  }, [signedIn, reload]);

  // O alerta deixa de valer na hora em que acaba, mesmo sem snapshot novo
  // (releitura falhando, ou ainda longe do próximo ciclo). Um timer mira o fim
  // do próximo alerta vigente e anda o relógio; o efeito se rearma sozinho pro
  // alerta seguinte.
  useEffect(() => {
    if (!snapshot) return;
    const ends = snapshot.alerts
      .map((a) => new Date(a.endsAt).getTime())
      .filter((end) => end >= now);
    if (ends.length === 0) return;
    const delay = Math.min(Math.max(Math.min(...ends) - Date.now() + 1, 0), MAX_TIMEOUT_MS);
    // prev + 1: o relógio sempre anda, mesmo se o timer disparar adiantado.
    const timer = setTimeout(() => setNow((prev) => Math.max(Date.now(), prev + 1)), delay);
    return () => clearTimeout(timer);
  }, [snapshot, now]);

  // Alerta vigente derivado do snapshot (filtra expirados, prefere perigo).
  const activeAlert = useMemo(
    () => (snapshot ? pickActiveAlert(snapshot, new Date(now)) : null),
    [snapshot, now],
  );

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
