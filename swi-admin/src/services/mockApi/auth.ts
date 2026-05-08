// src/services/mockApi/auth.ts
import type { User } from '../types'
import { SEED_ADMIN, SEED_ORG_ID } from './seed'
import { sleep } from './sleep'
import type { MockResponse } from './types'

export const SESSION_STORAGE_KEY = 'swi.admin.session'

const KNOWN_PASSWORD = 'demo1234'

const usersByEmail = new Map<string, { user: User; password: string }>()
usersByEmail.set(SEED_ADMIN.email, { user: SEED_ADMIN, password: KNOWN_PASSWORD })

const persistSession = (user: User): void => {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
}

const clearSession = (): void => {
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

const readSession = (): User | null => {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export const authApi = {
  signIn: async ({
    email,
    password,
  }: {
    email: string
    password: string
  }): Promise<MockResponse<User>> => {
    await sleep(150)
    const entry = usersByEmail.get(email)
    if (entry && entry.password === password) {
      persistSession(entry.user)
      return { data: entry.user, error: null }
    }
    return { data: null, error: { message: 'Invalid credentials' } }
  },

  signOut: async (): Promise<MockResponse<null>> => {
    await sleep(50)
    clearSession()
    return { data: null, error: null }
  },

  getSession: async (): Promise<MockResponse<User | null>> => {
    await sleep(20)
    return { data: readSession(), error: null }
  },

  signUp: async ({
    email,
    password,
    full_name,
    consent,
  }: {
    email: string
    password: string
    full_name: string
    consent: boolean
  }): Promise<MockResponse<User>> => {
    await sleep(200)
    if (!consent) {
      return { data: null, error: { message: 'Consent is required' } }
    }
    if (usersByEmail.has(email)) {
      return { data: null, error: { message: 'Email already registered' } }
    }
    const user: User = {
      id: `u_${Math.random().toString(36).slice(2, 10)}`,
      org_id: SEED_ORG_ID,
      email,
      full_name,
      role: 'admin',
      consent_given_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    usersByEmail.set(email, { user, password })
    persistSession(user)
    return { data: user, error: null }
  },

  requestPasswordReset: async ({
    email: _email,
  }: {
    email: string
  }): Promise<MockResponse<{ sent: true }>> => {
    await sleep(150)
    return { data: { sent: true }, error: null }
  },

  resetPassword: async ({
    token,
    newPassword,
  }: {
    token: string
    newPassword: string
  }): Promise<MockResponse<{ reset: true }>> => {
    await sleep(150)
    if (!token) {
      return { data: null, error: { message: 'Invalid token' } }
    }
    if (newPassword.length < 8) {
      return { data: null, error: { message: 'Password must have at least 8 characters' } }
    }
    return { data: { reset: true }, error: null }
  },
}
