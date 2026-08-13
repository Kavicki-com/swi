import type { AuthBackend, User } from './types';

function userFromEmail(email: string): User {
  return { id: '1', email, name: email.split('@')[0] ?? 'Usuário' };
}

export const mockAuthBackend: AuthBackend = {
  async signIn({ email }) { return userFromEmail(email); },
  async signUp() { return { nextStep: 'CONFIRM' }; },
  async confirmSignUp() {},
  async resendConfirmation() {},
  async signOut() {},
  async resetPassword() {},
  async confirmReset() {},
  async changePassword() {},
  async getCurrentUser() { return null; },
};
