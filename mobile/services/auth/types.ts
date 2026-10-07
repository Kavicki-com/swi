import type { User } from '../types';
import type { StoredSession } from './storedSession';

export type { User, StoredSession };

// companyId: empresa escolhida no cadastro (GET /companies). Opcional no tipo
// porque o mock não usa, mas a tela de sign-up da api sempre manda: sem ele o
// worker fica invisível na fila de aprovação com escopo por empresa do painel.
// O perfil NÃO viaja junto. O cadastro cria só a conta, e o wizard de
// complimentary-data preenche o perfil DEPOIS do primeiro login pós-aprovação
// (PUT /profile/me autenticado).
export interface SignUpParams {
  email: string;
  password: string;
  name: string;
  companyId?: string;
}
export interface SignInParams { email: string; password: string; }
export interface ConfirmSignUpParams { email: string; code: string; }
export interface ResendConfirmationParams { email: string; }
export interface ResetPasswordParams { email: string; }
export interface ConfirmResetParams { email: string; code: string; newPassword: string; }
// Nomes espelham o ChangePasswordDto do backend (currentPassword/newPassword).
export interface ChangePasswordParams { currentPassword: string; newPassword: string; }

export interface SignUpResult {
  /** 'CONFIRM' → a verification code was emailed; 'DONE' → already usable. */
  nextStep: 'CONFIRM' | 'DONE';
}

/** O que o servidor disse da sessão guardada. */
export type SessionCheck =
  | { status: 'valid'; user: User }
  /** 401 ou 403 da própria API: token e cópia da sessão já foram apagados. */
  | { status: 'revoked' }
  /** Sem rede, prazo, 5xx, ou alguém no caminho respondendo: nada muda. */
  | { status: 'unreachable' }
  /** Não há token guardado. */
  | { status: 'none' };

export interface AuthBackend {
  signIn(p: SignInParams): Promise<User>;
  signUp(p: SignUpParams): Promise<SignUpResult>;
  confirmSignUp(p: ConfirmSignUpParams): Promise<void>;
  resendConfirmation(p: ResendConfirmationParams): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(p: ResetPasswordParams): Promise<void>;
  confirmReset(p: ConfirmResetParams): Promise<void>;
  changePassword(p: ChangePasswordParams): Promise<void>;
  /** Só local: a cópia da sessão, se ela é do token guardado e tem menos de 72 h. */
  restoreSession(): Promise<StoredSession | null>;
  /** Pergunta ao servidor se a sessão guardada ainda vale. */
  confirmSession(): Promise<SessionCheck>;
}
