# Relatórios (CRUD completo + comentários) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) para implementar task-by-task.

**Goal:** Deixar o domínio de Relatórios do painel swi-admin 100% funcional (criar, ler, editar/revisar, comentar) contra o backend NestJS real, com só saúde/vitais permanecendo mock.

**Architecture:** Backend ganha `PATCH /reports/:id` + model/rotas de `Comment` + seed rico. Admin ganha `services/api/reports.ts` (fachada envelope `MockResponse`, padrão `api/users.ts`) e as telas (`ReportsList`, `ReportDetails`, `NewReport`, `ResponsablesModal`) passam a escrever/ler no backend. Ornamentos de avatar seguem decorativos.

**Tech Stack:** NestJS + Prisma (Postgres) + MinIO/S3 (backend); Vite + React + React Native Web + `@kavicki/swi-design-system` (admin); Jest (backend), Vitest + Testing Library (admin), Playwright (e2e ao vivo).

**Design:** `docs/plans/2026-07-23-swi-admin-reports-design.md`

**Convenções desta base:**
- Backend: envelope RAW (o controller retorna o objeto; não usa `MockResponse`). Guards via `@UseGuards(JwtAuthGuard)` + decorator `@CurrentUserId()`. `toDto` presigna keys.
- Admin: **nunca** hardcodar token do DS — `useTheme()`. **Nunca** criar componente que o DS já tem (regra dura). Telas compõem primitivos do DS.
- Commits: **NÃO** incluir `Co-Authored-By` de Claude nem rodapé "Generated with Claude Code" (regra do usuário). Mensagens em pt-BR, prefixo por app (`feat(admin)`, `feat(backend)`).
- Rodar comandos de cada app **de dentro da pasta do app** (`cd swi-backend` / `cd swi-admin`).

---

## FASE A — Backend (`swi-backend`)

### Task A1: `PATCH /reports/:id` (editar conteúdo + status)

**Files:**
- Modify: `swi-backend/src/reports/dto.ts` (add `UpdateReportDto`)
- Modify: `swi-backend/src/reports/reports.service.ts` (add `update`)
- Modify: `swi-backend/src/reports/reports.controller.ts` (add `@Patch(':id')`)
- Test: `swi-backend/src/reports/reports.service.spec.ts`

**Step 1 — Failing test (service.update):** No `reports.service.spec.ts`, adicionar bloco `describe('update')`:
```ts
it('atualiza campos e devolve o DTO', async () => {
  const existing = await seedReport({ title: 'Old', status: 'pending' })
  const dto = await service.update(existing.id, existing.authorId, {
    title: 'Novo', status: 'accept', statusLabel: 'Concluído',
  })
  expect(dto.title).toBe('Novo')
  expect(dto.status).toBe('accept')
})
it('404 quando o relatório não existe', async () => {
  await expect(service.update('00000000-0000-0000-0000-000000000000', anyUserId, { title: 'x' }))
    .rejects.toThrow(NotFoundException)
})
```
(Reusar os helpers de seed já existentes no spec; se não houver, criar `seedReport` local via `prisma.report.create`.)

**Step 2 — Run, expect FAIL:** `cd swi-backend && npm test -- reports.service` → FAIL (`update` não existe).

**Step 3 — DTO:** em `dto.ts`, adicionar (todos opcionais; mesmo regex de imageKeys do create):
```ts
export class UpdateReportDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  @IsOptional() @IsIn(['accept', 'pending', 'canceled', 'info']) status?: string
  @IsOptional() @IsString() statusLabel?: string
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true }) imageKeys?: string[]
}
```

**Step 4 — Service.update:** em `reports.service.ts`:
```ts
async update(id: string, _userId: string, dto: UpdateReportDto) {
  try {
    const r = await this.prisma.report.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.details !== undefined && { details: dto.details }),
        ...(dto.responsibles !== undefined && { responsibles: dto.responsibles }),
        ...(dto.imageKeys !== undefined && { imageKeys: dto.imageKeys }),
        ...(dto.status !== undefined && { status: dto.status as ReportStatus }),
        ...(dto.statusLabel !== undefined && { statusLabel: dto.statusLabel }),
      },
    })
    return this.toDto(r)
  } catch (e) {
    if ((e as { code?: string }).code === 'P2025') throw new NotFoundException('Relatório não encontrado')
    throw e
  }
}
```
(Importar `ReportStatus` de `@prisma/client` e `NotFoundException` de `@nestjs/common`.)

**Step 5 — Controller:** adicionar `@Patch(':id')`:
```ts
@Patch(':id')
update(@Param('id') id: string, @CurrentUserId() userId: string, @Body() dto: UpdateReportDto) {
  return this.reports.update(id, userId, dto)
}
```
(Importar `Patch` de `@nestjs/common` e `UpdateReportDto`.)

**Step 6 — Run, expect PASS:** `cd swi-backend && npm test -- reports.service` → PASS.

**Step 7 — Commit:**
```bash
git add swi-backend/src/reports/
git commit -m "feat(backend): PATCH /reports/:id edita conteúdo e status do relatório"
```

---

### Task A2: Model `Comment` + rotas de comentário

**Files:**
- Modify: `swi-backend/prisma/schema.prisma` (model `Comment`, relações em `User` e `Report`)
- Create: migration `swi-backend/prisma/migrations/<ts>_add_report_comment/`
- Modify: `swi-backend/src/reports/reports.service.ts` (`addComment`, embutir comments no `get`)
- Modify: `swi-backend/src/reports/reports.controller.ts` (`@Post(':id/comments')`)
- Modify: `swi-backend/src/reports/dto.ts` (`CreateCommentDto`)
- Test: `swi-backend/src/reports/reports.service.spec.ts`

**Step 1 — Schema:** em `schema.prisma`:
```prisma
model Comment {
  id        String   @id @default(uuid())
  reportId  String
  report    Report   @relation(fields: [reportId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  body      String
  createdAt DateTime @default(now())
  @@index([reportId])
}
```
Adicionar `comments Comment[]` em `model Report` e `comments Comment[]` em `model User`.

**Step 2 — Migração (aditiva):**
`cd swi-backend && npx prisma migrate dev --name add_report_comment`
Expected: cria a migração e aplica; `prisma generate` roda.

**Step 3 — Failing test:** em `reports.service.spec.ts`:
```ts
describe('comments', () => {
  it('addComment cria e get embute a lista ordenada por data', async () => {
    const r = await seedReport({})
    await service.addComment(r.id, authorId, { body: 'Primeiro' })
    const dto = await service.get(r.id)
    expect(dto!.comments).toHaveLength(1)
    expect(dto!.comments[0].body).toBe('Primeiro')
    expect(dto!.comments[0].authorName).toBeDefined()
  })
})
```

**Step 4 — Run, expect FAIL:** `npm test -- reports.service` → FAIL.

**Step 5 — DTO:** em `dto.ts`:
```ts
export class CreateCommentDto {
  @IsString() @IsNotEmpty() body!: string
}
```

**Step 6 — Service:** em `reports.service.ts` — `addComment` cria o comentário e devolve DTO com autor (nome+avatar presignado); `get(id)` passa a incluir `comments` ordenados asc, cada um resolvido via `toCommentDto`:
```ts
async addComment(reportId: string, authorId: string, dto: CreateCommentDto) {
  const exists = await this.prisma.report.findUnique({ where: { id: reportId }, select: { id: true } })
  if (!exists) throw new NotFoundException('Relatório não encontrado')
  const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
  const c = await this.prisma.comment.create({ data: { reportId, authorId, body: dto.body } })
  return this.toCommentDto(c, author)
}

private async toCommentDto(c: Comment, author: (User & { profile: Profile | null }) | null) {
  return {
    id: c.id,
    body: c.body,
    authorName: author?.profile?.fullName ?? author?.name ?? '',
    authorAvatarUri: author?.profile?.avatarKey ? await this.media.presignGet(author.profile.avatarKey) : '',
    createdAt: this.formatDate(c.createdAt),
  }
}
```
`get(id)` → `findUnique({ where:{id}, include:{ comments:{ orderBy:{ createdAt:'asc' } } } })`; se achou, montar `{ ...toDto(r), comments: await Promise.all(r.comments.map(c => toCommentDto(c, await user+profile de c.authorId))) }`. (Importar `Comment`, `User`, `Profile` de `@prisma/client`. O executor pode simplificar num único map — requisito: `get` devolve `comments: CommentDto[]` asc.)

**Step 7 — Controller:**
```ts
@Post(':id/comments')
addComment(@Param('id') id: string, @CurrentUserId() userId: string, @Body() dto: CreateCommentDto) {
  return this.reports.addComment(id, userId, dto)
}
```

**Step 8 — Run, expect PASS:** `npm test -- reports.service` → PASS.

**Step 9 — Commit:**
```bash
git add swi-backend/prisma/ swi-backend/src/reports/
git commit -m "feat(backend): comentários de relatório (model Comment + POST /reports/:id/comments + embed no get)"
```

---

### Task A3: Presign aceitar prefixo `reports/`

**Files:**
- Inspect/Modify: o serviço/rota de presign em `swi-backend/src/media/` (o mesmo que serve `order`/`chat`).
- Test: spec do media service, se existir.

**Step 1:** Localizar onde os prefixos permitidos do presign são validados (`grep -rn "order\|chat" swi-backend/src/media`). Se houver allowlist de prefixo, adicionar `reports`. Se o presign já aceita qualquer prefixo controlado, confirmar que `reports/<uuid>.(jpg|png)` passa.

**Step 2:** Teste (se houver spec de media): presign com prefixo `reports` devolve key `reports/<uuid>.<ext>`.

**Step 3 — Commit** (se houve mudança):
```bash
git add swi-backend/src/media/
git commit -m "feat(backend): presign aceita prefixo reports/ para anexos de relatório"
```

---

### Task A4: Seed rico de relatórios + comentários

**Files:**
- Modify: `swi-backend/prisma/seed.ts`
- Create: `swi-backend/prisma/seed-assets/inspection-{1,2,3}.png` (copiar de `swi-admin/src/assets/reports/`)

**Step 1 — Copiar assets:** copiar as 3 fotos de inspeção do admin para `swi-backend/prisma/seed-assets/`.

**Step 2 — Upload helper:** reusar o padrão `uploadChatAvatar` (S3 client + guard bucket-down) criando `uploadReportImage(fileName): Promise<string>` que faz `PutObjectCommand` com `Key = reports/<uuid>.png` lendo o arquivo de `seed-assets/`. Guard: bucket fora do ar → devolve `''` (relatório fica sem imagem, seed não quebra).

**Step 3 — Criar ~12 relatórios:** array de fixtures espelhando o mock (`swi-admin/src/services/mockApi/reports.ts` `REPORTS_SEED`) — títulos/resumos/setores/status variados (`accept|pending|canceled|info`). Para cada um: `prisma.report.create` com autor = um worker seedado (rodízio; usa `contactAvatarKeys` p/ `authorAvatarKey`), `responsibles` (nomes), `sector`, `details` (o `DEMO_DETAILS.details` do mock), `activities` (JSON com título/setor/progresso/tom — SEM avatares; o admin decora), `imageKeys` (via `uploadReportImage`, reusadas). Gravar `creationDate` variado (datas do mock).

**Step 4 — Comentários demo:** em 1–2 relatórios, `prisma.comment.create` com autor admin/worker e corpo curto.

**Step 5 — Rodar seed:** `cd swi-backend && npx prisma db seed`
Expected: sem erro; logs de upload (ou warning de bucket).

**Step 6 — Verificar:** `curl` autenticado em `GET /reports` mostra ~12 itens com status variados; `GET /reports/:id` de um relatório com comentário mostra `comments`.

**Step 7 — Commit:**
```bash
git add swi-backend/prisma/
git commit -m "feat(backend): seed com ~12 relatórios ricos + imagens no MinIO + comentários demo"
```

---

## FASE B — Admin (`swi-admin`)

### Task B1: `services/api/reports.ts` (fachada + mapper de leitura)

**Files:**
- Create: `swi-admin/src/services/api/reports.ts`
- Test: `swi-admin/src/services/api/reports.test.ts`
- Reference (copiar padrão): `swi-admin/src/services/api/users.ts`, `swi-admin/src/services/api/http.ts`

**Contrato do backend (DTO):** `get`/`list` devolvem `{ id, title, summary, status, statusLabel, authorName, authorAvatarUri, creationDate, sector, responsibles: string[], details, images: string[], activities: unknown, comments?: CommentDto[] }`. `CommentDto = { id, body, authorName, authorAvatarUri, createdAt }`.

**Step 1 — Failing tests (`reports.test.ts`):** mockar `apiFetch` (padrão do `users.test.ts`) e cobrir:
- `list()` mapeia `responsibles: ['Ana','Bea']` → `responsibles: 'Ana, Bea'`.
- `list()` injeta `responsibleAvatars` (não-vazio) e `responsibleTotalCount` (decoração).
- `get()` coage `activities` cru → `ReportActivity[]` com `avatars` decorativos injetados.
- `get()` passa `comments` adiante.
- `update()`/`addComment()` chamam `apiFetch` com método/rota certos e devolvem envelope.
- Erro de rede → `{ data: null, error: {...} }`.

**Step 2 — Run, expect FAIL:** `cd swi-admin && npx vitest run src/services/api/reports.test.ts` → FAIL.

**Step 3 — Implementar** `api/reports.ts`: reusar tipos `Report`/`ReportActivity` de `@/services/mockApi/reports`. Mapper:
- `responsibles: string[]` → `.join(', ')`.
- `responsibleAvatars`/`responsibleTotalCount`: constante decorativa (rodízio de `worker-a/b/c.png` de `@/assets/avatars`); documentar como decoração.
- `activities`: `(raw as ReportActivity[] ?? []).map(a => ({ ...a, avatars: DECOR_AVATARS }))`.
- passthrough do resto.
- `list()/get()`: `apiFetch<...>('/reports' | '/reports/:id')` no envelope (padrão `listMapped`/`getMapped`).
- `create(input)`: `POST /reports` (title/summary/details/responsibles/imageKeys).
- `update(id, patch)`: `PATCH /reports/:id`.
- `addComment(id, body)`: `POST /reports/:id/comments`.
- Exportar `reportsApi` com essas funções + re-exportar tipos `Report`, `ReportActivity`, `ReportComment`.

**Step 4 — Run, expect PASS.**

**Step 5 — Commit:**
```bash
git add swi-admin/src/services/api/reports.ts swi-admin/src/services/api/reports.test.ts
git commit -m "feat(admin): api/reports.ts (fachada real GET/POST/PATCH + mapper de leitura)"
```

---

### Task B2: Repontar `ReportsList` + `ReportDetails` (leitura) pro backend

**Files:**
- Modify: `swi-admin/src/pages/reports/ReportsList.tsx` (import `@/services/reports` → `@/services/api/reports`)
- Modify: `swi-admin/src/pages/reports/ReportDetails.tsx` (idem; a lista de comentários vem na Task B4)
- Test: `ReportsList.test.tsx`, `ReportDetails.test.tsx` (ajustar mocks pro novo módulo)

**Step 1 — Ajustar testes** pro import novo (mockar `@/services/api/reports`). Rodar → FAIL onde o contrato mudou.

**Step 2 — Trocar imports** nas duas telas. A lista/detalhe consomem o mesmo tipo `Report`, então o corpo não muda (a decoração vem do mapper).

**Step 3 — Run:** `npx vitest run src/pages/reports/` → PASS.

**Step 4 — Commit:**
```bash
git commit -am "feat(admin): ReportsList/ReportDetails leem do backend real via api/reports"
```

---

### Task B3: `NewReport` — criação real + anexos + responsáveis

**Files:**
- Modify: `swi-admin/src/services/api/upload.ts` (estender prefixo p/ `'reports'`)
- Modify: `swi-admin/src/pages/reports/NewReport.tsx`
- Modify: `swi-admin/src/pages/modals/ResponsablesModal.tsx` (devolver seleção)
- Test: `NewReport.test.tsx`, `ResponsablesModal.test.tsx`

**Step 1 — upload prefix:** em `upload.ts`, trocar a união `prefix: 'order' | 'chat'` → `'order' | 'chat' | 'reports'` e garantir que o presign do backend aceita (Task A3). Teste: `uploadImage(file,'reports')` chama presign com prefixo certo.

**Step 2 — Failing test (NewReport):** "Salvar relatório" com título preenchido → chama `reportsApi.create` com `{ title, summary, details, responsibles, imageKeys }` e navega pra `/reports`. Anexo selecionado → `uploadImage(file,'reports')` e a key entra em `imageKeys`.

**Step 3 — ResponsablesModal:** a seleção precisa voltar pro `NewReport`. Abordagem: **state leve compartilhado** (um store `useReportDraft` em `@/lib` **ou** `location.state` do react-router). "Continuar" grava os nomes selecionados no draft e `navigate(-1)`; `NewReport` lê o draft e mostra os responsáveis atribuídos + inclui no payload. Teste: selecionar 2 admins → voltar → `NewReport` mostra 2 e manda em `responsibles`.

**Step 4 — Implementar** NewReport: fiar o `onPress` do "Salvar" → upload dos anexos → `reportsApi.create` → toast de sucesso/erro (envelope) → navigate. Reconectar o modal.

**Step 5 — Run, expect PASS** (`npx vitest run src/pages/reports/NewReport.test.tsx src/pages/modals/ResponsablesModal.test.tsx`).

**Step 6 — Commit:**
```bash
git commit -am "feat(admin): NewReport cria relatório real (POST + upload de anexos + responsáveis do modal)"
```

---

### Task B4: Comentários no `ReportDetails`

**Files:**
- Modify: `swi-admin/src/pages/reports/ReportDetails.tsx`
- Test: `ReportDetails.test.tsx`

**Step 1 — Failing test:** `get` devolve `comments: [{authorName:'Ana', body:'ok', createdAt:'20/04/2026', authorAvatarUri:''}]` → a tela renderiza a lista (autor + corpo + data). "Fazer comentário" com texto → chama `reportsApi.addComment(id, body)` → o novo comentário aparece na lista (append) e o input limpa.

**Step 2 — Implementar:** acima do input "Adicionar comentário", renderizar a **lista de comentários** compondo primitivos do DS (`Avatar` + `Text` para nome/corpo/data; SEM criar componente novo). "Fazer comentário" → `addComment` → append ao state + limpar input; erro → toast via envelope.

**Step 3 — Run, expect PASS.**

**Step 4 — Commit:**
```bash
git commit -am "feat(admin): lista + criação de comentários no ReportDetails"
```

---

### Task B5: Editar/Revisar relatório (modo edição do form)

**Files:**
- Modify: `swi-admin/src/app/App.tsx` (rota `/reports/:id/edit`)
- Modify: `swi-admin/src/pages/reports/NewReport.tsx` (aceitar modo edição via `useParams`) **ou** extrair `ReportForm` compartilhado se ficar mais limpo (compõe DS, não replica)
- Modify: `swi-admin/src/pages/reports/ReportDetails.tsx` ("Revisar relatório" → `navigate('/reports/:id/edit')`)
- Test: `NewReport.test.tsx` (modo edição), teste de rota

**Step 1 — Failing test:** montar `NewReport` em modo edição com `id` → carrega `reportsApi.get(id)`, pré-preenche título/resumo/detalhes + **controle de status**; "Salvar" → `reportsApi.update(id, patch)` → navega pro detalhe. "Revisar relatório" no detalhe navega pra `/reports/:id/edit`.

**Step 2 — Implementar:**
- Rota `/reports/:id/edit` (dentro do `AppLayout`, junto das outras de reports).
- `NewReport` detecta `:id` (via `useParams`) → modo edição: fetch + prefill + botão "Salvar" chama `update`; adicionar um seletor de status (DS `Combobox`) visível só no modo edição.
- `ReportDetails` "Revisar relatório" → `navigate('/reports/${id}/edit')` (troca o toast).

**Step 3 — Run, expect PASS.**

**Step 4 — Commit:**
```bash
git commit -am "feat(admin): editar/revisar relatório (rota /reports/:id/edit + status via PATCH)"
```

---

### Task B6: Limpeza da fachada morta + prettier órfão

**Files:**
- Delete: `swi-admin/src/services/reports.ts`, `swi-admin/src/services/mockApi/reports.ts` (mover os TIPOS `Report`/`ReportActivity` p/ `api/reports.ts` antes), `swi-admin/src/services/amplifyApi/reports.ts`
- Modify: `swi-admin/src/app/App.tsx` (o diff de prettier órfão já está no working tree — entra num commit limpo aqui)

**Step 1:** `grep -rn "services/reports\|mockApi/reports\|amplifyApi/reports" swi-admin/src` — confirmar que só as telas de reports importavam (já repontadas). Os **tipos** (`Report`, `ReportActivity`) devem passar a viver em `api/reports.ts` (re-exportados) pra remover o mock com segurança.

**Step 2:** Remover os 3 arquivos mortos; ajustar imports de tipo remanescentes.

**Step 3 — tsc + testes:** `cd swi-admin && npx tsc --noEmit && npx vitest run` → verde.

**Step 4 — Commit:**
```bash
git add -A swi-admin/src
git commit -m "chore(admin): remove fachada morta de reports (DATA_BACKEND) + prettier do App.tsx"
```

---

## FASE C — Verificação ao vivo

### Task C1: Playwright ao vivo contra a stack real

**Pré:** subir a stack (Postgres 5433 / backend 9002 / MinIO / admin) conforme [[swi-dev-stack-portas]]; DB re-seedado (Task A4).

**Roteiro (mesma régua dos Passos 2/3):**
1. Login admin → `/reports` mostra ~12 relatórios com status variados (chips diferentes).
2. Abrir um relatório → detalhe carrega, imagens vêm do MinIO, comentário demo aparece.
3. Criar relatório (`/reports/new`): preencher, anexar imagem, atribuir responsáveis via modal, Salvar → `POST /reports 201` → volta e o card novo aparece na lista.
4. "Revisar relatório" → `/reports/:id/edit` → mudar status e detalhe → Salvar → `PATCH 200` → detalhe reflete.
5. "Fazer comentário" → `POST /reports/:id/comments` → comentário aparece na lista.
6. **0 erros no console** ao longo do fluxo.

**Evidência:** screenshots + checagem de `browser_network_requests` (201/200 reais). Sem commit (verificação).

---

## Fechamento

- `cd swi-backend && npm test` e `cd swi-admin && npx vitest run` verdes.
- Atualizar a memória `swi-admin-backend-roadmap` (Passo 4 → FEITO) e `swi-open-followups` (pendências: ex. responsáveis como nomes livres vs. user-ids; avatares decorativos).
- Abrir PR `feat/backend-admin-reports` → `main` (sem rastros de IA no corpo).
