import type { User } from '../types'
import { sleep } from './sleep'
import type { MockResponse } from './types'

const SEED_USER: User = {
  id: 'u_seed_1',
  org_id: 'org_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
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
    if (email === SEED_USER.email && password === 'demo1234') {
      return { data: SEED_USER, error: null }
    }
    return { data: null, error: { message: 'Invalid credentials' } }
  },
  signOut: async (): Promise<MockResponse<null>> => {
    await sleep(50)
    return { data: null, error: null }
  },
  getSession: async (): Promise<MockResponse<User | null>> => {
    await sleep(50)
    return { data: null, error: null }
  },
}
