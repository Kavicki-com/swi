import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import type { User } from '../types';
import type {
  SignUpParams, SignInParams, ConfirmSignUpParams, ResendConfirmationParams,
  ResetPasswordParams, ConfirmResetParams, ChangePasswordParams, SignUpResult, SessionCheck,
} from './types';
import { getAuthBackend } from './getAuthBackend';
import { createSessionKeeper } from './sessionKeeper';
import { onUnauthorized } from '../api/unauthorized';
import { getJourneyCache } from '../journey/journeyCache';
import { connectionStatus } from '../realtime/connectionStatus';

/**
 * Quanto a abertura espera o servidor confirmar a sessão antes de abrir pela
 * cópia guardada. Com sinal bom a resposta chega antes; sem sinal, a tela não
 * fica em branco pelos 20 s do prazo de uma chamada.
 */
export const RESTORE_WAIT_MS = 3_000;

interface AuthState {
  user: User | null;
  /** true enquanto a abertura decide se há sessão (servidor ou cópia guardada). */
  restoring: boolean;
  /** O servidor recusou a sessão guardada: o login avisa que ela terminou. */
  sessionEnded: boolean;
  dismissSessionEnded: () => void;
  /**
   * A sessão voltou sozinha com o app no login (abriu sem sinal e sem cópia, e
   * o servidor confirmou depois): o login segue para o dashboard.
   */
  resumed: boolean;
  /** Alguém começou a digitar no login: para de tentar retomar a sessão guardada. */
  stopResume: () => void;
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

const clearJourneyCache = () => getJourneyCache().clear().catch(() => undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [resumed, setResumed] = useState(false);
  const backend = useMemo(() => getAuthBackend(), []);

  // Espelho síncrono de `user` para as respostas do servidor, que chegam fora
  // do render.
  const userRef = useRef<User | null>(null);
  const showUser = useCallback((next: User | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  // A sessão acabou sem a pessoa pedir: o token já saiu (ou sai aqui), a cópia
  // da jornada também, e o layout autenticado manda ao login, que avisa.
  const endSession = useCallback(() => {
    void clearJourneyCache();
    showUser(null);
    setSessionEnded(true);
  }, [showUser]);

  // Quem pergunta de novo ao servidor. Com usuário na tela, a resposta
  // confirma (ou atualiza nome e e-mail) a sessão aberta; sem usuário, é a
  // retomada do login.
  const keeperRef = useRef<ReturnType<typeof createSessionKeeper> | null>(null);
  const keeper = useMemo(() => createSessionKeeper({
    confirm: () => backend.confirmSession(),
    onValid: (next) => {
      const current = userRef.current;
      if (!current) {
        showUser(next);
        setResumed(true);
        return;
      }
      // A cópia só abre com o token da mesma pessoa; resposta de outra
      // pessoa é estado que não deveria existir, e a saída segura é sair.
      if (current.id !== next.id) {
        keeperRef.current?.stop();
        void backend.signOut().catch(() => undefined);
        endSession();
        return;
      }
      if (current.email !== next.email || current.name !== next.name) showUser(next);
    },
    onRevoked: endSession,
  }), [backend, showUser, endSession]);
  keeperRef.current = keeper;

  // Abertura: o servidor tem 3 s para confirmar a sessão. Sem resposta, sem
  // rede ou com 5xx, a cópia guardada abre o app (só a da mesma pessoa, com
  // menos de 72 h) e a confirmação segue depois. Sem cópia, o login, e a
  // sessão guardada ainda pode voltar sozinha se o servidor confirmar.
  useEffect(() => {
    let alive = true;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const confirming = backend.confirmSession()
      .catch((): SessionCheck => ({ status: 'unreachable' }));
    const waited = new Promise<null>((resolve) => {
      waitTimer = setTimeout(() => resolve(null), RESTORE_WAIT_MS);
    });

    (async () => {
      const first = await Promise.race([confirming, waited]);
      clearTimeout(waitTimer);
      if (!alive) return;
      if (first?.status === 'valid') {
        showUser(first.user);
        keeper.start(true);
        setRestoring(false);
        return;
      }
      if (first?.status === 'revoked') {
        endSession();
        setRestoring(false);
        return;
      }
      if (first?.status === 'none') {
        setRestoring(false);
        return;
      }
      const stored = await backend.restoreSession().catch(() => null);
      if (!alive) return;
      if (stored) showUser(stored.user);
      // A confirmação que passou dos 3 s continua e vale quando chegar.
      keeper.start(false, first === null ? confirming : undefined);
      setRestoring(false);
    })();

    return () => {
      alive = false;
      clearTimeout(waitTimer);
      keeper.stop();
    };
  }, [backend, keeper, showUser, endSession]);

  // Gatilhos da confirmação. Um 401 pergunta sempre: é o servidor recusando o
  // token no meio da sessão (conta desativada no painel). A conexão que volta
  // e o primeiro plano só perguntam enquanto o servidor não confirmou.
  useEffect(() => {
    const offUnauthorized = onUnauthorized(() => keeper.trigger());
    const offReconnect = connectionStatus.onReconnect(() => keeper.retry());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') keeper.retry();
    });
    return () => {
      offUnauthorized();
      offReconnect();
      sub.remove();
    };
  }, [keeper]);

  const signIn = useCallback(async (p: SignInParams) => {
    const u = await backend.signIn(p);
    keeper.start(true);
    setSessionEnded(false);
    setResumed(false);
    // Stable identity: consumers that include the auth callbacks in their
    // useEffect deps (e.g. account-confirmation) would otherwise re-fire on
    // every provider render and trigger an infinite setState loop. Keep the
    // same `user` reference when the email is unchanged — do NOT simplify to
    // `showUser(u)`.
    const prev = userRef.current;
    showUser(prev && prev.email === u.email ? prev : u);
    return u;
  }, [backend, keeper, showUser]);

  const signUp = useCallback((p: SignUpParams) => backend.signUp(p), [backend]);
  const confirmSignUp = useCallback((p: ConfirmSignUpParams) => backend.confirmSignUp(p), [backend]);
  const resendConfirmation = useCallback((p: ResendConfirmationParams) => backend.resendConfirmation(p), [backend]);
  const resetPassword = useCallback((p: ResetPasswordParams) => backend.resetPassword(p), [backend]);
  const confirmReset = useCallback((p: ConfirmResetParams) => backend.confirmReset(p), [backend]);
  const changePassword = useCallback((p: ChangePasswordParams) => backend.changePassword(p), [backend]);
  const signOut = useCallback(async () => {
    // Antes de tudo: uma confirmação que chegue depois não pode reabrir a sessão.
    // E a pessoa sai mesmo se o backend falhar ao apagar o que guardou.
    keeper.stop();
    try {
      await backend.signOut();
    } finally {
      await clearJourneyCache();
      setResumed(false);
      showUser(null);
    }
  }, [backend, keeper, showUser]);

  const dismissSessionEnded = useCallback(() => setSessionEnded(false), []);
  const stopResume = useCallback(() => {
    if (!userRef.current) keeper.stop();
  }, [keeper]);

  const value = useMemo<AuthState>(
    () => ({
      user, restoring, sessionEnded, dismissSessionEnded, resumed, stopResume,
      signIn, signUp, confirmSignUp, resendConfirmation, resetPassword, confirmReset, changePassword, signOut,
    }),
    [
      user, restoring, sessionEnded, dismissSessionEnded, resumed, stopResume,
      signIn, signUp, confirmSignUp, resendConfirmation, resetPassword, confirmReset, changePassword, signOut,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
