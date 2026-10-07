import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { Profile } from './types';
import { getProfileBackend } from './getProfileBackend';
import { useAuth } from '../auth/AuthProvider';
import { connectionStatus } from '../realtime/connectionStatus';

interface ProfileState {
  profile: Profile | null;
  loadProfile: () => Promise<Profile | null>;
  saveProfile: (patch: Profile) => Promise<Profile>;
}
const ProfileContext = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const backend = useMemo(() => getProfileBackend(), []);
  const { user } = useAuth();

  const loadProfile = useCallback(async () => {
    const p = await backend.get(); setProfile(p); return p;
  }, [backend]);

  // Carrega sozinho ao entrar uma sessão, e limpa ao sair. Depender da TELA
  // pedir deixaria jornada, dashboard e my-stats renderizando sem perfil, e
  // essas telas caem num PNG de estoque com nome de outra pessoa. Best-effort:
  // erro aqui não pode derrubar a árvore, porque perfil ainda não preenchido
  // responde 404 e o app fica um instante sem token logo após o signIn.
  //
  // Falha de rede ou do servidor relê quando a conexão volta e quando o app
  // volta ao primeiro plano: o app aberto sem sinal ficaria sem foto e sem
  // nome a sessão inteira. 404 é perfil ainda não preenchido, e não relê.
  const [attempt, setAttempt] = useState(0);
  const failed = useRef(false);
  useEffect(() => {
    // Cada leitura começa sem dever nada: a falha é da leitura anterior.
    failed.current = false;
    if (!user) { setProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await backend.get();
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (cancelled) return;
        failed.current = (e as { status?: unknown } | null)?.status !== 404;
        setProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user, backend, attempt]);

  useEffect(() => {
    const retry = () => {
      if (!failed.current) return;
      failed.current = false;
      setAttempt((n) => n + 1);
    };
    const offReconnect = connectionStatus.onReconnect(retry);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      offReconnect();
      sub.remove();
    };
  }, []);
  const saveProfile = useCallback(async (patch: Profile) => {
    const p = await backend.save(patch); setProfile(p); return p;
  }, [backend]);

  const value = useMemo<ProfileState>(() => ({ profile, loadProfile, saveProfile }), [profile, loadProfile, saveProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
