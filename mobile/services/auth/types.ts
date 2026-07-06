import type { User } from '../types';

export type { User };

export interface SignUpParams { email: string; password: string; name: string; }
export interface SignInParams { email: string; password: string; }
export interface ConfirmSignUpParams { email: string; code: string; }
export interface ResendConfirmationParams { email: string; }
export interface ResetPasswordParams { email: string; }
export interface ConfirmResetParams { email: string; code: string; newPassword: string; }

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
  getCurrentUser(): Promise<User | null>;
}
