# Fila de aprovação de colaboradores — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar uma aba "Pendentes" na tela de Funcionários do swi-admin que lista colaboradores `PENDING` e permite aprovar (direto) ou rejeitar (com confirmação), contra o backend real.

**Architecture:** Frontend-only — o backend já expõe `GET /users?role=WORKER&approvalStatus=PENDING` e `POST /users/:id/approve|reject`. Estende `services/api/users.ts` (envelope `MockResponse`, igual ao resto da fatia) e a página `EmployeesList.tsx` (3ª aba + overlay de confirmação composto de DS). Sem backend, sem rota, sem sidebar nova.

**Tech Stack:** React + react-native-web, Vitest (globals), `@kavicki/swi-design-system`, `apiFetch` (`services/api/http.ts`).

**Ref design:** `docs/plans/2026-07-22-swi-admin-fila-aprovacao-design.md`

**cwd das ferramentas:** `mobile/`; swi-admin fica em `../swi-admin`. Comandos de teste: `cd ../swi-admin && npx vitest run <arquivo>`.

---

### Task 1: `usersApi.listPendingWorkers()`

**Files:**
- Test: `swi-admin/src/services/api/users.test.ts` (append)
- Modify: `swi-admin/src/services/api/users.ts`

**Step 1: Write the failing test**

```ts
describe('usersApi.listPendingWorkers (real)', () => {
  it('GET /users?role=WORKER&approvalStatus=PENDING e mapeia createdAt→requestedAt', async () => {
    const f = okJson([summary({ approvalStatus: 'PENDING', createdAt: '2026-07-10T00:00:00.000Z' })])
    vi.stubGlobal('fetch', f)
    const { data, error } = await usersApi.listPendingWorkers()
    expect(error).toBeNull()
    expect(data![0]!).toEqual({
      id: 'u1', name: 'Worker Um', email: 'w1@x.com', requestedAt: '2026-07-10T00:00:00.000Z',
    })
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users?role=WORKER&approvalStatus=PENDING')
  })
})
```

Nota: `usersApi` ainda não é exportado como objeto único — hoje há `employeesApi`/`adminsApi`. Decisão: adicionar `export const usersApi = { listPendingWorkers, approve, reject }` novo (não mexe nos existentes). Importar `usersApi` no topo do teste.

**Step 2: Run test to verify it fails**

Run: `cd ../swi-admin && npx vitest run src/services/api/users.test.ts`
Expected: FAIL — `usersApi` is not exported / undefined.

**Step 3: Write minimal implementation** (`services/api/users.ts`)

```ts
export type PendingUser = { id: string; name: string; email: string; requestedAt: string }

const toPending = (u: UserSummaryDto): PendingUser => ({
  id: u.id, name: u.name, email: u.email, requestedAt: u.createdAt,
})

export const usersApi = {
  listPendingWorkers: (): Promise<MockResponse<PendingUser[]>> =>
    (async () => {
      try {
        const users = await apiFetch<UserSummaryDto[]>('/users?role=WORKER&approvalStatus=PENDING')
        return { data: users.map(toPending), error: null }
      } catch (e) {
        return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
      }
    })(),
  // approve/reject na Task 2
}
```

**Step 4: Run test to verify it passes** — Expected: PASS.

**Step 5: Commit**

```bash
git add swi-admin/src/services/api/users.ts swi-admin/src/services/api/users.test.ts
git commit -m "feat(admin): usersApi.listPendingWorkers contra /users PENDING"
```

---

### Task 2: `usersApi.approve()` / `usersApi.reject()`

**Files:** mesmos da Task 1.

**Step 1: Write the failing tests**

```ts
describe('usersApi.approve/reject (real)', () => {
  it('approve() faz POST /users/:id/approve', async () => {
    const f = okJson({ id: 'u1', approvalStatus: 'APPROVED' })
    vi.stubGlobal('fetch', f)
    const { data, error } = await usersApi.approve('u1')
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'u1', approvalStatus: 'APPROVED' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/u1/approve')
    expect(init.method).toBe('POST')
  })
  it('reject() faz POST /users/:id/reject', async () => {
    const f = okJson({ id: 'u1', approvalStatus: 'REJECTED' })
    vi.stubGlobal('fetch', f)
    const { data } = await usersApi.reject('u1')
    expect(data?.approvalStatus).toBe('REJECTED')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/u1/reject')
    expect(init.method).toBe('POST')
  })
  it('erro no approve → { data:null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await usersApi.approve('u1')
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
```

**Step 2: Run — FAIL** (`approve`/`reject` não existem).

**Step 3: Implement**

```ts
type ApprovalResult = { id: string; approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }

const postAction = (id: string, action: 'approve' | 'reject') =>
  (async (): Promise<MockResponse<ApprovalResult>> => {
    try {
      const r = await apiFetch<ApprovalResult>(`/users/${id}/${action}`, { method: 'POST' })
      return { data: r, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha na ação') } }
    }
  })()

// dentro de usersApi:
approve: (id: string) => postAction(id, 'approve'),
reject: (id: string) => postAction(id, 'reject'),
```

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(admin): usersApi.approve/reject`

---

### Task 3: aba "Pendentes" renderiza os pendentes

**Files:**
- Test: `swi-admin/src/pages/employees/EmployeesList.test.tsx` (expandir além do smoke)
- Modify: `swi-admin/src/pages/employees/EmployeesList.tsx`

**Step 1: Write the failing test**

```tsx
import { vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { EmployeesList } from './EmployeesList'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { usersApi } from '@/services/api/users'

afterEach(clearSession)

it('aba Pendentes lista os colaboradores PENDING', async () => {
  vi.spyOn(usersApi, 'listPendingWorkers').mockResolvedValue({
    data: [{ id: 'p1', name: 'Novo Worker', email: 'novo@x.com', requestedAt: '2026-07-10T00:00:00.000Z' }],
    error: null,
  })
  renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
  await waitFor(() => expect(screen.getByText('Novo Worker')).toBeTruthy())
  expect(screen.getByText('novo@x.com')).toBeTruthy()
})
```

Nota: o `initialTab` hoje aceita `'cadastrados' | 'cadastrar'` — ampliar o union pra incluir `'pendentes'`.

**Step 2: Run — FAIL** (aba não existe; `pendentes` não é valor de tab válido).

**Step 3: Implement** (`EmployeesList.tsx`)
- Ampliar `initialTab` union → `'cadastrados' | 'pendentes' | 'cadastrar'`.
- Adicionar `{ value: 'pendentes', label: pendentes.length ? \`Pendentes (${pendentes.length})\` : 'Pendentes' }` no meio das Tabs.
- Estado `const [pendentes, setPendentes] = useState<PendingUser[]>([])`.
- `useEffect` que, quando `tab === 'pendentes'`, chama `usersApi.listPendingWorkers().then(({data}) => data && setPendentes([...data]))`.
- Bloco de render `tab === 'pendentes'`: mapeia `PendingRow` (ver Task 4) ou empty state "Nenhum cadastro pendente".

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(admin): aba Pendentes na tela de Funcionários`

---

### Task 4: `PendingRow` + aprovar (otimista)

**Files:** `EmployeesList.tsx`, `EmployeesList.test.tsx`.

**Step 1: Write the failing test**

```tsx
it('aprovar remove o pendente da lista', async () => {
  vi.spyOn(usersApi, 'listPendingWorkers').mockResolvedValue({
    data: [{ id: 'p1', name: 'Novo Worker', email: 'novo@x.com', requestedAt: '2026-07-10T00:00:00.000Z' }],
    error: null,
  })
  const approve = vi.spyOn(usersApi, 'approve').mockResolvedValue({ data: { id: 'p1', approvalStatus: 'APPROVED' }, error: null })
  const { user } = renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
  await waitFor(() => screen.getByText('Novo Worker'))
  await user.click(screen.getByRole('button', { name: /aprovar novo worker/i }))
  expect(approve).toHaveBeenCalledWith('p1')
  await waitFor(() => expect(screen.queryByText('Novo Worker')).toBeNull())
})
```

Nota: verificar como `renderPage` expõe `user` (userEvent). Se não expõe, importar `userEvent` de `@testing-library/user-event` e `userEvent.setup()`.

**Step 2: Run — FAIL** (sem botão Aprovar).

**Step 3: Implement** `PendingRow` (composição DS):
- Container `View` (surface.standard, radius.m, padding) — igual ao `EmployeeRow`, sem avatar/vitais.
- Esquerda: `Text` nome (bold) + `Text` email + `Text` "Solicitado em {DD/MM/AAAA}" (formatar `requestedAt` com `Intl.DateTimeFormat('pt-BR')`).
- Direita: `Button` label="Aprovar" (variant contained, backgroundColor `theme.surface.primary`, accessibilityLabel `Aprovar {nome}`) + `Button` label="Rejeitar" (variant outlined, accessibilityLabel `Rejeitar {nome}`).
- `handleApprove(p)`: remove otimista (`setPendentes(prev => prev.filter(x => x.id !== p.id))`), `usersApi.approve(p.id)`, sucesso → `showToast('Cadastro aprovado', ...)`; erro → recoloca + `showToast('Erro', msg)`.

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(admin): PendingRow + aprovar otimista`

---

### Task 5: rejeitar com confirmação (`ConfirmReject`)

**Files:** `EmployeesList.tsx`, `EmployeesList.test.tsx`.

**Step 1: Write the failing tests**

```tsx
it('rejeitar só remove após confirmar; cancelar mantém', async () => {
  vi.spyOn(usersApi, 'listPendingWorkers').mockResolvedValue({
    data: [{ id: 'p1', name: 'Novo Worker', email: 'novo@x.com', requestedAt: '2026-07-10T00:00:00.000Z' }],
    error: null,
  })
  const reject = vi.spyOn(usersApi, 'reject').mockResolvedValue({ data: { id: 'p1', approvalStatus: 'REJECTED' }, error: null })
  const { user } = renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
  await waitFor(() => screen.getByText('Novo Worker'))
  await user.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
  // overlay de confirmação apareceu
  expect(screen.getByText('Rejeitar cadastro?')).toBeTruthy()
  // cancelar mantém
  await user.click(screen.getByRole('button', { name: /cancelar/i }))
  expect(reject).not.toHaveBeenCalled()
  expect(screen.getByText('Novo Worker')).toBeTruthy()
  // rejeitar de novo → confirmar remove
  await user.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
  await user.click(screen.getByRole('button', { name: /^rejeitar$/i })) // botão de confirmação do overlay
  expect(reject).toHaveBeenCalledWith('p1')
  await waitFor(() => expect(screen.queryByText('Novo Worker')).toBeNull())
})
```

**Step 2: Run — FAIL** (sem overlay).

**Step 3: Implement**
- Estado `const [rejecting, setRejecting] = useState<PendingUser | null>(null)`.
- Botão "Rejeitar" do row → `setRejecting(p)`.
- `ConfirmReject` (render condicional quando `rejecting`): `View` overlay (position absolute, inset 0, fundo `rgba(0,0,0,0.5)`, center) → cartão `View` (surface.standard, radius.m, padding, maxWidth ~420) com `Title` "Rejeitar cadastro?", `Text` `{rejecting.name} não terá acesso ao sistema.`, e linha de `Button` "Cancelar" (outlined → `setRejecting(null)`) + "Rejeitar" (contained, `theme.surface.error` → `handleReject(rejecting)`).
- `handleReject(p)`: `setRejecting(null)`, remove otimista, `usersApi.reject(p.id)`, toast; erro → recoloca + toast.

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(admin): rejeitar com confirmação (ConfirmReject)`

---

### Task 6: gate verde + verificação ao vivo

**Step 1:** `cd ../swi-admin && npx tsc --noEmit` → EXIT 0.
**Step 2:** `npx vitest run` → todos verdes.
**Step 3:** `npx vite build` → EXIT 0.
**Step 4:** Playwright contra o stack real: login admin → /employees → aba "Pendentes". (Precisa de ao menos 1 worker PENDING no seed; se não houver, criar via signup mobile ou setar `approvalStatus=PENDING` num worker de teste via prisma.) Aprovar → some da aba e aparece em "Cadastrados". Rejeitar outro → confirma → some. 0 erros de console. Screenshot.
**Step 5: Commit** (se houver ajustes) e parar pra revisão/PR.

---

## Riscos / notas
- **Seed sem PENDING:** todos os workers do seed estão `APPROVED`. Pra ver a aba com dado, criar um PENDING (mobile signup real, ou `UPDATE "User" SET "approvalStatus"='PENDING'` num worker de teste no db 5433). Não commitar mudança de seed sem pedir.
- **`renderPage`/userEvent:** confirmar a API do `test-utils/renderPage` (se retorna `user`); ajustar imports se necessário.
- **Regra DS:** `ConfirmReject` é composição de página (Button/Title/Text/View) — permitido. NÃO criar um "Modal" local que reimplemente um primitivo.
- **`services/api/users.ts`:** já tocado pela PR #44; esta fatia empilha em cima (branch `feat/admin-fila-aprovacao`).
