# Ativar/desativar + excluir usuário — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Campo `active` no User (login barra inativos) + `PATCH /users/:id {active}` + `DELETE /users/:id` (com guarda de FK), e fiar o toggle/lixeira da tela de Admins; extrair um `ConfirmDialog` compartilhado.

**Architecture:** Backend (migração aditiva + login gate + setActive/remove + rotas) e frontend (client + AdminsList + ConfirmDialog compartilhado, com EmployeesList refatorado pra reusá-lo). UI só na tela de Admins.

**Tech Stack:** NestJS + Prisma + jest (backend); React + Vitest + `@kavicki/swi-design-system` (admin).

**Ref design:** `docs/plans/2026-07-22-swi-admin-user-lifecycle-design.md`

**Paths:** cwd = `mobile/`; backend em `../swi-backend`, admin em `../swi-admin`.

---

## Unidade A — Backend

### Task A1: migração + campo `active`
- Editar `swi-backend/prisma/schema.prisma`: no `model User`, adicionar `active Boolean @default(true)` (perto de `approvalStatus`).
- Rodar a migração contra o db do host (porta alt 5433): `cd ../swi-backend && DATABASE_URL="postgresql://swi:swi@localhost:5433/swi" npx prisma migrate dev --name add_user_active`. Confirmar que o SQL gerado é só o `ADD COLUMN ... DEFAULT true`. Regenera o client.
- Commit: `feat(backend): campo User.active (migração aditiva)`.

### Task A2: login barra inativos (TDD)
- **Files:** `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`.
- RED: no describe de `login` do spec, adicionar teste: usuário com `active:false` (mock do `findByEmail` retornando `{...verified, approvalStatus:'APPROVED', active:false, passwordHash}`) + senha correta → `rejects` `ForbiddenException`. (Ver os testes de login existentes pra o shape do mock e do `verifyHash`.)
- Run → FAIL.
- GREEN: em `login`, após o check de `approvalStatus`, `if (!u.active) throw new ForbiddenException({ reason:'INACTIVE', message:'Sua conta está desativada' })`.
- Run → PASS + suíte verde.
- Commit: `feat(backend): login barra usuário inativo`.

### Task A3: `UsersService.setActive` + `remove` (TDD)
- **Files:** `src/users/users.service.ts`, `users.service.spec.ts`.
- RED (append ao spec; o `prisma()` factory já tem findUnique/update/create — adicionar `delete: jest.fn()`, e mockar `$transaction`/`profile`):
```ts
describe('UsersService.setActive', () => {
  it('atualiza active', async () => {
    const db = prisma(); db.user.update.mockResolvedValue({ id:'u1', active:false })
    const r = await new UsersService(db, media()).setActive('u1', false)
    expect(db.user.update).toHaveBeenCalledWith({ where:{id:'u1'}, data:{active:false} })
    expect(r).toEqual({ id:'u1', active:false })
  })
})
describe('UsersService.remove', () => {
  it('excluir a si mesmo → BadRequest', async () => {
    await expect(new UsersService(prisma(), media()).remove('me','me')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('happy: apaga profile + user', async () => {
    const db = prisma()
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn:any) => fn(db))
    db.user.delete = jest.fn().mockResolvedValue({ id:'u1' })
    await new UsersService(db, media()).remove('u1','admin')
    expect(db.profile.deleteMany).toHaveBeenCalledWith({ where:{ userId:'u1' } })
    expect(db.user.delete).toHaveBeenCalledWith({ where:{ id:'u1' } })
  })
  it('FK vinculada (P2003) → Conflict', async () => {
    const db = prisma()
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn:any) => fn(db))
    db.user.delete = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code:'P2003', clientVersion:'x' }))
    await expect(new UsersService(db, media()).remove('u1','admin')).rejects.toBeInstanceOf(ConflictException)
  })
})
```
- GREEN:
  - `setActive(id, active)` → `const u = await this.prisma.user.update({ where:{id}, data:{active} }); return { id:u.id, active:u.active }`.
  - `remove(id, requesterId)`: `if (id===requesterId) throw new BadRequestException('não é possível excluir a si mesmo')`. `try { await this.prisma.$transaction(async (tx) => { await tx.profile.deleteMany({ where:{ userId:id } }); await tx.user.delete({ where:{ id } }) }) } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError) { if (e.code==='P2025') throw new NotFoundException('Usuário não encontrado'); if (e.code==='P2003') throw new ConflictException('Usuário possui registros vinculados; desative-o em vez de excluir') } throw e }`. Importar `Prisma`, `BadRequestException`, `ConflictException`.
- Run → PASS + suíte verde.
- Commit: `feat(backend): UsersService.setActive + remove (com guarda de FK)`.

### Task A4: rotas PATCH/DELETE
- **Files:** `src/users/dto.ts` (add `SetActiveDto { @IsBoolean() active }`), `src/users/users.controller.ts`.
- Controller (sem teste unitário, consistente com o módulo): `@Patch(':id') @Roles('ADMIN') setActive(@Param('id') id, @Body() dto: SetActiveDto) { return this.users.setActive(id, dto.active) }`; `@Delete(':id') @Roles('ADMIN') @HttpCode(204) remove(@Param('id') id, @CurrentUserId() requesterId) { return this.users.remove(id, requesterId) }`. Importar `Patch`, `Delete`, `HttpCode` do `@nestjs/common`. Os literais (`pending`) já vêm antes; GET/PATCH/DELETE `:id` coexistem por método.
- Run `npx tsc --noEmit` + `npx jest` (verde).
- Commit: `feat(backend): PATCH/DELETE /users/:id (ativar/excluir)`.

---

## Unidade B — Frontend

### Task B1: `ConfirmDialog` compartilhado + refactor da fila
- **Files:** `src/pages/_shared/ConfirmDialog.tsx` (novo), `src/pages/_shared/ConfirmDialog.test.tsx` (novo), `src/pages/employees/EmployeesList.tsx`.
- RED: teste do `ConfirmDialog` (confirmar chama onConfirm; cancelar/scrim/Escape chamam onCancel).
- GREEN: extrair o `ConfirmReject` inline do `EmployeesList` pra um componente `ConfirmDialog({ title, message, confirmLabel, confirmDanger, onConfirm, onCancel })` — mesma composição DS (overlay Pressable scrim + card Pressable aria-modal + Title + Text + Button Cancelar/confirm; Escape via useEffect keydown). Trocar o uso no `EmployeesList` (rejeição) por `<ConfirmDialog title="Rejeitar cadastro?" message={...} confirmLabel="Rejeitar" confirmDanger onConfirm=... onCancel=... />`. Rodar os testes da fila (`EmployeesList.test.tsx`) — devem continuar verdes (protegem o refactor).
- Commit: `refactor(admin): extrai ConfirmDialog compartilhado (fila reusa)`.

### Task B2: `adminsApi.setActive` / `adminsApi.remove`
- **Files:** `src/services/api/users.ts`, `users.test.ts`.
- RED: `setActive('a1', false)` → `PATCH /users/a1` body `{active:false}`; `remove('a1')` → `DELETE /users/a1` método DELETE; erro 409 → `{data:null,error}`.
- GREEN: adicionar ao `adminsApi`: `setActive: (id, active) => apiFetch<...>(\`/users/${id}\`, { method:'PATCH', body: JSON.stringify({ active }) })` no envelope; `remove: (id) => apiFetch(\`/users/${id}\`, { method:'DELETE' })` no envelope (DELETE 204 → apiFetch já trata corpo vazio). Tipar retorno adequado.
- Commit: `feat(admin): adminsApi.setActive/remove`.

### Task B3: fiar toggle + excluir no AdminsList
- **Files:** `src/pages/admins/AdminsList.tsx`, `AdminsList.test.tsx` (expandir além do smoke).
- RED: (spy em `adminsApi.setActive`/`remove`, dados mockados via `adminsApi.list`)
  - toggle chama `setActive(id, novoValor)`;
  - clicar excluir abre confirmação; confirmar chama `remove(id)` e a linha some; cancelar mantém.
- GREEN:
  - `handleToggle(id, active)`: agora seta local otimista E chama `adminsApi.setActive(id, active)`; erro → reverte + `showToast`.
  - `removing` state; a lixeira → `setRemoving(admin)`; render `<ConfirmDialog title="Excluir administrador?" message={\`${removing.name} será removido do sistema.\`} confirmLabel="Excluir" confirmDanger onConfirm={() => handleRemove(removing)} onCancel={() => setRemoving(null)} />`.
  - `handleRemove(a)`: `setRemoving(null)`, otimista remove da lista, `adminsApi.remove(a.id)`; erro → reinsere (posição) + `showToast(error.message)`; sucesso → toast.
  - **Esconder a lixeira** na linha do admin logado (comparar `admin.id` com o id da sessão via `useAuth`) — evita oferecer auto-exclusão. (Se `useAuth` expõe o user id; senão, deixar e confiar no 400 do backend + toast.)
- Run vitest (AdminsList + suíte) + `tsc` + `vite build` verdes.
- Commit: `feat(admin): fia toggle ativo + excluir admin (confirmação + otimista)`.

---

## Verificação final (ao vivo)
- Backend: `prisma migrate` já rodou; rebuild da api (`docker compose ... up -d --build api`).
- Playwright: login admin → /admins. (a) Toggle OFF num admin de teste → via API confirmar `active=false` e que o login dele dá 403. (b) Criar um admin de teste sem dados (via POST /users) → excluir pela UI → some; confirmar sumiço no db. (c) Tentar excluir um admin com dados vinculados → toast "desative em vez de excluir", linha permanece. 0 erros de console. Restaurar estado ao fim.

## Riscos / notas
- **Migração** mexe no schema do db de dev — aditiva e reversível; NÃO commitar dados, só o arquivo de migração + schema.
- **DELETE 204:** o `apiFetch` trata corpo vazio (já visto no http.ts) — o envelope deve devolver `{ data:null, error:null }` no sucesso.
- **Self-delete:** guarda no backend (400) + esconder a lixeira do próprio admin no front.
- **Regra DS:** `ConfirmDialog` é composição de página (permitido). Sem hardcode (exceto o scrim rgba).
- **NÃO commitar** eas.json, .playwright-mcp, screenshots, docker-compose.ports-alt.yml.
