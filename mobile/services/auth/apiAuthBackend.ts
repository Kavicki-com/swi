import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { apiRequest } from '../api/http'
import { setUserId, clearUserId } from '../api/session'
import { flushPendingProfile } from '../profile/pendingProfile'

const TOKEN_KEY = 'swi.auth.token'

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    setUserId(user.id)
    // Descarrega o cadastro digitado no wizard PRÉ-login (stash local — a
    // conta esperava aprovação do admin). Best-effort: nunca falha o login.
    await flushPendingProfile()
    return user
  },
  // companyId: empresa escolhida na tela de cadastro — sem ela o worker nasce
  // sem vínculo e fica invisível na fila de aprovação do painel (org-scoped).
  async signUp({ email, password, name, companyId, profile }) { return apiRequest('/auth/signup', { method: 'POST', body: { email, password, name, companyId, profile } }) },
  async confirmSignUp({ email, code }) { await apiRequest('/auth/confirm', { method: 'POST', body: { email, code } }) },
  async resendConfirmation({ email }) { await apiRequest('/auth/confirm/resend', { method: 'POST', body: { email } }) },
  async signOut() { await SecureStore.deleteItemAsync(TOKEN_KEY); clearUserId() },
  async resetPassword({ email }) { await apiRequest('/auth/password/forgot', { method: 'POST', body: { email } }) },
  async confirmReset({ email, code, newPassword }) { await apiRequest('/auth/password/reset', { method: 'POST', body: { email, code, newPassword } }) },
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try { const u = await apiRequest('/auth/me', { auth: true }); setUserId(u.id); return u } catch { return null }
  },
}
