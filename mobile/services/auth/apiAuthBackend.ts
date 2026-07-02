import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { API_URL } from './apiConfig'

const TOKEN_KEY = 'swi.auth.token'

async function req(path: string, body?: unknown, auth = false): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) { const t = await SecureStore.getItemAsync(TOKEN_KEY); if (t) headers.Authorization = `Bearer ${t}` }
  const res = await fetch(`${API_URL}${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? 'Erro de rede')   // message já vem pronta do backend (2 portas incluídas)
  return data
}

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await req('/auth/login', { email, password })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    return user
  },
  async signUp({ email, password, name }) { return req('/auth/signup', { email, password, name }) },
  async confirmSignUp({ email, code }) { await req('/auth/confirm', { email, code }) },
  async signOut() { await SecureStore.deleteItemAsync(TOKEN_KEY) },
  async resetPassword({ email }) { await req('/auth/password/forgot', { email }) },
  async confirmReset({ email, code, newPassword }) { await req('/auth/password/reset', { email, code, newPassword }) },
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try { return await req('/auth/me', undefined, true) } catch { return null }
  },
}
