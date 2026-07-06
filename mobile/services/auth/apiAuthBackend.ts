import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { apiRequest } from '../api/http'
import { setUserId, clearUserId } from '../api/session'

const TOKEN_KEY = 'swi.auth.token'

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    setUserId(user.id)
    return user
  },
  async signUp({ email, password, name }) { return apiRequest('/auth/signup', { method: 'POST', body: { email, password, name } }) },
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
