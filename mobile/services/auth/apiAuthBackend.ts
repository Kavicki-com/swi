import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { apiRequest } from '../api/http'

const TOKEN_KEY = 'swi.auth.token'

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    return user
  },
  async signUp({ email, password, name }) { return apiRequest('/auth/signup', { method: 'POST', body: { email, password, name } }) },
  async confirmSignUp({ email, code }) { await apiRequest('/auth/confirm', { method: 'POST', body: { email, code } }) },
  async signOut() { await SecureStore.deleteItemAsync(TOKEN_KEY) },
  async resetPassword({ email }) { await apiRequest('/auth/password/forgot', { method: 'POST', body: { email } }) },
  async confirmReset({ email, code, newPassword }) { await apiRequest('/auth/password/reset', { method: 'POST', body: { email, code, newPassword } }) },
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try { return await apiRequest('/auth/me', { auth: true }) } catch { return null }
  },
}
