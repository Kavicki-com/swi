import {
  signIn as awsSignIn,
  signUp as awsSignUp,
  confirmSignUp as awsConfirmSignUp,
  signOut as awsSignOut,
  resetPassword as awsResetPassword,
  confirmResetPassword as awsConfirmResetPassword,
  getCurrentUser as awsGetCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import type { AuthBackend, User } from './types';

async function currentUser(): Promise<User | null> {
  try {
    const { userId } = await awsGetCurrentUser();
    const attrs = await fetchUserAttributes();
    return {
      id: userId,
      email: attrs.email ?? '',
      name: attrs.name ?? attrs.email?.split('@')[0] ?? 'Usuário',
    };
  } catch {
    return null;
  }
}

export const amplifyAuthBackend: AuthBackend = {
  async signIn({ email, password }) {
    await awsSignIn({ username: email, password });
    const u = await currentUser();
    if (!u) throw new Error('signIn succeeded but no current user');
    return u;
  },
  async signUp({ email, password, name }) {
    const res = await awsSignUp({
      username: email,
      password,
      options: { userAttributes: { email, name } },
    });
    return { nextStep: res.isSignUpComplete ? 'DONE' : 'CONFIRM' };
  },
  async confirmSignUp({ email, code }) {
    await awsConfirmSignUp({ username: email, confirmationCode: code });
  },
  async signOut() { await awsSignOut(); },
  async resetPassword({ email }) { await awsResetPassword({ username: email }); },
  async confirmReset({ email, code, newPassword }) {
    await awsConfirmResetPassword({ username: email, confirmationCode: code, newPassword });
  },
  getCurrentUser: currentUser,
};
