# SWI Admin S0 — Scaffold Implementation Plan


**Goal:** Bootstrap the `swi-admin` Vite + RN-Web app with the SWI Design System pinned, a `services/mockApi` skeleton, all 32 routes rendering placeholders, Storybook 9 running, ESLint/Prettier/Vitest green, GitHub Actions CI passing, and a Vercel preview deployed.

**Architecture:** Vite SPA. `react-native` aliased to `react-native-web` so the universal DS components render as DOM. `SwiThemeProvider` from `@kavicki/swi-design-system` wraps the app. Data flows exclusively through `services/mockApi` whose interface mirrors `@supabase/supabase-js` shapes (`{ data, error, count? }`). `react-router` v6 owns navigation. Tests run in Vitest + jsdom with `@testing-library/react`.

**Tech stack:** Vite 5, React 18, TypeScript strict, react-native-web 0.19, styled-components 6, `@kavicki/swi-design-system@v0.1.0` (pinned by git tag), react-router 6, zustand, Vitest, Storybook 9, Vercel, GitHub Actions.

**Working directory for all tasks:** `C:\Users\Gabriel\Documents\SWI` (call this `$REPO`).

**Commit convention:** Conventional Commits (`feat:`, `chore:`, `test:`, `docs:`, `ci:`).

---

## Task 1: Initialize git repo and basic ignores

**Files:**
- Create: `$REPO/.gitignore`
- Create: `$REPO/README.md`

**Step 1: Init repo**

```bash
cd C:/Users/Gabriel/Documents/SWI
git init
git branch -M main
```

**Step 2: Write `.gitignore`**

```
node_modules/
dist/
storybook-static/
.vite/
coverage/
.env
.env.local
.DS_Store
*.log
```

**Step 3: Write minimal `README.md`**

```markdown
# SWI Admin

Web admin for SWI (employee field monitoring). Front-first MVP — see `docs/plans/2026-05-08-swi-admin-pipeline-design.md`.
```

**Step 4: First commit**

```bash
git add .gitignore README.md docs/
git commit -m "chore: initial repo with design and S0 plan"
```

Expected: 1 commit on `main`.

---

## Task 2: Create `swi-admin/` directory and `package.json`

**Files:**
- Create: `$REPO/swi-admin/package.json`

**Step 1: Create directory**

```bash
mkdir swi-admin
cd swi-admin
```

**Step 2: Write `package.json`**

```json
{
  "name": "swi-admin",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest run",
    "test:watch": "vitest",
    "storybook": "storybook dev -p 6007",
    "storybook:build": "storybook build"
  },
  "dependencies": {
    "@kavicki/swi-design-system": "git+https://github.com/Kavicki-com/swi-design-system.git#v0.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.1",
    "react-native-web": "^0.19.0",
    "react-router-dom": "^6.26.0",
    "styled-components": "^6.1.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/styled-components": "^5.1.34",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react": "^7.35.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "jsdom": "^25.0.0",
    "prettier": "^3.3.0",
    "storybook": "^9.0.0",
    "@storybook/react-vite": "^9.0.0",
    "@storybook/addon-docs": "^9.0.0",
    "@storybook/addon-a11y": "^9.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 3: Install**

```bash
npm install
```

Expected: install succeeds; `node_modules/@kavicki/swi-design-system/` exists with `src/` folder.

**Step 4: Commit**

```bash
git add swi-admin/package.json swi-admin/package-lock.json
git commit -m "chore(admin): add package.json with DS pinned to v0.1.0"
```

---

## Task 3: TypeScript strict config

**Files:**
- Create: `$REPO/swi-admin/tsconfig.json`
- Create: `$REPO/swi-admin/tsconfig.node.json`

**Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**Step 2: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 3: Run typecheck (expects "no input files" — config must parse)**

```bash
npx tsc --noEmit
```

Expected: errors about no input files, NOT errors about config malformed.

**Step 4: Commit**

```bash
git add swi-admin/tsconfig*.json
git commit -m "chore(admin): typescript strict config with @ alias"
```

---

## Task 4: Vite config with `react-native` → `react-native-web` alias

**Files:**
- Create: `$REPO/swi-admin/vite.config.ts`

**Step 1: Write config**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js'],
  },
  optimizeDeps: {
    include: ['react-native-web', 'styled-components'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
```

**Step 2: Commit**

```bash
git add swi-admin/vite.config.ts
git commit -m "chore(admin): vite config with rn-web alias"
```

---

## Task 5: Source folder skeleton + Vite entry

**Files:**
- Create empty placeholders in:
  - `$REPO/swi-admin/src/app/`
  - `$REPO/swi-admin/src/pages/`
  - `$REPO/swi-admin/src/services/mockApi/`
  - `$REPO/swi-admin/src/services/types/`
  - `$REPO/swi-admin/src/components/`
  - `$REPO/swi-admin/src/hooks/`
  - `$REPO/swi-admin/src/config/`
- Create: `$REPO/swi-admin/index.html`
- Create: `$REPO/swi-admin/src/main.tsx`

**Step 1: Create folders**

```bash
mkdir -p src/app src/pages src/services/mockApi src/services/types src/components src/hooks src/config
```

**Step 2: Write `index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SWI Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 3: Write `src/main.tsx`** (will fail to compile until Task 10 wires the router):

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

**Step 4: Commit**

```bash
git add swi-admin/src swi-admin/index.html
git commit -m "chore(admin): folder skeleton and html entry"
```

---

## Task 6: `App` shell with `SwiThemeProvider` + smoke test (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/app/App.tsx`
- Create: `$REPO/swi-admin/src/app/App.test.tsx`
- Create: `$REPO/swi-admin/src/test-setup.ts`
- Create: `$REPO/swi-admin/vitest.config.ts`

**Step 1: Write the failing test**

```tsx
// src/app/App.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'

describe('App', () => {
  it('renders inside SwiThemeProvider without crashing', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
  })
})
```

**Step 2: Write `test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

**Step 3: Write Vitest config**

```ts
// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      css: false,
    },
  }),
)
```

**Step 4: Run test (must fail)**

```bash
npm test
```

Expected: FAIL with "Cannot find module './App'".

**Step 5: Implement minimal `App`**

```tsx
// src/app/App.tsx
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { View } from 'react-native'

export function App() {
  return (
    <SwiThemeProvider>
      <View testID="app-root" />
    </SwiThemeProvider>
  )
}
```

**Step 6: Run test (must pass)**

```bash
npm test
```

Expected: PASS — 1 test, 1 assertion.

**Step 7: Commit**

```bash
git add swi-admin/src/app swi-admin/src/test-setup.ts swi-admin/vitest.config.ts
git commit -m "feat(admin): app shell with SwiThemeProvider and smoke test"
```

---

## Task 7: `mockApi` types + sleep helper (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/services/types/index.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/types.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/sleep.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/sleep.test.ts`

**Step 1: Write the failing test**

```ts
// src/services/mockApi/sleep.test.ts
import { sleep } from './sleep'

describe('sleep', () => {
  it('resolves after the given milliseconds', async () => {
    const start = performance.now()
    await sleep(50)
    const elapsed = performance.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(200)
  })
})
```

**Step 2: Run (must fail)**

```bash
npm test src/services/mockApi/sleep.test.ts
```

Expected: FAIL "Cannot find module './sleep'".

**Step 3: Implement**

```ts
// src/services/mockApi/sleep.ts
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
```

**Step 4: Run (must pass)**

```bash
npm test src/services/mockApi/sleep.test.ts
```

Expected: PASS.

**Step 5: Add `MockResponse` and `MockChannel` shapes**

```ts
// src/services/mockApi/types.ts
export type MockError = { message: string; code?: string }

export type MockResponse<T> = {
  data: T | null
  error: MockError | null
  count?: number
}

export type MockRealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export type MockChannel = {
  subscribe(): MockChannel
  unsubscribe(): void
  on(event: MockRealtimeEvent, cb: (payload: unknown) => void): MockChannel
}
```

**Step 6: Add domain types skeleton**

```ts
// src/services/types/index.ts
export type ID = string
export type ISODateString = string

export type User = {
  id: ID
  org_id: ID
  email: string
  full_name: string
  role: 'admin' | 'super_admin'
  consent_given_at: ISODateString | null
  created_at: ISODateString
}

export type Employee = {
  id: ID
  org_id: ID
  full_name: string
  cpf: string
  blood_type: string | null
  allergies: string | null
  status: 'good' | 'alert' | 'low' | 'offline'
  last_location: { lat: number; lng: number; updated_at: ISODateString } | null
  created_at: ISODateString
}

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertState =
  | 'open'
  | 'acknowledged'
  | 'rescue_route_assigned'
  | 'rescue_ongoing'
  | 'closed'
  | 'cancelled'

export type Alert = {
  id: ID
  org_id: ID
  employee_id: ID
  severity: AlertSeverity
  state: AlertState
  type: 'health' | 'meteorologic' | 'manual'
  message: string
  created_at: ISODateString
  acknowledged_at: ISODateString | null
  closed_at: ISODateString | null
}
```

**Step 7: Commit**

```bash
git add swi-admin/src/services
git commit -m "feat(admin): mockApi types and sleep helper with tests"
```

---

## Task 8: First mockApi stub — `auth.signIn` (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/services/mockApi/auth.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/auth.test.ts`
- Create: `$REPO/swi-admin/src/services/mockApi/index.ts`

**Step 1: Write the failing tests**

```ts
// src/services/mockApi/auth.test.ts
import { authApi } from './auth'

describe('authApi.signIn', () => {
  it('returns a User on valid credentials', async () => {
    const result = await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    expect(result.error).toBeNull()
    expect(result.data?.email).toBe('admin@swi.test')
  })

  it('returns an error on invalid credentials', async () => {
    const result = await authApi.signIn({ email: 'nope@swi.test', password: 'wrong' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/invalid/i)
  })
})
```

**Step 2: Run (must fail)**

```bash
npm test src/services/mockApi/auth.test.ts
```

Expected: FAIL "Cannot find module './auth'".

**Step 3: Implement**

```ts
// src/services/mockApi/auth.ts
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
```

**Step 4: Add `index.ts` aggregator**

```ts
// src/services/mockApi/index.ts
export { authApi } from './auth'
export type { MockResponse, MockChannel, MockError, MockRealtimeEvent } from './types'
```

**Step 5: Run (must pass)**

```bash
npm test src/services/mockApi/auth.test.ts
```

Expected: PASS — 2 tests.

**Step 6: Commit**

```bash
git add swi-admin/src/services/mockApi
git commit -m "feat(admin): mockApi auth stub with sign-in success and failure paths"
```

---

## Task 9: `AuthContext` skeleton (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/hooks/useAuth.tsx`
- Create: `$REPO/swi-admin/src/hooks/useAuth.test.tsx`

**Step 1: Write the failing tests**

```tsx
// src/hooks/useAuth.test.tsx
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './useAuth'

describe('useAuth', () => {
  it('starts with user=null', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    expect(result.current.user).toBeNull()
  })

  it('signs in with seed credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => {
      await result.current.signIn('admin@swi.test', 'demo1234')
    })
    expect(result.current.user?.email).toBe('admin@swi.test')
  })
})
```

**Step 2: Run (must fail)**

```bash
npm test src/hooks/useAuth.test.tsx
```

Expected: FAIL.

**Step 3: Implement**

```tsx
// src/hooks/useAuth.tsx
import { createContext, useContext, useState, type ReactNode } from 'react'
import { authApi } from '@/services/mockApi'
import type { User } from '@/services/types'

type AuthContextValue = {
  user: User | null
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { data, error } = await authApi.signIn({ email, password })
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

  return <AuthContext.Provider value={{ user, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
```

**Step 4: Run (must pass)**

```bash
npm test src/hooks/useAuth.test.tsx
```

Expected: PASS — 2 tests.

**Step 5: Commit**

```bash
git add swi-admin/src/hooks
git commit -m "feat(admin): AuthProvider/useAuth backed by mockApi"
```

---

## Task 10: Router with 32 placeholder routes (TDD)

**Files:**
- Create: `$REPO/swi-admin/src/app/routes.tsx`
- Create: `$REPO/swi-admin/src/app/Placeholder.tsx`
- Modify: `$REPO/swi-admin/src/app/App.tsx`
- Create: `$REPO/swi-admin/src/app/routes.test.tsx`

**Step 1: Write the route table**

```tsx
// src/app/routes.tsx
export const ADMIN_ROUTES = [
  // auth
  { path: '/login', label: 'login' },
  { path: '/sign-up', label: 'sign-up' },
  { path: '/recovery/email', label: 'password-recovery-email' },
  { path: '/recovery/new-password', label: 'password-recovery-newpassword' },
  // core
  { path: '/', label: 'dashboard' },
  // admins
  { path: '/admins', label: 'admins' },
  { path: '/admins/new', label: 'admin-registration' },
  { path: '/admins/:id', label: 'admin-details' },
  // employees
  { path: '/employees', label: 'employees' },
  { path: '/employees/new', label: 'employee-registration' },
  { path: '/employees/:id', label: 'employee-details' },
  // maps
  { path: '/maps/general', label: 'map-view-general' },
  { path: '/maps/cameras', label: 'map-view-cameras' },
  { path: '/maps/heat', label: 'map-view-heat' },
  { path: '/maps/meteorologic', label: 'map-metereologic-alerts' },
  // alerts
  { path: '/alerts', label: 'alerts' },
  { path: '/alerts/heatmap', label: 'alerts-heatmap' },
  { path: '/alerts/meteorologic', label: 'alerts-metereologic-map' },
  { path: '/alerts/:id/rescue-route', label: 'alerts-rescue-route' },
  { path: '/alerts/:id/rescue-route/select', label: 'alerts-rescue-route-selection' },
  { path: '/alerts/:id/rescue-ongoing', label: 'alerts-rescue-ongoing' },
  // monitoring
  { path: '/monitoring/alerts', label: 'monitoring-alerts' },
  { path: '/monitoring/good-conditions', label: 'monitoring-good-conditions' },
  // reports
  { path: '/reports', label: 'reports' },
  { path: '/reports/new', label: 'new-report' },
  { path: '/reports/:id', label: 'report-details' },
  // chat
  { path: '/chat', label: 'chat-inbox' },
  // user
  { path: '/user/settings', label: 'user-settings' },
  { path: '/user/profile', label: 'user-profile' },
  // modals (rendered as routes for now; promoted to overlays in S5)
  { path: '/modals/support', label: 'support-form-modal' },
  { path: '/modals/privacy', label: 'privacy-policy-modal' },
  { path: '/modals/responsables', label: 'responsables-modal' },
] as const

export type AdminRoute = (typeof ADMIN_ROUTES)[number]
```

**Step 2: Write `Placeholder` page**

```tsx
// src/app/Placeholder.tsx
import { View, Text } from 'react-native'

export function Placeholder({ label }: { label: string }) {
  return (
    <View testID={`placeholder-${label}`} style={{ padding: 24 }}>
      <Text>Em construção: {label}</Text>
    </View>
  )
}
```

**Step 3: Write the failing test**

```tsx
// src/app/routes.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_ROUTES } from './routes'
import { App } from './App'

describe('Admin router', () => {
  it.each(ADMIN_ROUTES.map((r) => [r.path, r.label]))(
    'renders placeholder for %s',
    (path, label) => {
      const concretePath = path.replace(':id', 'seed_id')
      render(
        <MemoryRouter initialEntries={[concretePath]}>
          <App />
        </MemoryRouter>,
      )
      expect(screen.getByTestId(`placeholder-${label}`)).toBeInTheDocument()
    },
  )
})
```

**Step 4: Run (must fail — App still has only View, no router yet)**

```bash
npm test src/app/routes.test.tsx
```

Expected: FAIL.

**Step 5: Wire router into `App`**

```tsx
// src/app/App.tsx
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { Routes, Route } from 'react-router-dom'
import { View } from 'react-native'
import { AuthProvider } from '@/hooks/useAuth'
import { ADMIN_ROUTES } from './routes'
import { Placeholder } from './Placeholder'

export function App() {
  return (
    <SwiThemeProvider>
      <AuthProvider>
        <View testID="app-root">
          <Routes>
            {ADMIN_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<Placeholder label={r.label} />}
              />
            ))}
          </Routes>
        </View>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
```

**Step 6: Run all tests (must pass)**

```bash
npm test
```

Expected: PASS — 32 routing tests + earlier ones.

**Step 7: Commit**

```bash
git add swi-admin/src/app
git commit -m "feat(admin): router with 32 placeholder routes covering S1-S5 screens"
```

---

## Task 11: Walking-skeleton dev-server smoke

**Step 1: Run dev server**

```bash
cd swi-admin
npm run dev
```

Expected: Vite serves on `http://localhost:5173`. Visiting `/`, `/login`, `/employees`, `/maps/heat` shows "Em construção: <label>".

**Step 2: Stop server, run build**

```bash
npm run build
```

Expected: `dist/` produced; no TS errors.

**Step 3: No commit — verification only.**

---

## Task 12: ESLint + Prettier

**Files:**
- Create: `$REPO/swi-admin/eslint.config.js`
- Create: `$REPO/swi-admin/.prettierrc`

**Step 1: Write ESLint flat config**

```js
// eslint.config.js
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
    settings: { react: { version: '18.3' } },
  },
]
```

**Step 2: Write Prettier config**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

**Step 3: Run lint**

```bash
npm run lint
```

Expected: zero errors. Fix any auto-flagged issues.

**Step 4: Commit**

```bash
git add swi-admin/eslint.config.js swi-admin/.prettierrc
git commit -m "chore(admin): eslint flat config and prettier"
```

---

## Task 13: Storybook 9 setup with one smoke story

**Files:**
- Create: `$REPO/swi-admin/.storybook/main.ts`
- Create: `$REPO/swi-admin/.storybook/preview.tsx`
- Create: `$REPO/swi-admin/src/app/Placeholder.stories.tsx`

**Step 1: Write `.storybook/main.ts`**

```ts
import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
}

export default config
```

**Step 2: Write `.storybook/preview.tsx`**

```tsx
import type { Preview } from '@storybook/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'

const preview: Preview = {
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <Story />
      </SwiThemeProvider>
    ),
  ],
}

export default preview
```

**Step 3: Write smoke story**

```tsx
// src/app/Placeholder.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Placeholder } from './Placeholder'

const meta: Meta<typeof Placeholder> = {
  title: 'App/Placeholder',
  component: Placeholder,
}

export default meta

export const Default: StoryObj<typeof Placeholder> = {
  args: { label: 'sample-screen' },
}
```

**Step 4: Run Storybook**

```bash
npm run storybook
```

Expected: opens on `:6007`, story renders "Em construção: sample-screen".

**Step 5: Build Storybook**

```bash
npm run storybook:build
```

Expected: `storybook-static/` produced.

**Step 6: Commit**

```bash
git add swi-admin/.storybook swi-admin/src/app/Placeholder.stories.tsx
git commit -m "chore(admin): storybook 9 with theme provider and smoke story"
```

---

## Task 14: GitHub Actions CI

**Files:**
- Create: `$REPO/.github/workflows/ci.yml`

**Step 1: Write workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  admin:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: swi-admin
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: swi-admin/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npm run storybook:build
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck, lint, test, build, storybook on push and PR"
```

**Step 3: Push and verify on GitHub** — see Task 16.

---

## Task 15: Vercel deploy config

**Files:**
- Create: `$REPO/swi-admin/vercel.json`

**Step 1: Write config**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Step 2: Commit**

```bash
git add swi-admin/vercel.json
git commit -m "chore(admin): vercel SPA config with rewrites"
```

**Step 3: Manual step (operator)** — Run `npx vercel link` inside `swi-admin/` and `npx vercel --prod` for first deploy. Document the URL in `README.md`.

---

## Task 16: Push to GitHub remote

**Step 1: Create empty repo `Kavicki-com/swi-admin` via the web UI** (manual action required).

**Step 2: Set remote and push**

```bash
cd C:/Users/Gabriel/Documents/SWI
git remote add origin https://github.com/Kavicki-com/swi-admin.git
git push -u origin main
```

Expected: GitHub Actions kicks off and goes green.

**Step 3: Confirm CI green on `main`** before tagging.

---

## Task 17: Tag `v0.0.1-scaffold` and update README

**Files:**
- Modify: `$REPO/README.md`

**Step 1: Update README**

```markdown
# SWI Admin

Web admin for SWI (employee field monitoring). Front-first MVP — see `docs/plans/2026-05-08-swi-admin-pipeline-design.md`.

## Status

- **S0 — scaffold:** complete (`v0.0.1-scaffold`)
- Vercel preview: <fill in URL>

## Local dev

\`\`\`bash
cd swi-admin
npm install
npm run dev          # http://localhost:5173
npm run storybook    # http://localhost:6007
npm test
npm run typecheck
npm run lint
npm run build
\`\`\`

## Architecture

- Vite + React + react-native-web (alias) + styled-components
- Design System: `@kavicki/swi-design-system` pinned by git tag
- Data layer: `src/services/mockApi/*` exposing Supabase-shaped contracts (`{ data, error, count? }`)
- Router: 32 placeholder routes covering S1–S5 screens

## What S0 delivered

- Project scaffold + TypeScript strict
- DS pinned and rendering inside `SwiThemeProvider`
- mockApi types + auth stub + sleep helper
- AuthProvider/useAuth wired to mockApi
- 32 placeholder routes, all reachable
- Vitest + ESLint + Prettier + Storybook 9 + Vercel + GitHub Actions CI
```

**Step 2: Tag**

```bash
git add README.md
git commit -m "docs: S0 scaffold complete; document state and stack"
git tag -a v0.0.1-scaffold -m "S0 scaffold complete"
git push --tags
git push
```

Expected: tag visible on GitHub, CI green on tagged commit.

---

## Done condition for S0

All true:

1. `cd swi-admin && npm test` → green
2. `npm run typecheck` → green
3. `npm run lint` → green
4. `npm run build` → succeeds, `dist/` produced
5. `npm run storybook:build` → `storybook-static/` produced
6. `npm run dev` → all 32 routes render placeholder
7. GitHub Actions green on `main`
8. Tag `v0.0.1-scaffold` pushed
9. Vercel preview URL documented in README

After this, ready for **S1 — auth + dashboard**, which gets its own plan doc when started.

---

## Notes for the executing engineer

- **Do not** add any business logic in S0 — placeholders only. Pages get real implementations sprint by sprint.
- **Do not** create local "temporary" components. If a page in S1+ needs a component the DS doesn't have, open a PR in `Kavicki-com/swi-design-system`, bump patch, update the dependency tag.
- The `mockApi` interface is the contract for the future Supabase migration — keep it Supabase-shaped (`{ data, error, count? }`) even when it's tempting to throw exceptions or return raw data.
- Tests are in `*.test.{ts,tsx}` next to source. Avoid a separate `tests/` folder.
- All commits go on `main` directly during S0. Branching strategy starts in S1.
