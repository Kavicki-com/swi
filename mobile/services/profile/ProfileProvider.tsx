import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Profile } from './types';
import { getProfileBackend } from './getProfileBackend';

interface ProfileState {
  profile: Profile | null;
  loadProfile: () => Promise<Profile | null>;
  saveProfile: (patch: Profile) => Promise<Profile>;
}
const ProfileContext = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const backend = useMemo(() => getProfileBackend(), []);

  const loadProfile = useCallback(async () => {
    const p = await backend.get(); setProfile(p); return p;
  }, [backend]);
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
