import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Profile } from './types';
import { getProfileBackend } from './getProfileBackend';
import { useAuth } from '../auth/AuthProvider';

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
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await backend.get();
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) setProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user, backend]);
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
