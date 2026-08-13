import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { User } from '../types';
import type {
  SignUpParams, SignInParams, ConfirmSignUpParams, ResendConfirmationParams,
  ResetPasswordParams, ConfirmResetParams, ChangePasswordParams, SignUpResult,
} from './types';
import { getAuthBackend } from './getAuthBackend';

interface AuthState {
  user: User | null;
  /** true enquanto a sessão guardada (SecureStore → /auth/me) é restaurada no cold start. */
  restoring: boolean;
  signIn: (p: SignInParams) => Promise<User>;
  signUp: (p: SignUpParams) => Promise<SignUpResult>;
  confirmSignUp: (p: ConfirmSignUpParams) => Promise<void>;
  resendConfirmation: (p: ResendConfirmationParams) => Promise<void>;
  resetPassword: (p: ResetPasswordParams) => Promise<void>;
  confirmReset: (p: ConfirmResetParams) => Promise<void>;
  changePassword: (p: ChangePasswordParams) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const backend = useMemo(() => getAuthBackend(), []);

  // Cold start: restaura a sessão do token guardado. getCurrentUser() já
  // resolve null para token ausente/inválido (e limpa o storage no 401/403),
  // então falha aqui só significa "sem sessão", nunca exceção pro usuário.
  useEffect(() => {
    let alive = true;
    backend.getCurrentUser()
      .then((u) => { if (alive && u) setUser(u); })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [backend]);

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
  const resendConfirmation = useCallback((p: ResendConfirmationParams) => backend.resendConfirmation(p), [backend]);
  const resetPassword = useCallback((p: ResetPasswordParams) => backend.resetPassword(p), [backend]);
  const confirmReset = useCallback((p: ConfirmResetParams) => backend.confirmReset(p), [backend]);
  const changePassword = useCallback((p: ChangePasswordParams) => backend.changePassword(p), [backend]);
  const signOut = useCallback(async () => { await backend.signOut(); setUser(null); }, [backend]);

  const value = useMemo<AuthState>(
    () => ({ user, restoring, signIn, signUp, confirmSignUp, resendConfirmation, resetPassword, confirmReset, changePassword, signOut }),
    [user, restoring, signIn, signUp, confirmSignUp, resendConfirmation, resetPassword, confirmReset, changePassword, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
