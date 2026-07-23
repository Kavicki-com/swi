# Design — Ativar/desativar e excluir usuário pelo painel

**Data:** 2026-07-22
**Fatia:** follow-up #3 do Passo 2 (ver `project_swi_admin_backend_roadmap` na memória)
**Branch:** `feat/backend-admin-user-lifecycle` (de `origin/main`)

## Problema

Na tela de Administradores, cada linha tem um `Toggle` ("Ativo") e uma lixeira ("Excluir") — hoje **só cosméticos** (toggle = estado local, lixeira = toast demo). Não há campo `active` no `User` nem endpoints de `PATCH`/`DELETE`. O admin não consegue desativar nem remover ninguém de verdade.

## Decisões (do brainstorming)

1. **"Ativo" = campo novo `active`** no `User` (`Boolean @default(true)`); o `login` passa a barrar inativos. Toggle liga/desliga (revogável). Migração aditiva.
2. **"Excluir" remove de verdade, com guarda:** `DELETE /users/:id` apaga Profile + User numa transação; se o usuário tiver registros vinculados (reports/jornadas/mensagens/work orders → FK `P2003`), retorna **409 amigável** ("desative em vez de excluir"). Sem perda de histórico, "Excluir" continua significando excluir.
3. **Escopo de UI: só Admins** (o Figma não põe esses controles nos Colaboradores). O campo `active` é geral no backend; a UI de ativar/excluir fica só na tela de Administradores.

## Arquitetura

### Backend (`swi-backend`)
- **Migração** `add_user_active`: `ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true`. Aditiva.
- **`login` (auth.service):** após o check de `approvalStatus`, `if (!u.active) throw new ForbiddenException({ reason:'INACTIVE', message:'Sua conta está desativada' })`. +1 teste no auth spec.
- **`UsersService.setActive(id, active)`** → `prisma.user.update({ where:{id}, data:{active} })`; retorna `{ id, active }`. NotFound se não existir.
- **`UsersService.remove(id, requesterId)`** → guarda: se `id === requesterId` → `BadRequestException` ("não é possível excluir a si mesmo"). Transação: `prisma.profile.deleteMany({ where:{userId:id} })` depois `prisma.user.delete({ where:{id} })`. Captura `PrismaClientKnownRequestError` `P2025` (não existe → NotFound) e `P2003` (FK vinculada → `ConflictException` "usuário possui registros vinculados; desative-o em vez de excluir").
- **Controller:** `@Patch(':id') @Roles('ADMIN') setActive(@Param('id') id, @Body() dto: SetActiveDto)` (dto: `@IsBoolean() active`); `@Delete(':id') @Roles('ADMIN') @HttpCode(204) remove(@Param('id') id, @CurrentUserId() requesterId)`.

### Admin (`swi-admin`)
- **Client (`services/api/users.ts`):** `adminsApi.setActive(id, active)` → `PATCH /users/:id { active }`; `adminsApi.remove(id)` → `DELETE /users/:id`. Envelope `MockResponse`.
- **`AdminsList`:**
  - **Toggle:** `handleToggle(id, active)` — otimista (seta local já) + `adminsApi.setActive(id, active)`; erro → reverte + toast.
  - **Excluir:** a lixeira abre o **ConfirmDialog** ("Excluir administrador?" / "{nome} será removido do sistema."). Confirmar → `adminsApi.remove(id)` → remove a linha + toast; erro 409 → toast com a mensagem do backend (mantém a linha). Cancelar → fecha.
- **Shared `ConfirmDialog`** (`pages/_shared/ConfirmDialog.tsx`): composição de DS (View overlay + card + Title + Text + 2 Button) extraída do `ConfirmReject` inline da fila. Props: `title, message, confirmLabel, confirmDanger?, onConfirm, onCancel`. Fecha por Escape + clique no scrim; `aria-modal`.
  - **Refatorar `EmployeesList`** (fila) pra usar o `ConfirmDialog` compartilhado no lugar do `ConfirmReject` inline — DRY. Os testes existentes da fila (Escape/scrim/cancelar/confirmar) protegem o refactor.

## Fluxo de erro
- Toggle falha → reverte o estado local + toast.
- Excluir com FK (409) → toast "desative em vez de excluir", linha permanece.
- Excluir a si mesmo bloqueado no backend (400) — a UI nem deve oferecer excluir a própria linha (esconder a lixeira no admin logado, se o id bater).

## Testes (TDD)
**Backend:** `setActive` atualiza; `remove` happy (deleta profile+user); `remove` self → BadRequest; `remove` com P2003 → Conflict; `remove` inexistente → NotFound; `login` barra `active=false`.
**Client:** `setActive` PATCH url+body; `remove` DELETE url+método; erro (409) → `{data:null,error}`.
**AdminsList:** toggle chama `setActive` (otimista); excluir abre confirmação, confirmar chama `remove` e remove a linha, cancelar mantém; erro 409 mantém a linha + toast.
**ConfirmDialog:** confirmar/cancelar/Escape/scrim.
**Gate:** vitest + tsc + vite build (admin); jest + tsc (backend). **Playwright:** desativar um admin → login dele barra (403); excluir um admin recém-criado (sem dados) → some; excluir admin com dados → toast de erro.

## Não-objetivos
- Controles de ativar/excluir nos Colaboradores (fora do Figma).
- Reativar via fluxo de e-mail; edição de usuário.
- Cascade delete (perda de histórico — rejeitado).
