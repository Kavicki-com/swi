# SWI Admin — Tarefas (UI) + integração real — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar as 4 telas de Tarefas do painel admin consumindo a API real `/work-orders`, e com isso estabelecer a primeira integração de verdade entre o `swi-admin` e o backend Nest (client HTTP + login real).

**Architecture:** Uma camada `src/services/api/` nova (fetch + JWT + política de erro) que os domínios futuros vão reusar; `services/auth.ts` troca o mock pelo backend real preservando o envelope `{ data, error }` que o `useAuth` já consome; páginas novas em `src/pages/tasks/` seguindo a estrutura das páginas de Relatórios; modal de responsáveis como overlay local do form (o modal-rota de Relatórios fica intocado).

**Tech Stack:** React 18 + Vite + React Router + react-native-web, `@kavicki/swi-design-system` 0.1.114 (regra: componentes DS como estão, tokens só via `useTheme()`), Vitest + Testing Library, backend NestJS + Prisma em Docker.

**Design doc:** `docs/plans/2026-07-21-swi-admin-tarefas-integracao-design.md`

**Convenções desta rodada:**
- Commits **só com luz verde explícita** do usuário (regra do projeto). Os passos "Commit" abaixo indicam o ponto de corte lógico; agrupamos e pedimos autorização.
- **Sem rastros de IA** em mensagens de commit/PR.
- `mobile/eas.json` **nunca** entra em `git add` (guarda URL ngrok local).
- Uma branch não toca `swi-admin/` e `mobile/` ao mesmo tempo.

---

## Fase 0 — Pré-requisitos no backend (branch e PR próprios)

Branch: `fix/backend-admin-integration-prereqs` (de `main`). **Mergear antes da Fase 1.**

### Task 0.1: CORS no HTTP

**Files:**
- Modify: `swi-backend/src/main.ts`
- Test: `swi-backend/test/cors.e2e-spec.ts` (criar)

**Step 1: Write the failing test**

```ts
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'

describe('CORS (e2e)', () => {
  let app: INestApplication
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.enableCors({ origin: ['http://localhost:5173'] })
    await app.init()
  })
  afterAll(async () => { await app.close() })

  it('responde preflight do origin permitido', async () => {
    const res = await request(app.getHttpServer())
      .options('/work-orders')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('não devolve allow-origin pra origin não listada', async () => {
    const res = await request(app.getHttpServer())
      .options('/work-orders')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-backend && npx jest --config test/jest-e2e.json cors`
Expected: FAIL — sem header `access-control-allow-origin` (o app real ainda não habilita CORS).

**Step 3: Write minimal implementation**

Em `swi-backend/src/main.ts`, dentro de `bootstrap()`, antes do `listen`:

```ts
  // O swi-admin (browser) chama esta API cross-origin. Origins por env pra que
  // dev (vite 5173) e o futuro domínio de produção convivam sem rebuild.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  app.enableCors({ origin: origins, credentials: false })
```

**Step 4: Run test to verify it passes**

Run: `cd swi-backend && npx jest --config test/jest-e2e.json cors`
Expected: PASS (2 tests).

**Step 5: Documentar a env**

Adicionar `CORS_ORIGINS` ao `swi-backend/.env.example` e ao `environment` do serviço `api` em `swi-backend/docker-compose.yml`:
`CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:5173}`

---

### Task 0.2: `createdAt` no DTO de detalhe

**Files:**
- Modify: `swi-backend/src/work-orders/work-orders.service.ts` (`toDetailDto`, ~linha 247)
- Test: `swi-backend/src/work-orders/work-orders.service.spec.ts`

**Step 1: Write the failing test**

No `describe` do `get`/detalhe, adicionar:

```ts
  it('detalhe expõe createdAt (Data de criação do Figma 1613-10013)', async () => {
    const dto = await service.get('order-1')
    expect(dto.createdAt).toBe(orderRow().createdAt.toISOString())
  })
```

**Step 2: Run test to verify it fails**

Run: `cd swi-backend && npx jest work-orders.service`
Expected: FAIL — `dto.createdAt` é `undefined`.

**Step 3: Write minimal implementation**

Em `toDetailDto`, no objeto de retorno (junto de `startDate`/`dueDate`):

```ts
      createdAt: order.createdAt.toISOString(),
```

**Step 4: Run test to verify it passes**

Run: `cd swi-backend && npx jest work-orders.service`
Expected: PASS.

**Step 5: Gates + commit da Fase 0**

Run: `cd swi-backend && npm run build && npm test && npx jest --config test/jest-e2e.json`
Expected: build 0, unit ≥189, e2e ≥62.

Commit (após luz verde): `fix(backend): CORS configurável + createdAt no detalhe de work order`
PR próprio → mergear antes da Fase 1.

---

## Fase 1 — Fundação de integração (branch `feat/admin-tarefas`, de `main` pós-Fase 0)

### Task 1: Client HTTP

**Files:**
- Create: `swi-admin/src/services/api/http.ts`
- Test: `swi-admin/src/services/api/http.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, TOKEN_STORAGE_KEY } from './http'

const mockFetch = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('injeta o Bearer token quando há sessão', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders')

    const [, init] = f.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc')
  })

  it('omite o header quando não há sessão', async () => {
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders')

    const [, init] = f.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('propaga a mensagem de erro do Nest em ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'responsável inválido' }, 400))
    await expect(apiFetch('/work-orders', { method: 'POST' })).rejects.toThrow('responsável inválido')
  })

  it('401 limpa a sessão (token expirado não pode ficar preso)', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', mockFetch({ message: 'Unauthorized' }, 401))

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/services/api/http.test.ts`
Expected: FAIL — módulo `./http` não existe.

**Step 3: Write minimal implementation**

```ts
// Client HTTP único do swi-admin contra o backend Nest. Todos os domínios que
// migrarem do mock pro backend real passam por aqui — política de token e de
// erro fica em um lugar só.
export const TOKEN_STORAGE_KEY = 'swi.admin.token'
export const SESSION_STORAGE_KEY = 'swi.admin.session'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export const readToken = (): string | null => window.localStorage.getItem(TOKEN_STORAGE_KEY)

export const clearSession = (): void => {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  let body: unknown = null
  try { body = await res.json() } catch { /* 204 e afins */ }

  if (!res.ok) {
    // Token expirado/inválido: derruba a sessão local. O RequireAuth redireciona
    // pro login no próximo render — evita loop de request com credencial morta.
    if (res.status === 401) clearSession()
    const message =
      (body as { message?: string | string[] } | null)?.message ?? `Erro ${res.status}`
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status)
  }
  return body as T
}
```

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/services/api/http.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

`feat(admin): client HTTP com JWT e política de erro única`

---

### Task 2: Login real (só real — sem demo)

**Files:**
- Create: `swi-admin/src/services/api/auth.ts`, `swi-admin/src/services/api/auth.test.ts`
- Modify: `swi-admin/src/services/auth.ts`, `swi-admin/src/pages/auth/Login.tsx`, `swi-admin/src/app/RequireAuth.tsx`
- Delete: `swi-admin/src/components/DemoBanner.tsx` (e seu uso)

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authApi } from './auth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from './http'

// JWT sintético: header.payload.signature — só o payload importa (o backend
// assina de verdade; o client apenas lê a role pra barrar worker no painel).
const jwt = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/=/g, '')}.y`

const okLogin = (role: string) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      accessToken: jwt({ sub: 'u1', role }),
      user: { id: 'u1', email: 'admin@swi.local', name: 'Admin Demo' },
    }),
  } as Response)

afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals() })

describe('authApi.signIn (real)', () => {
  it('persiste token e sessão quando o usuário é ADMIN', async () => {
    vi.stubGlobal('fetch', okLogin('ADMIN'))
    const { data, error } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })
    expect(error).toBeNull()
    expect(data?.full_name).toBe('Admin Demo')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeTruthy()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeTruthy()
  })

  it('rejeita WORKER — o painel é só de administradores', async () => {
    vi.stubGlobal('fetch', okLogin('WORKER'))
    const { data, error } = await authApi.signIn({ email: 'worker@swi.local', password: 'worker123' })
    expect(data).toBeNull()
    expect(error?.message).toMatch(/administradores/i)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('credencial errada devolve erro sem persistir nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ message: 'Credenciais inválidas' }),
    } as Response))
    const { data, error } = await authApi.signIn({ email: 'a@b.c', password: 'x' })
    expect(data).toBeNull()
    expect(error?.message).toBe('Credenciais inválidas')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/services/api/auth.test.ts`
Expected: FAIL — módulo não existe.

**Step 3: Write minimal implementation**

`src/services/api/auth.ts` — mantém o envelope `{ data, error }` que o `useAuth` já consome, então o provider não muda:

```ts
import type { User } from '@/services/types'
import type { MockResponse } from '@/services/mockApi/types'
import { apiFetch, clearSession, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from './http'

type LoginResponse = {
  accessToken: string
  user: { id: string; email: string; name: string }
}

// Lê a role do payload do JWT. NÃO é validação de segurança (quem valida é o
// backend em toda rota) — serve pra barrar cedo um worker que tentou o painel,
// com mensagem clara em vez de 403 em cada tela.
const roleOf = (token: string): string => {
  try {
    return JSON.parse(atob(token.split('.')[1] ?? '')).role ?? ''
  } catch {
    return ''
  }
}

const toAdminUser = (u: LoginResponse['user']): User => ({
  id: u.id,
  org_id: '',
  email: u.email,
  full_name: u.name,
  role: 'admin',
  consent_given_at: null,
  created_at: new Date().toISOString(),
})

export const authApi = {
  signIn: async ({ email, password }: { email: string; password: string }): Promise<MockResponse<User>> => {
    try {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (roleOf(res.accessToken) !== 'ADMIN') {
        return { data: null, error: { message: 'Acesso restrito a administradores.' } }
      }
      const user = toAdminUser(res.user)
      window.localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken)
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
      return { data: user, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : 'Falha no login' } }
    }
  },

  signOut: async (): Promise<MockResponse<null>> => {
    clearSession()
    return { data: null, error: null }
  },

  getSession: async (): Promise<MockResponse<User | null>> => {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw || !window.localStorage.getItem(TOKEN_STORAGE_KEY)) return { data: null, error: null }
    try {
      return { data: JSON.parse(raw) as User, error: null }
    } catch {
      return { data: null, error: null }
    }
  },
}
```

`src/services/auth.ts` passa a exportar o real, preservando os re-exports de tipo que as telas de SignUp/Recovery ainda usam:

```ts
import { authApi as realAuthApi } from './api/auth'
import { authApi as mockAuthApi } from './mockApi/auth'
export * from './mockApi/auth'
// signIn/signOut/getSession são REAIS (backend Nest). signUp/reset seguem
// visuais até a próxima fatia de integração.
export const authApi = { ...mockAuthApi, ...realAuthApi }
```

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/services/api/auth.test.ts`
Expected: PASS (3 tests).

**Step 5: Remover o modo demo**

- `Login.tsx`: remover o `<Button label="Entrar como demo" …>` e o handler `onDemoLogin`.
- `RequireAuth.tsx`: remover `<DemoBanner />` e o import.
- Deletar `src/components/DemoBanner.tsx`.
- Ajustar `Login.test.tsx` e `useAuth.test.tsx` ao novo comportamento (mockando `services/auth`).

Run: `cd swi-admin && npx vitest run` → toda a suíte verde.

**Step 6: Commit**

`feat(admin): login real contra o backend (somente ADMIN) e fim do modo demo`

---

### Task 3: Client de work orders

**Files:**
- Create: `swi-admin/src/services/api/workOrders.ts`, `swi-admin/src/services/api/workOrders.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workOrdersApi } from './workOrders'

const stub = (body: unknown) => {
  const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)
  vi.stubGlobal('fetch', f)
  return f
}
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals() })

describe('workOrdersApi', () => {
  it('list filtra por status na query', async () => {
    const f = stub([])
    await workOrdersApi.list('in_progress')
    expect(f.mock.calls[0][0]).toContain('/work-orders?status=in_progress')
  })

  it('list sem status não manda query', async () => {
    const f = stub([])
    await workOrdersApi.list()
    expect(f.mock.calls[0][0]).toMatch(/\/work-orders$/)
  })

  it('create manda POST com o payload', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.create({ title: 'T', responsibleIds: ['w1'] })
    const [url, init] = f.mock.calls[0]
    expect(url).toMatch(/\/work-orders$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'T', responsibleIds: ['w1'] })
  })

  it('update manda PATCH no id', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.update('o1', { title: 'Novo' })
    const [url, init] = f.mock.calls[0]
    expect(url).toMatch(/\/work-orders\/o1$/)
    expect(init.method).toBe('PATCH')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/services/api/workOrders.test.ts`
Expected: FAIL — módulo não existe.

**Step 3: Write minimal implementation**

Tipos espelham os DTOs reais (`work-orders/dto.ts` + `toRowDto`/`toDetailDto`/`toWorkerDto`):

```ts
import { apiFetch } from './http'

export type WorkOrderStatus = 'pending' | 'in_progress' | 'done'

export type WorkOrderRow = {
  id: string
  title: string
  sector: string
  status: WorkOrderStatus
  progressPct: number
  responsibleCount: number
  responsibleAvatars: string[]
}

export type AssignableWorker = {
  id: string
  name: string
  jobTitle: string
  sector: string
  birthDate: string | null
  avatar: string
}

export type WorkOrderItem = {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'paused' | 'done'
}

export type WorkOrderDetail = {
  id: string
  title: string
  summary: string
  details: string
  sector: string
  estimatedMinutes: number | null
  startDate: string | null
  dueDate: string | null
  createdAt: string
  status: WorkOrderStatus
  progressPct: number
  author: { name: string; avatar: string }
  responsibles: AssignableWorker[]
  items: WorkOrderItem[]
  images: string[]
}

export type WorkOrderItemInput = { id?: string; title: string; description?: string }

export type WorkOrderInput = {
  title: string
  summary?: string
  details?: string
  sector?: string
  estimatedMinutes?: number
  startDate?: string
  dueDate?: string
  responsibleIds: string[]
  imageKeys?: string[]
  items?: WorkOrderItemInput[]
}

export const workOrdersApi = {
  list: (status?: WorkOrderStatus) =>
    apiFetch<WorkOrderRow[]>(`/work-orders${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<WorkOrderDetail>(`/work-orders/${id}`),
  create: (input: WorkOrderInput) =>
    apiFetch<WorkOrderDetail>('/work-orders', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<WorkOrderInput>) =>
    apiFetch<WorkOrderDetail>(`/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  assignable: () => apiFetch<AssignableWorker[]>('/work-orders/assignable'),
}
```

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/services/api/workOrders.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

`feat(admin): client de work orders`

---

### Task 4: Upload de anexo (presign + POST)

**Files:**
- Create: `swi-admin/src/services/api/upload.ts`, `swi-admin/src/services/api/upload.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadOrderImage } from './upload'

afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals() })

describe('uploadOrderImage', () => {
  it('presigna, sobe com o file por último e devolve a key', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({
        url: 'http://minio/bucket',
        fields: { key: 'order/uuid.jpg', 'Content-Type': 'image/jpeg' },
        key: 'order/uuid.jpg',
      }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)

    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    const key = await uploadOrderImage(file)

    expect(key).toBe('order/uuid.jpg')
    const form = f.mock.calls[1][1].body as FormData
    // O S3 exige que o campo `file` seja o ÚLTIMO do multipart.
    expect([...form.keys()].pop()).toBe('file')
  })

  it('recusa tipo fora de JPG/PNG antes de chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await expect(uploadOrderImage(file)).rejects.toThrow(/JPG ou PNG/i)
    expect(f).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/services/api/upload.test.ts`
Expected: FAIL — módulo não existe.

**Step 3: Write minimal implementation**

```ts
import { apiFetch } from './http'

type Presign = { url: string; fields: Record<string, string>; key: string }

const ALLOWED = ['image/jpeg', 'image/png']

// Sobe um anexo da tarefa: presign no backend → POST multipart direto no
// S3/MinIO. O backend impõe tamanho e tipo na policy do presign; a checagem
// daqui só evita uma ida à rede com arquivo obviamente inválido.
export async function uploadOrderImage(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Selecione arquivos do tipo: JPG ou PNG')

  const presign = await apiFetch<Presign>('/media/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, prefix: 'order' }),
  })

  const form = new FormData()
  for (const [k, v] of Object.entries(presign.fields)) form.append(k, v)
  form.append('file', file) // por último — requisito do S3 POST

  const res = await fetch(presign.url, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Falha ao enviar o arquivo')
  return presign.key
}
```

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/services/api/upload.test.ts`
Expected: PASS (2 tests).

**Step 5: Commit**

`feat(admin): upload de anexo de tarefa via presigned POST`

---

## Fase 2 — Telas

### Task 5: Navegação e rotas

**Files:**
- Modify: `swi-admin/src/app/nav.ts`, `swi-admin/src/app/App.tsx`
- Test: `swi-admin/src/app/nav.test.ts` (criar)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './nav'

describe('NAV_ITEMS', () => {
  it('tem Tarefas apontando pra /tasks', () => {
    const tarefas = NAV_ITEMS.find((i) => i.label === 'Tarefas')
    expect(tarefas?.value).toBe('/tasks')
  })

  it('Configurações continua sendo o último item (Figma)', () => {
    expect(NAV_ITEMS[NAV_ITEMS.length - 1]?.label).toBe('Configurações')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/app/nav.test.ts`
Expected: FAIL — não existe item "Tarefas".

**Step 3: Write minimal implementation**

Em `nav.ts`, inserir **antes** de Configurações (ordem do Figma 1606-11583):

```ts
  { value: '/tasks', label: 'Tarefas', icon: 'assignment' },
```

Em `App.tsx`, dentro do bloco `<Route element={<AppLayout />}>`:

```tsx
                  <Route path="/tasks" element={<TasksList />} />
                  <Route path="/tasks/new" element={<TaskForm />} />
                  <Route path="/tasks/:id" element={<TaskDetails />} />
                  <Route path="/tasks/:id/edit" element={<TaskForm />} />
```

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/app/nav.test.ts`
Expected: PASS. (As rotas ficam vermelhas até as páginas existirem — criar stubs mínimos que renderizam o título, substituídos nas tasks seguintes.)

**Step 5: Commit**

`feat(admin): item Tarefas na navegação e rotas`

---

### Task 6: Lista de tarefas

**Files:**
- Create: `swi-admin/src/pages/tasks/TasksList.tsx`, `swi-admin/src/pages/tasks/TasksList.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TasksList } from './TasksList'

vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: { list: vi.fn() },
}))
import { workOrdersApi } from '@/services/api/workOrders'

const row = (over = {}) => ({
  id: 'o1', title: 'Reparo', sector: 'Setor Leste', status: 'in_progress',
  progressPct: 40, responsibleCount: 2, responsibleAvatars: ['', ''], ...over,
})

beforeEach(() => vi.mocked(workOrdersApi.list).mockResolvedValue([row()]))

const renderList = () => render(<MemoryRouter><TasksList /></MemoryRouter>)

describe('TasksList', () => {
  it('abre em Em Andamento e busca esse status', async () => {
    renderList()
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenCalledWith('in_progress'))
    expect(await screen.findByText('Reparo')).toBeInTheDocument()
  })

  it('trocar de aba refaz a busca com o status da aba', async () => {
    renderList()
    await screen.findByText('Reparo')
    await userEvent.click(screen.getByText('Concluídas'))
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenCalledWith('done'))
  })

  it('busca filtra por título no cliente', async () => {
    vi.mocked(workOrdersApi.list).mockResolvedValue([row(), row({ id: 'o2', title: 'Alocação' })])
    renderList()
    await screen.findByText('Alocação')
    await userEvent.type(screen.getByPlaceholderText('Pesquisar tarefa'), 'Reparo')
    await waitFor(() => expect(screen.queryByText('Alocação')).not.toBeInTheDocument())
    expect(screen.getByText('Reparo')).toBeInTheDocument()
  })

  it('mostra estado vazio quando a aba não tem tarefas', async () => {
    vi.mocked(workOrdersApi.list).mockResolvedValue([])
    renderList()
    expect(await screen.findByText(/nenhuma tarefa/i)).toBeInTheDocument()
  })

  it('mostra o erro quando a API falha', async () => {
    vi.mocked(workOrdersApi.list).mockRejectedValue(new Error('backend fora do ar'))
    renderList()
    expect(await screen.findByText(/backend fora do ar/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TasksList.test.tsx`
Expected: FAIL — página não existe.

**Step 3: Write minimal implementation**

Página com: `SearchInput` (placeholder "Pesquisar tarefa"), botão "Nova Tarefa" → `/tasks/new`, título "Atividades em andamento", 3 abas (`A Fazer`/`Em Andamento`/`Concluídas` → `pending`/`in_progress`/`done`, default `in_progress`), e uma linha por tarefa com ícone `build`, título + setor, `ProgressBar` com `progressPct`, cluster de avatares (+N a partir de `responsibleCount`) e ícone de pino que navega pro mapa do setor. Componentes DS + `useTheme()`; nada hardcoded. Estados de loading, vazio e erro.

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TasksList.test.tsx`
Expected: PASS (5 tests).

**Step 5: Commit**

`feat(admin): lista de tarefas com abas por status`

---

### Task 7: Overlay de responsáveis

**Files:**
- Create: `swi-admin/src/pages/tasks/ResponsiblePicker.tsx`, `swi-admin/src/pages/tasks/ResponsiblePicker.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponsiblePicker } from './ResponsiblePicker'

vi.mock('@/services/api/workOrders', () => ({ workOrdersApi: { assignable: vi.fn() } }))
import { workOrdersApi } from '@/services/api/workOrders'

const worker = (id: string, name: string) => ({
  id, name, jobTitle: 'Técnico', sector: 'Setor Leste',
  birthDate: '1994-01-01T00:00:00.000Z', avatar: '',
})

beforeEach(() =>
  vi.mocked(workOrdersApi.assignable).mockResolvedValue([worker('w1', 'Elisa'), worker('w2', 'Mathias')]),
)

describe('ResponsiblePicker', () => {
  it('devolve os ids selecionados no Continuar', async () => {
    const onConfirm = vi.fn()
    render(<ResponsiblePicker selectedIds={[]} onConfirm={onConfirm} onCancel={() => {}} />)
    await screen.findByText('Elisa')
    await userEvent.click(screen.getAllByLabelText(/selecionar/i)[0])
    await userEvent.click(screen.getByText('Continuar'))
    expect(onConfirm).toHaveBeenCalledWith(['w1'])
  })

  it('pré-marca quem já é responsável', async () => {
    render(<ResponsiblePicker selectedIds={['w2']} onConfirm={() => {}} onCancel={() => {}} />)
    await screen.findByText('Mathias')
    expect(screen.getAllByLabelText(/selecionar/i)[1]).toBeChecked()
  })

  it('busca filtra por nome', async () => {
    render(<ResponsiblePicker selectedIds={[]} onConfirm={() => {}} onCancel={() => {}} />)
    await screen.findByText('Elisa')
    await userEvent.type(screen.getByPlaceholderText('Pesquisar'), 'Math')
    await waitFor(() => expect(screen.queryByText('Elisa')).not.toBeInTheDocument())
  })

  it('cancelar não confirma seleção', async () => {
    const onConfirm = vi.fn()
    render(<ResponsiblePicker selectedIds={[]} onConfirm={onConfirm} onCancel={vi.fn()} />)
    await screen.findByText('Elisa')
    await userEvent.click(screen.getAllByLabelText(/selecionar/i)[0])
    await userEvent.click(screen.getByText('Cancelar'))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/pages/tasks/ResponsiblePicker.test.tsx`
Expected: FAIL — componente não existe.

**Step 3: Write minimal implementation**

Overlay (não rota) com título "Selecionar responsáveis", subtítulo corrigido ("Atribua 1 ou mais responsáveis **à sua tarefa**…"), `SearchInput`, uma linha por worker (avatar, nome, idade calculada de `birthDate`, gota de tipo sanguíneo **decorativa**, `jobTitle` + `sector`) com checkbox, e os botões Cancelar/Continuar. Layout espelha o `ResponsablesModal` existente (mesmas medidas/divisor), mas com estado local e callbacks.

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/pages/tasks/ResponsiblePicker.test.tsx`
Expected: PASS (4 tests).

**Step 5: Commit**

`feat(admin): overlay de seleção de responsáveis`

---

### Task 8: Form de tarefa (criar e editar)

**Files:**
- Create: `swi-admin/src/pages/tasks/TaskForm.tsx`, `swi-admin/src/pages/tasks/TaskForm.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TaskForm } from './TaskForm'

vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: { create: vi.fn(), update: vi.fn(), get: vi.fn(), assignable: vi.fn() },
}))
vi.mock('@/services/api/upload', () => ({ uploadOrderImage: vi.fn() }))
import { workOrdersApi } from '@/services/api/workOrders'

const worker = { id: 'w1', name: 'Elisa', jobTitle: 'Técnico', sector: 'Leste', birthDate: null, avatar: '' }

beforeEach(() => {
  vi.mocked(workOrdersApi.assignable).mockResolvedValue([worker])
  vi.mocked(workOrdersApi.create).mockResolvedValue({ id: 'o1' } as never)
})

const renderNew = () =>
  render(<MemoryRouter initialEntries={['/tasks/new']}>
    <Routes><Route path="/tasks/new" element={<TaskForm />} /></Routes>
  </MemoryRouter>)

const pickResponsible = async () => {
  await userEvent.click(screen.getByText('Atribuir responsáveis'))
  await screen.findByText('Elisa')
  await userEvent.click(screen.getAllByLabelText(/selecionar/i)[0])
  await userEvent.click(screen.getByText('Continuar'))
}

describe('TaskForm (criação)', () => {
  it('exige título', async () => {
    renderNew()
    await pickResponsible()
    await userEvent.click(screen.getByText('Salvar tarefa'))
    expect(await screen.findByText(/título é obrigatório/i)).toBeInTheDocument()
    expect(workOrdersApi.create).not.toHaveBeenCalled()
  })

  it('exige ao menos um responsável', async () => {
    renderNew()
    await userEvent.type(screen.getByPlaceholderText('Título da tarefa'), 'Inspeção')
    await userEvent.click(screen.getByText('Salvar tarefa'))
    expect(await screen.findByText(/ao menos um responsável/i)).toBeInTheDocument()
    expect(workOrdersApi.create).not.toHaveBeenCalled()
  })

  it('cria sem checklist (toggle desligado) — backend gera o item automático', async () => {
    renderNew()
    await userEvent.type(screen.getByPlaceholderText('Título da tarefa'), 'Inspeção')
    await pickResponsible()
    await userEvent.click(screen.getByText('Salvar tarefa'))
    await waitFor(() => expect(workOrdersApi.create).toHaveBeenCalled())
    expect(vi.mocked(workOrdersApi.create).mock.calls[0][0]).toMatchObject({
      title: 'Inspeção', responsibleIds: ['w1'],
    })
    expect(vi.mocked(workOrdersApi.create).mock.calls[0][0].items).toBeUndefined()
  })

  it('cria com checklist quando o toggle está ligado', async () => {
    renderNew()
    await userEvent.type(screen.getByPlaceholderText('Título da tarefa'), 'Inspeção')
    await pickResponsible()
    await userEvent.click(screen.getByLabelText('Check List'))
    await userEvent.type(screen.getAllByPlaceholderText('Título')[0], 'Item 1')
    await userEvent.click(screen.getByText('Salvar tarefa'))
    await waitFor(() => expect(workOrdersApi.create).toHaveBeenCalled())
    expect(vi.mocked(workOrdersApi.create).mock.calls[0][0].items).toEqual([
      { title: 'Item 1', description: '' },
    ])
  })

  it('mostra o erro do backend sem perder o formulário', async () => {
    vi.mocked(workOrdersApi.create).mockRejectedValue(new Error('responsável inválido'))
    renderNew()
    await userEvent.type(screen.getByPlaceholderText('Título da tarefa'), 'Inspeção')
    await pickResponsible()
    await userEvent.click(screen.getByText('Salvar tarefa'))
    expect(await screen.findByText(/responsável inválido/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Título da tarefa')).toHaveValue('Inspeção')
  })
})

describe('TaskForm (edição)', () => {
  it('pré-carrega e manda PATCH com o id dos itens existentes', async () => {
    vi.mocked(workOrdersApi.get).mockResolvedValue({
      id: 'o1', title: 'Antiga', summary: '', details: '', sector: '', estimatedMinutes: null,
      startDate: null, dueDate: null, createdAt: '2026-01-01T00:00:00.000Z', status: 'pending',
      progressPct: 0, author: { name: 'A', avatar: '' }, responsibles: [worker],
      items: [{ id: 'i1', title: 'Item 1', description: 'd', status: 'pending' }], images: [],
    } as never)
    vi.mocked(workOrdersApi.update).mockResolvedValue({ id: 'o1' } as never)

    render(<MemoryRouter initialEntries={['/tasks/o1/edit']}>
      <Routes><Route path="/tasks/:id/edit" element={<TaskForm />} /></Routes>
    </MemoryRouter>)

    await waitFor(() => expect(screen.getByPlaceholderText('Título da tarefa')).toHaveValue('Antiga'))
    await userEvent.click(screen.getByText('Salvar tarefa'))
    await waitFor(() => expect(workOrdersApi.update).toHaveBeenCalled())
    const [, payload] = vi.mocked(workOrdersApi.update).mock.calls[0]
    expect(payload.items).toEqual([{ id: 'i1', title: 'Item 1', description: 'd' }])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TaskForm.test.tsx`
Expected: FAIL — página não existe.

**Step 3: Write minimal implementation**

Form com os campos do Figma (Setor, Tempo estimado, Data de início, Data de Conclusão, Título, Resumo, Detalhes), toggle "Check List" que revela a lista de itens `{Título, Texto curto}` com botão de adicionar, seção Anexos (JPG/PNG, `uploadOrderImage` por arquivo, preview + remover) e as ações Cancelar / **"Salvar tarefa"** (copy corrigida). Em `/tasks/:id/edit`, carrega com `get(id)` e submete `update(id, …)` mandando os itens existentes **com `id`**. Após sucesso, navega pro detalhe.

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TaskForm.test.tsx`
Expected: PASS (6 tests).

**Step 5: Commit**

`feat(admin): form de criação e edição de tarefa`

---

### Task 9: Detalhe da tarefa

**Files:**
- Create: `swi-admin/src/pages/tasks/TaskDetails.tsx`, `swi-admin/src/pages/tasks/TaskDetails.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TaskDetails } from './TaskDetails'

vi.mock('@/services/api/workOrders', () => ({ workOrdersApi: { get: vi.fn() } }))
import { workOrdersApi } from '@/services/api/workOrders'

const detail = (over = {}) => ({
  id: 'o1', title: 'Inspeção Técnica', summary: 'Checklist de manutenção',
  details: 'Detalhes longos', sector: 'Setor Noroeste', estimatedMinutes: 480,
  startDate: '2026-04-01T00:00:00.000Z', dueDate: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z', status: 'in_progress', progressPct: 33,
  author: { name: 'Alberto Alves', avatar: '' },
  responsibles: [{ id: 'w1', name: 'Mathias', jobTitle: 'Segurança', sector: 'Leste', birthDate: null, avatar: '' }],
  items: [
    { id: 'i1', title: 'Inspeção de Equipamentos', description: 'desc', status: 'done' },
    { id: 'i2', title: 'Manutenção', description: 'desc', status: 'pending' },
  ],
  images: ['http://minio/a.jpg'], ...over,
})

beforeEach(() => vi.mocked(workOrdersApi.get).mockResolvedValue(detail() as never))

const renderDetails = () =>
  render(<MemoryRouter initialEntries={['/tasks/o1']}>
    <Routes><Route path="/tasks/:id" element={<TaskDetails />} /></Routes>
  </MemoryRouter>)

describe('TaskDetails', () => {
  it('mostra título, autor e responsáveis', async () => {
    renderDetails()
    expect(await screen.findByText('Inspeção Técnica')).toBeInTheDocument()
    expect(screen.getByText('Alberto Alves')).toBeInTheDocument()
    expect(screen.getByText('Mathias')).toBeInTheDocument()
  })

  it('traduz o status pro rótulo do Figma', async () => {
    renderDetails()
    expect(await screen.findByText('Em andamento')).toBeInTheDocument()
  })

  it('marca no checklist só os itens concluídos', async () => {
    renderDetails()
    await screen.findByText('Inspeção de Equipamentos')
    expect(screen.getByTestId('task-item-i1')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('task-item-i2')).toHaveAttribute('data-done', 'false')
  })

  it('renderiza as imagens da tarefa', async () => {
    renderDetails()
    expect(await screen.findAllByRole('img')).not.toHaveLength(0)
  })

  it('mostra erro quando a tarefa não existe', async () => {
    vi.mocked(workOrdersApi.get).mockRejectedValue(new Error('Tarefa não encontrada'))
    renderDetails()
    expect(await screen.findByText(/não encontrada/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TaskDetails.test.tsx`
Expected: FAIL — página não existe.

**Step 3: Write minimal implementation**

Detalhe com chip de status (`pending`→"A fazer", `in_progress`→"Em andamento", `done`→"Concluída"), botão Editar → `/tasks/:id/edit`, data de criação, resumo, datas, autor, "Detalhes **da tarefa**:" (copy corrigida), cards de responsáveis com "Ver Todos", "Progresso da tarefa" (`ProgressBar`), Check List (radio preenchido quando `status === 'done'`, com `data-done` pro teste) e grade de Imagens.

**Step 4: Run test to verify it passes**

Run: `cd swi-admin && npx vitest run src/pages/tasks/TaskDetails.test.tsx`
Expected: PASS (5 tests).

**Step 5: Commit**

`feat(admin): detalhe da tarefa`

---

## Fase 3 — Verificação

### Task 10: Gates e fidelidade

**Step 1: Suíte completa**

Run: `cd swi-admin && npx vitest run`
Expected: todos os 43 suites antigos + os novos, verde.

**Step 2: Build de produção**

Run: `cd swi-admin && npm run build`
Expected: `tsc -b` limpo e `vite build` verde.

**Step 3: Fidelidade visual**

Com `npm run dev` e o backend de pé, comparar cada tela contra o Figma
(`1606-11583`, `1611-9071`, `1614-13773`, `1613-10013`) em 1366px: espaçamentos,
tipografia, cores (tudo via `useTheme()`), estados de hover/foco. Corrigir
divergências antes de considerar pronto. Se faltar glifo no DS, **bump com SVG
exportado do Figma** — nunca ícone improvisado.

**Step 4: Smoke real ponta a ponta**

Com o stack Docker no ar:
1. Login com `admin@swi.local` / `admin123` → entra no painel.
2. Login com `worker@swi.local` → **barrado** com "Acesso restrito a administradores".
3. Criar tarefa com checklist (2 itens) + 1 anexo JPG → aparece na aba "A Fazer".
4. No app mobile (ou via curl como worker), iniciar e concluir um item → recarregar
   a lista do admin: a tarefa migra pra "Em Andamento" com o progresso certo.
5. Abrir o detalhe: checklist com o item concluído marcado, imagem carregando.
6. Editar a tarefa (trocar título, adicionar item) → `PATCH` aplica sem perder os itens.

**Step 5: Review e PR**

Review holística do changeset (agentes paralelos, como na fatia backend), correção
do que aparecer, e então — **com luz verde explícita** — commits agrupados + PR.

---

## Riscos conhecidos

| Risco | Mitigação |
| --- | --- |
| Sessão só no `localStorage` | Aceito pro piloto (mesmo padrão do mock atual). Refresh token é frente futura. |
| Sem tela de edição no Figma | Reuso do form (Decisão 7); ajustar se o design entregar uma. |
| "Formação" não existe no backend | Exibe `sector` (Decisão 4); campo real é frente de cadastro. |
| Backend fora do ar quebra as telas | Estados de erro explícitos em toda página; `401` limpa a sessão e volta pro login. |
| Outras telas seguem mock atrás de login real | Consciente e documentado — a migração é por domínio. |
