# Design — Fila de aprovação de colaboradores (swi-admin)

**Data:** 2026-07-22
**Fatia:** follow-up #1 do Passo 2 (ver `project_swi_admin_backend_roadmap` na memória / PR #44)
**Branch:** `feat/admin-fila-aprovacao` (empilhada em `feat/backend-admin-users`)

## Problema

Quem se cadastra pelo app mobile nasce `WORKER` / `approvalStatus=PENDING` e não entra no sistema até um admin aprovar. O backend já tem os endpoints (`GET /users/pending`, `POST /users/:id/approve|reject`), mas **nenhuma tela** consome — o admin não tem como aprovar ninguém pelo painel. (Admins criados via `signup-company` nascem `APPROVED`, então na prática a fila é de colaboradores.)

Não existe frame no Figma pra essa tela (confirmado no canvas Desktop `0:1`). Design definido em brainstorming com o usuário.

## Escopo

Fatia **frontend-only** — o backend está 100% pronto:
- `GET /users?role=WORKER&approvalStatus=PENDING` (endpoint do Passo 2, aceita os dois filtros) lista os pendentes.
- `POST /users/:id/approve` e `POST /users/:id/reject` (ADMIN) já existem e devolvem `{ id, approvalStatus }`.

Fora de escopo: aprovar admins (nascem APPROVED), motivo de rejeição, notificar o worker.

## Decisões (do brainstorming)

1. **Onde mora:** 3ª aba **"Pendentes"** na tela de Funcionários (`Cadastrados | Pendentes | Cadastrar`). Sem rota/sidebar nova — cabe onde os colaboradores já aparecem.
2. **Aprovar** age direto (verde). **Rejeitar** pede **confirmação** (rejeição vira REJECTED e tira o acesso). Ambos: toast + some da lista.
3. **Confirmação** = overlay inline composto de componentes DS (o DS não tem Modal primitivo; padrão do app é compor — ver `ResponsablesModal`). Sem rota nova. Não viola a regra de DS (composição de página, não reimplementação de primitivo).

## Arquitetura

### Dados (`services/api/users.ts`)
Três métodos novos no `usersApi`, reusando `apiFetch` + envelope `MockResponse`:
- `listPendingWorkers(): MockResponse<PendingUser[]>` → `GET /users?role=WORKER&approvalStatus=PENDING`, mapeia pro shape enxuto `PendingUser { id, name, email, requestedAt }` (`requestedAt` = `createdAt`).
- `approve(id): MockResponse<{ id; approvalStatus }>` → `POST /users/:id/approve`.
- `reject(id): MockResponse<{ id; approvalStatus }>` → `POST /users/:id/reject`.

`PendingUser` é shape próprio (não `Employee`): o pendente não tem perfil (sem avatar/idade/vitais), então um card enxuto evita placeholders vazios.

### UI (`pages/employees/EmployeesList.tsx`)
- Tabs passam a ter 3 valores: `cadastrados | pendentes | cadastrar`.
- `pendentes`: carrega `listPendingWorkers()` no mount da aba; renderiza `PendingRow` por item.
  - `PendingRow`: container de linha DS (surface.standard, radius.m) — esquerda: nome (bold) + email + "Solicitado em DD/MM/AAAA"; direita: `Button` "Aprovar" (contained, surface.primary) + `Button` "Rejeitar" (outlined/danger).
  - Rótulo da aba mostra contagem: `Pendentes (N)`.
- **Aprovar:** chama `approve(id)`; sucesso → remove a linha (otimista) + toast "Cadastro aprovado". Falha → linha permanece + toast de erro.
- **Rejeitar:** abre `ConfirmReject` (overlay inline) com nome; confirmar → `reject(id)` → remove + toast; cancelar → fecha. Falha → permanece + toast de erro.
- **Empty state:** "Nenhum cadastro pendente".

### ConfirmReject (composição DS, dentro da página)
`View` overlay centralizado (fundo escurecido) com `Title` ("Rejeitar cadastro?"), `Text` ("{nome} não terá acesso ao sistema."), e dois `Button`: "Cancelar" (outlined) + "Rejeitar" (contained, surface.error). Sem rota; render condicional por estado local (`rejecting: PendingUser | null`).

## Fluxo de erro
- Toda ação de escrita é **otimista com rollback**: remove a linha na hora, e se o POST falhar, recoloca + toast de erro (o `apiFetch` já converte tudo em `ApiError`; o envelope traz `{ data:null, error }`).
- Lista com erro de carregamento → estado vazio + mensagem (sem UI de retry dedicada nesta fatia; consistente com as outras abas).

## Testes (TDD)
**Client (`api/users.test.ts`):**
- `listPendingWorkers()` bate em `/users?role=WORKER&approvalStatus=PENDING` e mapeia `createdAt→requestedAt`.
- `approve(id)` / `reject(id)` fazem `POST` no id certo; sucesso devolve `{id, approvalStatus}`; erro → `{ data:null, error }`.

**Página (`EmployeesList.test.tsx` ou novo `pendentes` test):**
- Aba "Pendentes" renderiza os pendentes retornados.
- Aprovar remove a linha da lista.
- Rejeitar abre a confirmação; só remove após confirmar; cancelar mantém.

Verde exigido: vitest + `tsc` + `vite build`. Verificação ao vivo (Playwright) contra o stack real: aprovar um pendente → some da aba e aparece em Cadastrados.

## Não-objetivos
- Sem paginação da fila (volume baixo; a lista de pendentes é curta).
- Sem motivo de rejeição / e-mail ao worker (follow-up separado se o cliente pedir).
