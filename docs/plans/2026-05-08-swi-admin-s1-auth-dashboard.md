# SWI Admin S1 — Auth + Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the 5 screens from sprint 1 of the swi-admin pipeline (login, sign-up, password-recovery-email, password-recovery-newpassword, dashboard) with a real auth flow, persistent session, route guards, hand-rolled form validation, mockApi backing, DS-only components, 4 visual states each, Storybook stories, and basic a11y.

**Architecture:** Forms use small hand-rolled validators (`src/lib/validators.ts`) + DS `Input`/`Button`/`Checkbox` + per-screen `FormError` component. `AuthProvider` gains session persistence via `localStorage["swi.admin.session"]`, hydrates on mount, and is the only mutator of session state. Route guards `RequireAuth` (redirects unauthenticated users to `/login`) and `GuestOnly` (redirects authenticated users away from auth screens) compose around routes. mockApi gains `auth.signUp`, `auth.requestPasswordReset`, `auth.resetPassword`, persistent `auth.getSession`, and `dashboard.summary` (thin aggregator over seeded employees + alerts). Dashboard reads `dashboard.summary` and composes existing DS cards (`BigNumbersCard`, `EmployeeOverviewCard`, `ActivitiesOverviewCard`, `WorkersInfoCard`, `WeatherTimeline`).

**Tech stack:** unchanged from S0. DS v0.1.0 fully covers S1 — no new components, no DS bump. No new runtime dependency in `swi-admin`.

**Working directory:** `C:\Users\Gabriel\Documents\SWI` (call this `$REPO`).

**Source of truth for visuals:** Figma file `bzDUuPdSiKgl5xucBH0IYE`, canvas Desktop. Frame nodeIds:

| Screen | nodeId |
|---|---|
| login | `22:1585` |
| sign-up | `22:2178` |
| password-recovery-step=email | `105:12835` |
| password-recovery-step-newpassword | `105:12879` |
| dashboard | `4:2` |

For each screen task, call `mcp__claude_ai_Figma__get_design_context` with the corresponding nodeId to extract reference markup before implementing. Treat its output as a reference, not as final code — adapt to DS components and the project's TS strict + RN-Web conventions.

**Commit convention:** Conventional Commits (`feat:`, `chore:`, `test:`, `docs:`).

**Branching:** S0 was committed straight on `main`. S1 starts a feature branch `feat/s1-auth-dashboard`. Squash-merge at the end. Each task = its own commit on the branch.

**Decisions registered for S1:**

| Decision | Value |
|---|---|
| Sign-up scope | Open public; new user is bound to `org_seed_1` automatically. Multi-org is fase 2. |
| Privacy/LGPD | Sign-up form requires consent checkbox; sets `user.consent_given_at = now`. |
| Form validation | Hand-rolled `src/lib/validators.ts`. No new dep. Re-evaluate at S2. |
| Password recovery flow | Step 1 (`/recovery/email`): email → always returns success (no enumeration). Step 2 (`/recovery/new-password`): reads `?token=...` from URL; mock accepts any non-empty token. |
| Session persistence | `localStorage["swi.admin.session"]` stores serialized `User`. Hydrated synchronously in `AuthProvider` on mount. |
| Dashboard data | Thin `mockApi.dashboard.summary()` returning aggregated counts + recent items. `employees.list` and `alerts.list` are S2/S3. |

---

## Definition of Done for S1

All true:

1. `cd swi-admin && npm test` → green (auth, validators, mockApi, dashboard, routes)
2. `npm run typecheck` → green
3. `npm run lint` → green
4. `npm run build` → green
5. `npm run storybook:build` → green
6. `npm run dev` walking-skeleton:
   - Unauthenticated, visiting `/` → redirected to `/login`
   - Login with `admin@swi.test` / `demo1234` → lands on `/` (dashboard)
   - Refresh → still on `/` (session persisted)
   - Sign-out from dashboard → back to `/login`
   - Sign-up flow with new email → lands on `/`
   - `/recovery/email` accepts any email → confirmation message
   - `/recovery/new-password?token=anything` accepts new password → redirect to `/login`
7. GitHub Actions green on `main` after squash-merge
8. Tag `v0.1.0-s1` pushed
9. README "Status" updated with S1 done + Vercel preview URL refreshed

---

## Task 1: Branch and seed data

**Files:**
- Create: `$REPO/swi-admin/src/services/mockApi/seed.ts`

**Step 1: Branch**

```bash
cd C:/Users/Gabriel/Documents/SWI
git checkout -b feat/s1-auth-dashboard
```

**Step 2: Write seed data**

```ts
// src/services/mockApi/seed.ts
import type { User, Employee, Alert, ISODateString } from '../types'

const minutesAgo = (n: number): ISODateString => new Date(Date.now() - n * 60_000).toISOString()
const hoursAgo = (n: number): ISODateString => minutesAgo(n * 60)
const daysAgo = (n: number): ISODateString => hoursAgo(n * 24)

export const SEED_ORG_ID = 'org_seed_1'

export const SEED_ADMIN: User = {
  id: 'u_seed_1',
  org_id: SEED_ORG_ID,
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: daysAgo(30),
  created_at: daysAgo(60),
}

export const SEED_EMPLOYEES: Employee[] = [
  { id: 'e_001', org_id: SEED_ORG_ID, full_name: 'Ana Souza', cpf: '111.111.111-11', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.63, updated_at: minutesAgo(2) }, created_at: daysAgo(30) },
  { id: 'e_002', org_id: SEED_ORG_ID, full_name: 'Bruno Lima', cpf: '222.222.222-22', blood_type: 'A+', allergies: 'Penicilina', status: 'good', last_location: { lat: -23.55, lng: -46.64, updated_at: minutesAgo(1) }, created_at: daysAgo(45) },
  { id: 'e_003', org_id: SEED_ORG_ID, full_name: 'Carla Pinto', cpf: '333.333.333-33', blood_type: 'B+', allergies: null, status: 'alert', last_location: { lat: -23.56, lng: -46.62, updated_at: minutesAgo(3) }, created_at: daysAgo(20) },
  { id: 'e_004', org_id: SEED_ORG_ID, full_name: 'Diego Alves', cpf: '444.444.444-44', blood_type: 'AB-', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.65, updated_at: minutesAgo(5) }, created_at: daysAgo(15) },
  { id: 'e_005', org_id: SEED_ORG_ID, full_name: 'Eduarda Reis', cpf: '555.555.555-55', blood_type: 'O-', allergies: 'Lactose', status: 'low', last_location: { lat: -23.57, lng: -46.61, updated_at: minutesAgo(10) }, created_at: daysAgo(8) },
  { id: 'e_006', org_id: SEED_ORG_ID, full_name: 'Felipe Costa', cpf: '666.666.666-66', blood_type: 'A-', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.66, updated_at: minutesAgo(1) }, created_at: daysAgo(50) },
  { id: 'e_007', org_id: SEED_ORG_ID, full_name: 'Gabriela Nunes', cpf: '777.777.777-77', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.62, updated_at: minutesAgo(4) }, created_at: daysAgo(12) },
  { id: 'e_008', org_id: SEED_ORG_ID, full_name: 'Henrique Tavares', cpf: '888.888.888-88', blood_type: 'B-', allergies: null, status: 'offline', last_location: null, created_at: daysAgo(70) },
  { id: 'e_009', org_id: SEED_ORG_ID, full_name: 'Isabela Martins', cpf: '999.999.999-99', blood_type: 'A+', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.62, updated_at: minutesAgo(6) }, created_at: daysAgo(18) },
  { id: 'e_010', org_id: SEED_ORG_ID, full_name: 'Joao Vinicius', cpf: '101.010.101-01', blood_type: 'AB+', allergies: 'Frutos do mar', status: 'alert', last_location: { lat: -23.58, lng: -46.60, updated_at: minutesAgo(8) }, created_at: daysAgo(5) },
  { id: 'e_011', org_id: SEED_ORG_ID, full_name: 'Karen Oliveira', cpf: '121.212.121-12', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.63, updated_at: minutesAgo(2) }, created_at: daysAgo(25) },
  { id: 'e_012', org_id: SEED_ORG_ID, full_name: 'Lucas Pires', cpf: '131.313.131-13', blood_type: 'A+', allergies: null, status: 'good', last_location: { lat: -23.56, lng: -46.64, updated_at: minutesAgo(3) }, created_at: daysAgo(40) },
]

export const SEED_ALERTS: Alert[] = [
  { id: 'a_001', org_id: SEED_ORG_ID, employee_id: 'e_003', severity: 'warning', state: 'open', type: 'health', message: 'Frequência cardíaca elevada', created_at: minutesAgo(8), acknowledged_at: null, closed_at: null },
  { id: 'a_002', org_id: SEED_ORG_ID, employee_id: 'e_010', severity: 'critical', state: 'acknowledged', type: 'health', message: 'Possível queda detectada', created_at: minutesAgo(15), acknowledged_at: minutesAgo(12), closed_at: null },
  { id: 'a_003', org_id: SEED_ORG_ID, employee_id: 'e_005', severity: 'info', state: 'closed', type: 'meteorologic', message: 'Aviso de chuva forte na região', created_at: hoursAgo(2), acknowledged_at: hoursAgo(2), closed_at: hoursAgo(1) },
  { id: 'a_004', org_id: SEED_ORG_ID, employee_id: 'e_001', severity: 'warning', state: 'closed', type: 'health', message: 'Bateria baixa do dispositivo', created_at: hoursAgo(5), acknowledged_at: hoursAgo(5), closed_at: hoursAgo(4) },
  { id: 'a_005', org_id: SEED_ORG_ID, employee_id: 'e_004', severity: 'info', state: 'closed', type: 'manual', message: 'Início de jornada confirmado', created_at: hoursAgo(8), acknowledged_at: hoursAgo(8), closed_at: hoursAgo(8) },
]
```

**Step 3: Commit**

```bash
git add swi-admin/src/services/mockApi/seed.ts
git commit -m "feat(admin): seed admin user, 12 employees and 5 alerts for mockApi"
```

---

## Task 2: `validators.ts` (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/lib/validators.ts`
- Create: `$REPO/swi-admin/src/lib/validators.test.ts`

**Step 1: Write the failing tests**

```ts
// src/lib/validators.test.ts
import { isEmail, minLength, requiredText, matches } from './validators'

describe('isEmail', () => {
  it('accepts a normal email', () => {
    expect(isEmail('admin@swi.test')).toBe(true)
  })
  it('rejects missing @', () => {
    expect(isEmail('admin.swi.test')).toBe(false)
  })
  it('rejects empty string', () => {
    expect(isEmail('')).toBe(false)
  })
})

describe('minLength', () => {
  it('passes when string has at least N chars', () => {
    expect(minLength('abcdefgh', 8)).toBe(true)
  })
  it('fails when shorter', () => {
    expect(minLength('abc', 8)).toBe(false)
  })
})

describe('requiredText', () => {
  it('rejects empty and whitespace-only', () => {
    expect(requiredText('')).toBe(false)
    expect(requiredText('   ')).toBe(false)
  })
  it('accepts trimmed non-empty', () => {
    expect(requiredText('a')).toBe(true)
  })
})

describe('matches', () => {
  it('returns true when both are equal', () => {
    expect(matches('hunter2', 'hunter2')).toBe(true)
  })
  it('returns false when different', () => {
    expect(matches('hunter2', 'hunter3')).toBe(false)
  })
})
```

**Step 2: Run (must fail with module not found)**

```bash
cd swi-admin
npm test src/lib/validators.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// src/lib/validators.ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isEmail = (value: string): boolean => EMAIL_RE.test(value)

export const minLength = (value: string, n: number): boolean => value.length >= n

export const requiredText = (value: string): boolean => value.trim().length > 0

export const matches = (a: string, b: string): boolean => a === b
```

**Step 4: Run (must pass)**

```bash
npm test src/lib/validators.test.ts
```

Expected: PASS — 9 tests.

**Step 5: Commit**

```bash
git add swi-admin/src/lib
git commit -m "feat(admin): hand-rolled form validators with tests"
```

---

## Task 3: Expand auth mockApi (signUp, recovery, persistent session) (TDD)

**Files:**
- Modify: `$REPO/swi-admin/src/services/mockApi/auth.ts`
- Modify: `$REPO/swi-admin/src/services/mockApi/auth.test.ts`
- Modify: `$REPO/swi-admin/src/services/mockApi/index.ts`

**Step 1: Append failing tests to `auth.test.ts`**

```ts
// add to src/services/mockApi/auth.test.ts
import { authApi, SESSION_STORAGE_KEY } from './auth'

describe('authApi.signIn (persistence)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores the user in localStorage on success', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).email).toBe('admin@swi.test')
  })

  it('does not write to localStorage on failure', async () => {
    await authApi.signIn({ email: 'wrong@swi.test', password: 'no' })
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('authApi.signOut', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clears the localStorage session', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    await authApi.signOut()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('authApi.getSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns null when nothing in localStorage', async () => {
    const result = await authApi.getSession()
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('returns the stored user when present', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    const result = await authApi.getSession()
    expect(result.data?.email).toBe('admin@swi.test')
  })
})

describe('authApi.signUp', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates a user in the seed org and signs in', async () => {
    const result = await authApi.signUp({
      email: 'novo@swi.test',
      password: 'novo1234',
      full_name: 'Novo Usuario',
      consent: true,
    })
    expect(result.error).toBeNull()
    expect(result.data?.email).toBe('novo@swi.test')
    expect(result.data?.org_id).toBe('org_seed_1')
    expect(result.data?.role).toBe('admin')
    expect(result.data?.consent_given_at).not.toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull()
  })

  it('rejects when consent is false', async () => {
    const result = await authApi.signUp({
      email: 'nope@swi.test',
      password: 'nope1234',
      full_name: 'Sem Consent',
      consent: false,
    })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/consent/i)
  })

  it('rejects when email already exists', async () => {
    const result = await authApi.signUp({
      email: 'admin@swi.test',
      password: 'whatever',
      full_name: 'Duplicate',
      consent: true,
    })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/already/i)
  })
})

describe('authApi.requestPasswordReset', () => {
  it('always returns success (no enumeration leak)', async () => {
    const result = await authApi.requestPasswordReset({ email: 'whatever@swi.test' })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ sent: true })
  })
})

describe('authApi.resetPassword', () => {
  it('accepts any non-empty token + password', async () => {
    const result = await authApi.resetPassword({ token: 'tok123', newPassword: 'novo1234' })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ reset: true })
  })

  it('rejects empty token', async () => {
    const result = await authApi.resetPassword({ token: '', newPassword: 'novo1234' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/token/i)
  })

  it('rejects short password', async () => {
    const result = await authApi.resetPassword({ token: 'tok', newPassword: '123' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/password/i)
  })
})
```

**Step 2: Run (must fail)**

```bash
npm test src/services/mockApi/auth.test.ts
```

**Step 3: Replace `auth.ts`**

```ts
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
```

**Step 4: `index.ts` already re-exports `authApi`. No change needed unless a page imports `SESSION_STORAGE_KEY` — keep it on `auth.ts` and import directly when needed.**

**Step 5: Run (must pass — all auth tests)**

```bash
npm test src/services/mockApi/auth.test.ts
```

Expected: PASS — 13 tests total (2 original + 11 new).

**Step 6: Commit**

```bash
git add swi-admin/src/services/mockApi
git commit -m "feat(admin): mockApi auth with signUp, recovery, and persistent session"
```

---

## Task 4: AuthProvider hydrates from session and exposes signUp (TDD)

**Files:**
- Modify: `$REPO/swi-admin/src/hooks/useAuth.tsx`
- Modify: `$REPO/swi-admin/src/hooks/useAuth.test.tsx`

**Step 1: Append failing tests**

```tsx
// add to src/hooks/useAuth.test.tsx
import { waitFor } from '@testing-library/react'

describe('useAuth (hydration)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('hydrates user from localStorage on mount', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({
        id: 'u_seed_1',
        org_id: 'org_seed_1',
        email: 'admin@swi.test',
        full_name: 'Admin Seed',
        role: 'super_admin',
        consent_given_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }),
    )
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => {
      expect(result.current.user?.email).toBe('admin@swi.test')
    })
  })

  it('exposes a hydration flag (loading=true initially, false after hydrate)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('signUp signs in the new user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signUp({
        email: 'novo@swi.test',
        password: 'novo1234',
        full_name: 'Novo',
        consent: true,
      })
    })
    expect(result.current.user?.email).toBe('novo@swi.test')
  })

  it('signOut clears the user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.test', 'demo1234')
    })
    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })
})
```

**Step 2: Run (must fail)**

**Step 3: Replace `useAuth.tsx`**

```tsx
// src/hooks/useAuth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/services/mockApi'
import type { User } from '@/services/types'

type SignUpInput = {
  email: string
  password: string
  full_name: string
  consent: boolean
}

type Result = { ok: boolean; message?: string }

type AuthContextValue = {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Result>
  signUp: (input: SignUpInput) => Promise<Result>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    authApi.getSession().then(({ data }) => {
      if (cancelled) return
      setUser(data ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { data, error } = await authApi.signIn({ email, password })
    if (data) {
      setUser(data)
      return { ok: true }
    }
    return { ok: false, message: error?.message }
  }

  const signUp: AuthContextValue['signUp'] = async (input) => {
    const { data, error } = await authApi.signUp(input)
    if (data) {
      setUser(data)
      return { ok: true }
    }
    return { ok: false, message: error?.message }
  }

  const signOut: AuthContextValue['signOut'] = async () => {
    await authApi.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
```

**Step 4: Update the two original tests so they wait for `loading=false` before asserting user state**

```tsx
it('starts with user=null', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.user).toBeNull()
})

it('signs in with seed credentials', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.signIn('admin@swi.test', 'demo1234')
  })
  expect(result.current.user?.email).toBe('admin@swi.test')
})
```

**Step 5: Run (must pass)**

```bash
npm test src/hooks/useAuth.test.tsx
```

**Step 6: Commit**

```bash
git add swi-admin/src/hooks
git commit -m "feat(admin): AuthProvider hydration, signUp, loading state"
```

---

## Task 5: Route guards `RequireAuth` and `GuestOnly` (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/app/RequireAuth.tsx`
- Create: `$REPO/swi-admin/src/app/GuestOnly.tsx`
- Create: `$REPO/swi-admin/src/app/guards.test.tsx`

**Step 1: Write failing tests**

```tsx
// src/app/guards.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { RequireAuth } from './RequireAuth'
import { GuestOnly } from './GuestOnly'

const Protected = () => <div data-testid="protected" />
const Guest = () => <div data-testid="guest" />
const LoginStub = () => <div data-testid="login-stub" />
const HomeStub = () => <div data-testid="home-stub" />

const renderTree = (initialEntries: string[]) =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<LoginStub />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<HomeStub />} />
            <Route path="/protected" element={<Protected />} />
          </Route>
          <Route element={<GuestOnly />}>
            <Route path="/guest" element={<Guest />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )

describe('RequireAuth', () => {
  beforeEach(() => window.localStorage.clear())

  it('redirects unauthenticated user from / to /login', async () => {
    renderTree(['/'])
    await waitFor(() => {
      expect(screen.getByTestId('login-stub')).toBeInTheDocument()
    })
  })

  it('renders protected content when authenticated (session in localStorage)', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({ id: 'u_seed_1', org_id: 'org_seed_1', email: 'a', full_name: 'a', role: 'admin', consent_given_at: null, created_at: '' }),
    )
    renderTree(['/protected'])
    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument()
    })
  })
})

describe('GuestOnly', () => {
  beforeEach(() => window.localStorage.clear())

  it('lets guests in', async () => {
    renderTree(['/guest'])
    await waitFor(() => {
      expect(screen.getByTestId('guest')).toBeInTheDocument()
    })
  })

  it('redirects authenticated to /', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({ id: 'u_seed_1', org_id: 'org_seed_1', email: 'a', full_name: 'a', role: 'admin', consent_given_at: null, created_at: '' }),
    )
    renderTree(['/guest'])
    await waitFor(() => {
      expect(screen.getByTestId('home-stub')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run (must fail)**

**Step 3: Implement guards**

```tsx
// src/app/RequireAuth.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <Outlet />
}
```

```tsx
// src/app/GuestOnly.tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function GuestOnly() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
```

**Step 4: Run (must pass)**

**Step 5: Commit**

```bash
git add swi-admin/src/app/RequireAuth.tsx swi-admin/src/app/GuestOnly.tsx swi-admin/src/app/guards.test.tsx
git commit -m "feat(admin): RequireAuth and GuestOnly route guards"
```

---

## Task 6: `dashboard.summary` mockApi (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/services/mockApi/dashboard.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/dashboard.test.ts`
- Modify: `$REPO/swi-admin/src/services/mockApi/index.ts`

**Step 1: Write failing tests**

```ts
// src/services/mockApi/dashboard.test.ts
import { dashboardApi } from './dashboard'

describe('dashboardApi.summary', () => {
  it('returns aggregated employee counts by status', async () => {
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data?.employees.total).toBe(12)
    expect(
      data!.employees.byStatus.good +
        data!.employees.byStatus.alert +
        data!.employees.byStatus.low +
        data!.employees.byStatus.offline,
    ).toBe(12)
  })

  it('returns alert counts by severity (open + acknowledged only)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.alerts.openOrAcknowledged).toBeGreaterThan(0)
    expect(data?.alerts.bySeverity.critical).toBeGreaterThanOrEqual(0)
  })

  it('returns the 5 most recent activities sorted desc', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.recentActivities).toHaveLength(5)
    const timestamps = data!.recentActivities.map((a) => a.at)
    const sorted = [...timestamps].sort((a, b) => (a < b ? 1 : -1))
    expect(timestamps).toEqual(sorted)
  })

  it('returns weather timeline placeholder (3 entries)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.weather).toHaveLength(3)
  })
})
```

**Step 2: Implement**

```ts
// src/services/mockApi/dashboard.ts
import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
import { sleep } from './sleep'
import type { MockResponse } from './types'

export type DashboardSummary = {
  employees: {
    total: number
    byStatus: Record<Employee['status'], number>
  }
  alerts: {
    openOrAcknowledged: number
    bySeverity: Record<Alert['severity'], number>
  }
  recentActivities: Array<{ id: string; label: string; at: string }>
  weather: Array<{ at: string; condition: 'sun' | 'rain' | 'storm'; tempC: number }>
}

export const dashboardApi = {
  summary: async ({ orgId }: { orgId: string }): Promise<MockResponse<DashboardSummary>> => {
    await sleep(120)
    const employees = SEED_EMPLOYEES.filter((e) => e.org_id === orgId)
    const alerts = SEED_ALERTS.filter((a) => a.org_id === orgId)

    const byStatus: Record<Employee['status'], number> = { good: 0, alert: 0, low: 0, offline: 0 }
    employees.forEach((e) => {
      byStatus[e.status] += 1
    })

    const bySeverity: Record<Alert['severity'], number> = { info: 0, warning: 0, critical: 0 }
    const openOrAck = alerts.filter((a) => a.state === 'open' || a.state === 'acknowledged')
    openOrAck.forEach((a) => {
      bySeverity[a.severity] += 1
    })

    const recentActivities = [...alerts]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 5)
      .map((a) => ({ id: a.id, label: a.message, at: a.created_at }))

    const now = Date.now()
    const weather: DashboardSummary['weather'] = [
      { at: new Date(now).toISOString(), condition: 'sun', tempC: 24 },
      { at: new Date(now + 2 * 3600_000).toISOString(), condition: 'rain', tempC: 22 },
      { at: new Date(now + 5 * 3600_000).toISOString(), condition: 'storm', tempC: 19 },
    ]

    return {
      data: {
        employees: { total: employees.length, byStatus },
        alerts: { openOrAcknowledged: openOrAck.length, bySeverity },
        recentActivities,
        weather,
      },
      error: null,
    }
  },
}
```

**Step 3: Re-export from `index.ts`**

```ts
// src/services/mockApi/index.ts
export { authApi } from './auth'
export { dashboardApi } from './dashboard'
export type { DashboardSummary } from './dashboard'
export type { MockResponse, MockChannel, MockError, MockRealtimeEvent } from './types'
```

**Step 4: Run (must pass)**

```bash
npm test src/services/mockApi/dashboard.test.ts
```

**Step 5: Commit**

```bash
git add swi-admin/src/services/mockApi
git commit -m "feat(admin): dashboard.summary mockApi over seeded employees and alerts"
```

---

## Task 7: `AppLayout` with DS SideMenu + Header

**Files:**
- Create: `$REPO/swi-admin/src/app/AppLayout.tsx`
- Create: `$REPO/swi-admin/src/app/AppLayout.test.tsx`

**Step 1: Get Figma reference** — call `mcp__claude_ai_Figma__get_design_context` with `nodeId=4:2` to confirm SideMenu structure (route labels, order, icons). Adapt nav labels to match the Figma. Default mapping (matches pipeline-design routing):

| Label | Path |
|---|---|
| Dashboard | `/` |
| Mapas | `/maps/general` |
| Alertas | `/alerts` |
| Funcionários | `/employees` |
| Admins | `/admins` |
| Monitoramento | `/monitoring/alerts` |
| Relatórios | `/reports` |
| Chat | `/chat` |
| Configurações | `/user/settings` |

**Step 2: Write failing test**

```tsx
// src/app/AppLayout.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { AppLayout } from './AppLayout'

beforeEach(() => {
  window.localStorage.setItem(
    'swi.admin.session',
    JSON.stringify({
      id: 'u_seed_1',
      org_id: 'org_seed_1',
      email: 'admin@swi.test',
      full_name: 'Admin Seed',
      role: 'super_admin',
      consent_given_at: null,
      created_at: '',
    }),
  )
})

afterEach(() => window.localStorage.clear())

it('renders header with user name and outlet content', async () => {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/page']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/page" element={<div data-testid="page-content">hello</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
  await waitFor(() => {
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })
  expect(screen.getByText(/Admin Seed/)).toBeInTheDocument()
})
```

**Step 3: Implement** — read each DS component's `*.types.ts` first to confirm prop names. Skeleton:

```tsx
// src/app/AppLayout.tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { View } from 'react-native'
import { Header, HeaderUserInfo, SideMenu, MenuItem, Logo } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'

const NAV = [
  { path: '/', label: 'Dashboard' },
  { path: '/maps/general', label: 'Mapas' },
  { path: '/alerts', label: 'Alertas' },
  { path: '/employees', label: 'Funcionários' },
  { path: '/admins', label: 'Admins' },
  { path: '/monitoring/alerts', label: 'Monitoramento' },
  { path: '/reports', label: 'Relatórios' },
  { path: '/chat', label: 'Chat' },
  { path: '/user/settings', label: 'Configurações' },
] as const

export function AppLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <View testID="app-layout" style={{ flexDirection: 'row', minHeight: '100vh' as unknown as number }}>
      <SideMenu>
        <Logo />
        {NAV.map((item) => (
          <MenuItem
            key={item.path}
            label={item.label}
            active={location.pathname === item.path}
            onPress={() => navigate(item.path)}
          />
        ))}
      </SideMenu>
      <View style={{ flex: 1 }}>
        <Header>
          <HeaderUserInfo
            name={user?.full_name ?? ''}
            role={user?.role ?? ''}
            onSignOut={handleSignOut}
          />
        </Header>
        <View style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </View>
      </View>
    </View>
  )
}
```

> Adapt props to match the actual DS component signatures. The contract: every nav item is reachable, the active one is highlighted, sign-out works from the header.

**Step 4: Run (must pass)**

**Step 5: Commit**

```bash
git add swi-admin/src/app/AppLayout.tsx swi-admin/src/app/AppLayout.test.tsx
git commit -m "feat(admin): AppLayout with DS SideMenu and Header"
```

---

## Task 8: Login screen (TDD + 4 stories + route wired)

**Files:**
- Create: `$REPO/swi-admin/src/pages/auth/Login.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/Login.test.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/Login.stories.tsx`
- Create: `$REPO/swi-admin/src/components/FormError.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx` (replace Placeholder for `/login` with `Login`, wrap in `GuestOnly`; wrap protected routes in `RequireAuth` + `AppLayout`)
- Modify: `$REPO/swi-admin/src/app/routes.test.tsx` (seed session in `beforeEach` since protected routes now require auth)

**Step 1: Get Figma reference** — call `mcp__claude_ai_Figma__get_design_context` with `nodeId=22:1585`. Adapt to DS components.

**Step 2: Implement `FormError`**

```tsx
// src/components/FormError.tsx
import { Text } from '@kavicki/swi-design-system'

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Text testID="form-error" role="alert" tone="error">
      {message}
    </Text>
  )
}
```

> Adapt `tone="error"` and `role` to whatever DS `Text` actually accepts. If neither is available, wrap in a `View` with a tokenized error color and a hidden a11y role.

**Step 3: Write failing tests**

```tsx
// src/pages/auth/Login.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { Login } from './Login'

const renderAt = (path = '/login') =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )

beforeEach(() => window.localStorage.clear())

describe('Login', () => {
  it('shows email and password fields and a submit button', () => {
    renderAt()
    expect(screen.getByLabelText(/e-?mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('shows validation error for invalid email', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/email/i)
    })
  })

  it('shows error from mockApi on invalid credentials', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'admin@swi.test' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'wrongpw1' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/invalid/i)
    })
  })

  it('navigates to / on successful sign-in', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'admin@swi.test' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })
})
```

**Step 4: Implement `Login.tsx`**

```tsx
// src/pages/auth/Login.tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Checkbox, Input, Logo, Text, Title } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!isEmail(email)) {
      setError('Informe um e-mail válido')
      return
    }
    if (!requiredText(password)) {
      setError('Informe sua senha')
      return
    }
    setLoading(true)
    const result = await signIn(email, password)
    setLoading(false)
    if (result.ok) {
      navigate('/', { replace: true })
    } else {
      setError(result.message ?? 'Falha ao entrar')
    }
  }

  return (
    <View testID="login-page" style={{ alignItems: 'center', padding: 24 }}>
      <Logo />
      <Title>Entrar no SWI</Title>
      <Input
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        accessibilityLabel="E-mail"
      />
      <Input
        label="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        accessibilityLabel="Senha"
      />
      <Checkbox checked={remember} onChange={setRemember} label="Lembrar de mim" />
      <FormError message={error} />
      <Button onPress={onSubmit} disabled={loading} loading={loading}>
        Entrar
      </Button>
      <Text>
        <Link to="/recovery/email">Esqueci minha senha</Link>
      </Text>
      <Text>
        Novo aqui? <Link to="/sign-up">Criar conta</Link>
      </Text>
    </View>
  )
}
```

> Adapt all DS component props to the real signatures. `accessibilityLabel` is what makes `getByLabelText` match. If DS `Input.label` already produces the accessible name, drop the explicit `accessibilityLabel`.

**Step 5: Wire route in `App.tsx`** — restructure the route tree:

```tsx
// src/app/App.tsx
import { Routes, Route } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { GuestOnly } from './GuestOnly'
import { RequireAuth } from './RequireAuth'
import { AppLayout } from './AppLayout'
import { Placeholder } from './Placeholder'
import { ADMIN_ROUTES } from './routes'
import { Login } from '@/pages/auth/Login'

const PUBLIC_PATHS = new Set(['/login', '/sign-up', '/recovery/email', '/recovery/new-password'])

export function App() {
  return (
    <SwiThemeProvider>
      <AuthProvider>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<Login />} />
            {/* sign-up + recovery routes are wired in their own tasks */}
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              {ADMIN_ROUTES.filter((r) => !PUBLIC_PATHS.has(r.path)).map((r) => (
                <Route key={r.path} path={r.path} element={<Placeholder label={r.label} />} />
              ))}
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
```

**Step 6: Update `routes.test.tsx`** to seed a session in `beforeEach`, since protected routes now require auth:

```tsx
beforeEach(() => {
  window.localStorage.setItem(
    'swi.admin.session',
    JSON.stringify({
      id: 'u_seed_1',
      org_id: 'org_seed_1',
      email: 'admin@swi.test',
      full_name: 'Admin Seed',
      role: 'super_admin',
      consent_given_at: null,
      created_at: '',
    }),
  )
})

afterEach(() => window.localStorage.clear())
```

Public routes (`/login`, `/sign-up`, `/recovery/*`) still render placeholder until they're individually wired to real components — adjust the test list to skip those that no longer route to Placeholder. By the end of Task 11 all public routes will have real components; the test should then assert real page testIDs (`login-page`, `signup-page`, etc.) for those, and `placeholder-<label>` for protected routes still in placeholder mode.

**Step 7: Stories**

```tsx
// src/pages/auth/Login.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { Login } from './Login'

const meta: Meta<typeof Login> = {
  title: 'Pages/Auth/Login',
  component: Login,
  decorators: [
    (Story) => (
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Story />
        </MemoryRouter>
      </AuthProvider>
    ),
  ],
}
export default meta

export const Default: StoryObj<typeof Login> = {}
export const Loading: StoryObj<typeof Login> = {
  parameters: { docs: { description: { story: 'Botão em loading; reproduzir clicando em "Entrar" com mock lento.' } } },
}
export const Error: StoryObj<typeof Login> = {
  parameters: { docs: { description: { story: 'Erro vindo do mockApi.signIn — usar credenciais inválidas.' } } },
}
export const Filled: StoryObj<typeof Login> = {
  parameters: { docs: { description: { story: 'Form preenchido com credenciais demo (admin@swi.test / demo1234).' } } },
}
```

**Step 8: Run** `npm test`, `npm run typecheck`, `npm run lint` — all green.

**Step 9: Commit**

```bash
git add swi-admin/src/pages/auth swi-admin/src/components/FormError.tsx swi-admin/src/app/App.tsx swi-admin/src/app/routes.test.tsx
git commit -m "feat(admin): login screen with validation and mockApi sign-in"
```

---

## Task 9: Sign-up screen (TDD + 4 stories + route wired)

**Files:**
- Create: `$REPO/swi-admin/src/pages/auth/SignUp.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/SignUp.test.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/SignUp.stories.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx`

**Figma reference:** nodeId `22:2178`.

**Form fields:** full name, email, password, confirm password, consent checkbox (link "Ler política de privacidade" → `/modals/privacy`, no-op for S1).

**Validations:**
- `requiredText(full_name)` → "Informe seu nome completo"
- `isEmail(email)` → "E-mail inválido"
- `minLength(password, 8)` → "Senha deve ter pelo menos 8 caracteres"
- `matches(password, confirm)` → "As senhas não coincidem"
- `consent === true` → "Você precisa aceitar a política de privacidade"

**Behavior:** on submit success → navigate to `/`. Errors via `FormError`. Mirror `Login.tsx` structure.

**Tests** (mirror `Login.test`):
1. Renders all fields and the submit button
2. Validates each field independently (one wrong field at a time, others valid)
3. Surfaces error from mock when email already exists (`admin@swi.test`)
4. On success, navigates to `/`

**Stories:** Default / Loading / Error / Filled.

**Wiring in `App.tsx`:** add `<Route path="/sign-up" element={<SignUp />} />` inside the `GuestOnly` group.

**Commit:**

```bash
git commit -m "feat(admin): sign-up with consent and full validation"
```

---

## Task 10: Password recovery — request email (TDD + 4 stories + route wired)

**Files:**
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryEmail.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryEmail.test.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryEmail.stories.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx`

**Figma reference:** nodeId `105:12835`.

**Behavior:** single email input. On submit, calls `authApi.requestPasswordReset({ email })`. Mock always returns success. On success the page swaps to a confirmation panel ("Se o e-mail existir, enviamos as instruções para redefinir sua senha. Verifique sua caixa de entrada.") with a back-to-login link.

**Validations:** `isEmail(email)` only.

**Tests:**
1. Renders email field + submit button
2. Shows error on invalid email
3. On valid email, swaps to confirmation panel containing the success copy
4. Confirmation panel has a link to `/login`

**Stories:** Default / Loading / Error / Sent.

**Wiring:** `<Route path="/recovery/email" element={<RecoveryEmail />} />` inside `GuestOnly`.

**Commit:**

```bash
git commit -m "feat(admin): password recovery email request screen"
```

---

## Task 11: Password recovery — set new password (TDD + 4 stories + route wired)

**Files:**
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryNewPassword.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryNewPassword.test.tsx`
- Create: `$REPO/swi-admin/src/pages/auth/RecoveryNewPassword.stories.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx`

**Figma reference:** nodeId `105:12879`.

**Behavior:** reads `?token=...` via `useSearchParams`. Two password fields (new + confirm). On submit calls `authApi.resetPassword({ token, newPassword })`. On success → navigate to `/login`.

**Edge case:** if no token in URL, render an "Link inválido ou expirado" panel with a CTA to `/recovery/email`.

**Validations:**
- `minLength(newPassword, 8)` → "Senha deve ter pelo menos 8 caracteres"
- `matches(newPassword, confirm)` → "As senhas não coincidem"

**Tests:**
1. Renders both password fields when `?token=tok123` is present
2. Shows "Link inválido ou expirado" panel when no token in URL
3. Validation errors per field
4. On success navigates to `/login`

**Stories:** Default (with token) / NoToken / Error / Sent.

**Wiring:** `<Route path="/recovery/new-password" element={<RecoveryNewPassword />} />` inside `GuestOnly`.

**Commit:**

```bash
git commit -m "feat(admin): password recovery new-password screen with token"
```

---

## Task 12: Dashboard screen (TDD + 4 stories)

**Files:**
- Create: `$REPO/swi-admin/src/pages/dashboard/Dashboard.tsx`
- Create: `$REPO/swi-admin/src/pages/dashboard/Dashboard.test.tsx`
- Create: `$REPO/swi-admin/src/pages/dashboard/Dashboard.stories.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx` (replace Placeholder for `/`)

**Figma reference:** nodeId `4:2`. The dashboard is 1366×1329 (tall, scrollable). Read it carefully before composing.

**Composition** (using DS components present in v0.1.0):
- `BigNumbersCard` — KPI cards. Use 3–4 instances for: total funcionários, ativos agora, alertas abertos, severidade crítica.
- `EmployeeOverviewCard` — recent or featured employees.
- `ActivitiesOverviewCard` — fed by `summary.recentActivities`.
- `WorkersInfoCard` — workers status breakdown by `summary.employees.byStatus`.
- `WeatherTimeline` + `WeatherTimelineEntry` — fed by `summary.weather`.

**Behavior:** on mount, calls `dashboardApi.summary({ orgId: user.org_id })`. While loading, shows a skeleton (4 placeholder cards). On error, shows a centered `FormError` with retry button. Populated state binds the data.

**Tests:**
1. Renders skeleton placeholders while loading
2. Renders KPI counts after summary resolves (`12` employees total, etc.)
3. Renders the 5 recent activities
4. Renders 3 weather timeline entries

Mock the API per test:

```tsx
import * as mod from '@/services/mockApi/dashboard'
vi.spyOn(mod.dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
```

**Stories:** Loading / Empty / Error / Populated.

**Story-level mocking:** wrap each story with a Storybook decorator that monkey-patches `dashboardApi.summary` to return the desired payload (`null` for empty, error object for error, full summary for populated).

**Wiring:** replace `/` placeholder with `<Dashboard />` inside the `RequireAuth` + `AppLayout` group.

**Commit:**

```bash
git commit -m "feat(admin): dashboard screen reading mockApi.dashboard.summary"
```

---

## Task 13: Local verification gauntlet

No file changes — this task is the safety net before tagging.

**Step 1:** `cd swi-admin && npm test` — all green.

**Step 2:** `npm run typecheck` — green.

**Step 3:** `npm run lint` — green (fix lints, do not disable).

**Step 4:** `npm run build` — green; `dist/` produced.

**Step 5:** `npm run storybook:build` — green; `storybook-static/` produced.

**Step 6:** Walking-skeleton in browser:

- `npm run dev`
- Visit `/` (without session) → redirected to `/login`
- Login `admin@swi.test` / `demo1234` → on dashboard, sees seed counts (12 employees, 2 open/ack alerts)
- Refresh → still on dashboard
- Sign-out → redirected to `/login`
- `/sign-up` with new email and consent → on dashboard
- `/recovery/email` with any email → confirmation panel
- `/recovery/new-password?token=abc` → form, set new password, redirected to `/login`

**Step 7:** No commit — verification only.

---

## Task 14: Squash-merge, tag, and update README

**Step 1:** Push branch and open PR

```bash
git push -u origin feat/s1-auth-dashboard
gh pr create --title "S1: auth + dashboard" --body "$(cat <<'EOF'
## Summary
- 5 screens: login, sign-up, password-recovery (2 steps), dashboard
- Real auth flow with persistent session in localStorage
- Route guards (RequireAuth, GuestOnly) and AppLayout with DS SideMenu/Header
- Hand-rolled validators
- mockApi: signUp, requestPasswordReset, resetPassword, persistent getSession, dashboard.summary
- Seed data: 12 employees, 5 alerts, 1 admin, 1 org
- Storybook stories with 4 visual states per screen

## Test plan
- [ ] CI green
- [ ] Walking-skeleton verified locally (see plan Task 13)
- [ ] Vercel preview navigable end-to-end
EOF
)"
```

**Step 2:** Wait for CI green. Squash-merge to `main`.

**Step 3:** Update README

```bash
git checkout main && git pull
```

Modify `README.md` "Status" section:

```markdown
## Status

- **S0 — scaffold:** complete (`v0.0.1-scaffold`)
- **S1 — auth + dashboard:** complete (`v0.1.0-s1`)
- Vercel preview: <update URL if a new prod deploy was made>
```

**Step 4:** Tag and push

```bash
git add README.md
git commit -m "docs: S1 complete; auth flow, route guards, dashboard"
git tag -a v0.1.0-s1 -m "S1 auth + dashboard complete"
git push --tags
git push
```

**Step 5:** Verify tag visible on GitHub, CI green on tagged commit.

---

## Notes for the executing engineer

- **Don't stub DS components.** v0.1.0 has everything S1 needs. If a prop signature surprises you, read `node_modules/@kavicki/swi-design-system/src/components/<Name>/<Name>.types.ts` — that's the contract.
- **Don't add new runtime deps.** Validators are hand-rolled by design.
- **Don't add error boundaries or catch-all UIs.** S1 is happy-path + form errors only. Network failure is one branch in `mockApi`; surface it with `FormError`.
- **Don't reach into `localStorage` outside `auth.ts`.** That module owns persistence.
- **Tests next to source** in `*.test.{ts,tsx}` files.
- **Tests for forms:** prefer `getByLabelText` over `getByPlaceholderText` (a11y signal). If a DS `Input` doesn't surface a programmatic label, use `accessibilityLabel` workarounds for S1 and open an issue against the DS.
- **All commits flow through the feature branch** `feat/s1-auth-dashboard`. No direct commits on `main` during S1.
- **If you discover a missing DS component during a screen task** — STOP, follow the DS evolution protocol (PR + tag bump in `swi-design-system`, update tag in `package.json`). Don't create a local "temporary" component.
- **Figma metadata caching:** call `get_design_context` once per screen at the start of that task. Don't re-fetch.

---

## Done condition for S1

See "Definition of Done for S1" at the top. When all 9 boxes are checked, S1 is shipped and S2 (admins + employees CRUD, 6 screens) gets its own plan doc.
