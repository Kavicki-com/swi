import type { User } from '../types';

export type { User };

// companyId: empresa escolhida no cadastro (GET /companies). Opcional no tipo
// (o mock não usa), mas a tela de sign-up api sempre manda — sem ele o worker
// fica invisível na fila de aprovação org-scoped do painel (QA 2026-07-26).
// O perfil NÃO viaja junto: desde a reordenação 2026-07-27 o cadastro cria só
// a conta, e o wizard de complimentary-data preenche o perfil DEPOIS do
// primeiro login pós-aprovação (PUT /profile/me autenticado).
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

export interface AuthBackend {
  signIn(p: SignInParams): Promise<User>;
  signUp(p: SignUpParams): Promise<SignUpResult>;
  confirmSignUp(p: ConfirmSignUpParams): Promise<void>;
  resendConfirmation(p: ResendConfirmationParams): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(p: ResetPasswordParams): Promise<void>;
  confirmReset(p: ConfirmResetParams): Promise<void>;
  changePassword(p: ChangePasswordParams): Promise<void>;
  getCurrentUser(): Promise<User | null>;
}
