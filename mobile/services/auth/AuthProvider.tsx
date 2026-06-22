import {
  createContext, useCallback, useContext, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { User } from '../types';
import type {
  SignUpParams, SignInParams, ConfirmSignUpParams,
  ResetPasswordParams, ConfirmResetParams, SignUpResult,
} from './types';
import { getAuthBackend } from './getAuthBackend';

interface AuthState {
  user: User | null;
  signIn: (p: SignInParams) => Promise<User>;
  signUp: (p: SignUpParams) => Promise<SignUpResult>;
  confirmSignUp: (p: ConfirmSignUpParams) => Promise<void>;
  resetPassword: (p: ResetPasswordParams) => Promise<void>;
  confirmReset: (p: ConfirmResetParams) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const backend = useMemo(() => getAuthBackend(), []);

  const signIn = useCallback(async (p: SignInParams) => {
    const u = await backend.signIn(p);
    // Stable identity: consumers that include the auth callbacks in their
    // useEffect deps (e.g. account-confirmation) would otherwise re-fire on
    // every provider render and trigger an infinite setState loop. Keep the
    // same `user` reference when the email is unchanged — do NOT simplify to
    // `setUser(u)`.
    setUser((prev) => (prev && prev.email === u.email ? prev : u));
    return u;
  }, [backend]);

  const signUp = useCallback((p: SignUpParams) => backend.signUp(p), [backend]);
  const confirmSignUp = useCallback((p: ConfirmSignUpParams) => backend.confirmSignUp(p), [backend]);
  const resetPassword = useCallback((p: ResetPasswordParams) => backend.resetPassword(p), [backend]);
  const confirmReset = useCallback((p: ConfirmResetParams) => backend.confirmReset(p), [backend]);
  const signOut = useCallback(async () => { await backend.signOut(); setUser(null); }, [backend]);

  const value = useMemo<AuthState>(
    () => ({ user, signIn, signUp, confirmSignUp, resetPassword, confirmReset, signOut }),
    [user, signIn, signUp, confirmSignUp, resetPassword, confirmReset, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
