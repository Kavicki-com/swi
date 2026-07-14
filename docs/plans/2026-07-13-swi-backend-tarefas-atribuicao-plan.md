# Tarefas com atribuição (WorkOrder + checklist) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou
> subagent-driven-development) task-by-task.

**Goal:** Destravar a atribuição de tarefas: entidade pai `WorkOrder` (criada
pelo admin, N responsáveis, checklist = os `Task`s que o app já mostra na
jornada), endpoints admin, conclusão explícita de item no mobile e o gatilho de
notificação que estava *design-blocked* desde a Fatia 5.

**Architecture:** Ver `docs/plans/2026-07-13-swi-backend-tarefas-atribuicao-design.md`.
PAI novo (`WorkOrder`, 3 estados = 3 abas do admin) + FILHO existente (`Task`,
mantém âncoras/`paused`). Status do pai **recomputado em `$transaction` com
lock `FOR UPDATE`** da ordem (disciplina H2/H3a). Progresso do pai derivado
(done÷total) — não armazenado. Fotos sobem pro pai. Notificação via
`NotificationService.enqueueForMany` (fila pg-boss da F5, domain `journey`).

**Tech Stack:** NestJS 10 + Prisma + pg-boss (tudo já instalado — **zero dep
nova**, backend e mobile). Expo/RN + Jest no mobile.

**⚠️ Branch:** `feat/backend-tarefas` a partir de `origin/main`. A mudança
local **uncommitted** em `mobile/eas.json` (URL real do túnel ngrok) **NÃO pode
ser commitada** — deixar fora de todo `git add` (regra do projeto).

**Baselines (registrar no início da branch — referência pós-PR #38):** backend
build 0 / unit 137 / e2e ~42; mobile jest 174 / tsc **8 erros baseline** (0
novos) / `npx expo export --platform web` exit 0. Backend `npm test` já tem o
cap `maxWorkers: 50%` (lição H1) — não remover.

**Zero `swi-admin/`** nesta branch (regra de branch; a UI admin é
`feat/admin-tarefas`, depois).

---

### Task 1: branch + baselines

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git fetch origin
git switch main && git pull
git switch -c feat/backend-tarefas
git status   # conferir: mobile/eas.json modificado FICA uncommitted
```

Registrar baselines: `cd swi-backend && npm run build && npm test` e
`npm run test:e2e` (docker compose com Postgres up); `cd ../mobile && npx tsc
--noEmit | tail -5` (esperado: 8 erros baseline) e `npx jest --silent`.

---

### Task 2: funções puras `order-status.ts` (TDD — sem dep de schema)

**Files:** Create `swi-backend/src/work-orders/order-status.ts` +
`order-status.spec.ts`.

**Step 1 — teste falhando** (`order-status.spec.ts`):

```ts
import { orderStatus, orderProgressPct, distributeMinutes } from './order-status'

describe('orderStatus (recompute puro do pai — Decisão C)', () => {
  it('todos done → done', () => {
    expect(orderStatus(['done', 'done'])).toBe('done')
  })
  it('nenhum começado → pending', () => {
    expect(orderStatus(['pending', 'pending'])).toBe('pending')
  })
  it('misto → in_progress (paused e done contam como começado)', () => {
    expect(orderStatus(['pending', 'in_progress'])).toBe('in_progress')
    expect(orderStatus(['pending', 'paused'])).toBe('in_progress')
    expect(orderStatus(['pending', 'done'])).toBe('in_progress')
  })
  it('lista vazia → pending (invariante ≥1 item torna isso inalcançável)', () => {
    expect(orderStatus([])).toBe('pending')
  })
})

describe('orderProgressPct (Decisão 4: done ÷ total)', () => {
  it('conta done sobre total, arredondado', () => {
    expect(orderProgressPct(['done', 'pending', 'pending'])).toBe(33)
    expect(orderProgressPct(['done', 'done'])).toBe(100)
    expect(orderProgressPct(['pending'])).toBe(0)
  })
})

describe('distributeMinutes (Decisão H: rateio determinístico)', () => {
  it('preserva a soma, resto nos primeiros', () => {
    expect(distributeMinutes(480, 4)).toEqual([120, 120, 120, 120])
    expect(distributeMinutes(100, 3)).toEqual([34, 33, 33])
  })
  it('total null → nulls; n=0 → []', () => {
    expect(distributeMinutes(null, 2)).toEqual([null, null])
    expect(distributeMinutes(480, 0)).toEqual([])
  })
})
```

**Step 2:** `cd swi-backend && npx jest src/work-orders/order-status.spec.ts`
→ FAIL (módulo não existe).

**Step 3 — implementar** (`order-status.ts`):

```ts
// Matemática PURA do WorkOrder — status derivado dos itens (Decisão C) e
// rateio da estimativa do pai (Decisão H). Zero deps Nest/Prisma.
export type ItemStatus = 'pending' | 'in_progress' | 'paused' | 'done'
export type OrderStatusValue = 'pending' | 'in_progress' | 'done'

export function orderStatus(items: ItemStatus[]): OrderStatusValue {
  if (items.length > 0 && items.every((s) => s === 'done')) return 'done'
  if (items.some((s) => s !== 'pending')) return 'in_progress'
  return 'pending'
}

export function orderProgressPct(items: ItemStatus[]): number {
  if (items.length === 0) return 0
  return Math.round((items.filter((s) => s === 'done').length / items.length) * 100)
}

export function distributeMinutes(total: number | null | undefined, n: number): (number | null)[] {
  if (n <= 0) return []
  if (total == null) return Array<number | null>(n).fill(null)
  const base = Math.floor(total / n)
  const rest = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0))
}
```

**Step 4:** rodar de novo → PASS. **Step 5 — commit** (só com luz verde):
`feat(backend): matemática pura do WorkOrder (status derivado + rateio)`.

---

### Task 3: schema + migração + jornada re-baseada + seed (unidade atômica — o build só volta a compilar completo)

**Files:** Modify `swi-backend/prisma/schema.prisma`,
`swi-backend/src/journey/journey.service.ts`, `journey.controller.ts`, `dto.ts`,
`journey.service.spec.ts`, `swi-backend/prisma/seed.ts`,
`swi-backend/src/media/*` (prefix `order`). Create migração.

**Step 1 — schema** (diff conforme o design):
- Enum novo `WorkOrderStatus { pending in_progress done }` + model `WorkOrder`
  (copiar do design; m-n implícito `responsibles User[] @relation("workOrderResponsibles")`).
- `Task`: `+orderId String` + `order WorkOrder @relation(fields:[orderId],
  references:[id], onDelete: Cascade)` + `+position Int @default(0)` +
  `@@index([orderId, position])`; **remover** `assignedTo`/`assignee`,
  `objective`, `scheduledDate`, `imageKeys`, `interestedCount`,
  `interestedAvatarKeys` e o índice `[assignedTo, scheduledDate]`.
- `User`: `+authoredWorkOrders WorkOrder[] @relation("authoredWorkOrders")` +
  `+responsibleFor WorkOrder[] @relation("workOrderResponsibles")`; **remover**
  `tasks Task[]`.

**Step 2 — migração** (DB de dev, sem dado real — reseed limpo):
```bash
docker compose up -d postgres
npx prisma migrate dev --name work-orders
```
(Se o Prisma reclamar de dado existente na tabela Task: `npx prisma migrate
reset --force` — o banco é descartável, o seed repovoa.)

**Step 3 — `journey.service.ts` re-baseado** (mecânica de âncoras INTOCADA):

- `findMyTask(workerId, id, db)` → membership via pai:
```ts
private async findMyTask(workerId: string, id: string, db: Db = this.prisma) {
  return db.task.findFirst({
    where: { id, order: { responsibles: { some: { id: workerId } } } },
    include: { order: { include: { responsibles: { include: { profile: true } } } } },
  })
}
```
- `listTasks(workerId)` → Decisão I:
```ts
const rows = await this.prisma.task.findMany({
  where: {
    order: {
      status: { not: 'done' },
      responsibles: { some: { id: workerId } },
      OR: [{ startDate: null }, { startDate: { lte: this.today() } }],
    },
  },
  orderBy: [{ order: { createdAt: 'asc' } }, { position: 'asc' }],
  include: { order: { include: { responsibles: { include: { profile: true } } } } },
})
```
- Helpers novos no service (privados):
```ts
// Lock pessimista da ordem — serializa o recompute do pai entre transições
// concorrentes de itens irmãos (design: seção Concorrência).
private async lockOrder(orderId: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${orderId} FOR UPDATE`
}
private async recomputeOrder(orderId: string, tx: Prisma.TransactionClient) {
  const items = await tx.task.findMany({ where: { orderId }, select: { status: true } })
  await tx.workOrder.update({ where: { id: orderId }, data: { status: orderStatus(items.map((i) => i.status)) } })
}
```
- `startTask`: dentro da `$transaction` existente, após `findMyTask` →
  `lockOrder` e, depois do `task.update`, `recomputeOrder`. Resto igual.
- **`completeTask(workerId, taskId)` NOVO** (Decisão A): tx → findMyTask (404)
  → lockOrder → se `status !== 'done'`: `endAnchors` + update
  `{ status:'done', startedAt:null, accumulatedSeconds, progressPct:100 }`
  (idempotente: já done não re-banca) → recomputeOrder → se
  `journey.activeTaskId === taskId`: limpa `activeTaskId` (**estado/clock do
  turno intocados** — segue rodando). Devolve `{ journey, task }`.
- **`cancelTask(workerId, taskId)` NOVO**: idem com `pauseAnchors` + update
  `{ status:'pending', startedAt:null, accumulatedSeconds }` (tempo bancado
  preservado) → recomputeOrder → limpa `activeTaskId` se ativo. Devolve
  `{ journey, task }`.
- `endJourney` (Decisão E): o bloco do item ativo troca `status: 'done'` por
  `status: 'paused'` (o banking via `endAnchors` fica — o que muda é o status)
  e **mantém** o snapshot `progressPct` por tempo. Turno zera como hoje.
  `pause`/`resume`: inalterados (sem lock/recompute — paused/in_progress não
  mudam o resultado do recompute do pai).
- `addTaskPhoto` (Decisão F): valida membership → update no PAI:
  `workOrder.update({ where: { id: task.orderId }, data: { imageKeys: { push: imageKey } } })`
  → devolve `taskToDto` recarregado.
- `taskToDto(t)` (t inclui `order` + `responsibles`+profiles):
```ts
{
  id, title, description: t.description ?? '',
  objective: t.order.summary ?? '',                    // Decisão J
  estimatedMinutes: t.estimatedMinutes ?? 0,
  status, startedAt: iso, accumulatedSeconds, progressPct: t.progressPct ?? 0,
  images: await this.media.presignGetMany(t.order.imageKeys),   // Decisão F
  responsibleCount: t.order.responsibles.length,
  responsibleNames: t.order.responsibles.map((u) => u.profile?.fullName ?? u.name),
  responsibleAvatars: await this.media.presignGetMany(
    t.order.responsibles.map((u) => u.profile?.avatarKey).filter((k): k is string => !!k),
  ),
}
```

**Step 4 — controller**: rotas novas
`@Post('tasks/:id/complete')` e `@Post('tasks/:id/cancel')` (padrão das
existentes). `dto.ts`: regex do `imageKey` continua `task/` — **decisão**: fotos
de item continuam subindo com prefixo `task/` no storage (o que muda é onde o
registro é gravado: no pai).

**Step 5 — `journey.service.spec.ts`**: atualizar mocks do Prisma (include
order), cobrir: listTasks filtra por responsável+startDate+pai não-done;
complete idempotente + limpa activeTaskId + recompute chamado; cancel preserva
accumulatedSeconds; end → paused; photo faz push no PAI. Rodar → PASS.

**Step 6 — `seed.ts`** (design: seção Seed): `prisma.workOrder.deleteMany({})`
(cascade nos items) no lugar do delete por assignedTo; criar flagship
"Inspeção Técnica das Máquinas Pesadas" (4 itens, copy idêntica à do mock
mobile atual), a ordem sem checklist ("Trocar extintores do galpão 3",
auto-item construído no seed) e 3–4 ordens variadas pros outros workers
(povoam as 3 abas do admin). `estimatedMinutes` via `distributeMinutes(480, 4)`.

**Step 7 — media**: `PresignDto.prefix` ganha `'order'` (regex/enum) + caso no
spec.

**Step 8:** `npm run build` (0 erros) + `npm test` → PASS.
**Step 9 — commit**: `feat(backend): WorkOrder no schema + jornada re-baseada em responsáveis + seed`.

---

### Task 4: `WorkOrdersModule` (endpoints admin, TDD)

**Files:** Create `swi-backend/src/work-orders/work-orders.module.ts`,
`work-orders.controller.ts`, `work-orders.service.ts`, `dto.ts`,
`work-orders.service.spec.ts`. Modify `app.module.ts` (registrar).

**DTOs** (`dto.ts`) — reusar o validator de data de calendário do Perfil
(H3b — localizar o export em `src/profile/` e importar; NÃO duplicar):

```ts
export class WorkOrderItemDto {
  @IsOptional() @IsString() id?: string            // PATCH: reconciliação
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string
  @IsOptional() @IsString() @MaxLength(1000) description?: string
}

export class CreateWorkOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string
  @IsOptional() @IsString() @MaxLength(1000) summary?: string
  @IsOptional() @IsString() @MaxLength(8000) details?: string
  @IsOptional() @IsString() @MaxLength(120) sector?: string
  @IsOptional() @IsInt() @Min(1) estimatedMinutes?: number
  @IsOptional() @IsCalendarDate() startDate?: string   // 'YYYY-MM-DD'
  @IsOptional() @IsCalendarDate() dueDate?: string
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) responsibleIds!: string[]
  @IsOptional() @IsArray() @IsString({ each: true })
  @Matches(/^order\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true }) imageKeys?: string[]
  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => WorkOrderItemDto) items?: WorkOrderItemDto[]
}
// UpdateWorkOrderDto: gêmeo com TUDO opcional (escrever à mão; sem mapped-types).
// ListWorkOrdersQueryDto: status?: 'pending'|'in_progress'|'done' (@IsIn, opcional).
```

**Service** (unit-first, Prisma mockado no padrão dos siblings):

- `create(adminId, dto)`:
  1. Valida responsáveis: `user.findMany({ where: { id: { in: dto.responsibleIds }, role: 'WORKER', approvalStatus: 'APPROVED' } })` — contagem difere → `BadRequestException('responsável inválido')`.
  2. Itens: `dto.items?.length ? dto.items : [{ title: dto.title, description: dto.summary ?? '' }]` (**Decisão B — auto-item**).
  3. Rateio: `distributeMinutes(dto.estimatedMinutes ?? null, items.length)`.
  4. `workOrder.create` com `responsibles: { connect: ids.map(...) }` e
     `items: { create: items.map((it, i) => ({ ...it, position: i, estimatedMinutes: rateio[i] })) }`.
  5. **Notificação (Decisão G)**: `this.notifications.enqueueForMany(dto.responsibleIds, { title: 'Nova tarefa atribuída', body: order.title, domain: 'journey', targetId: order.id })` — best-effort (try/catch + `Logger.warn`, nunca quebra o create).
- `list(status?)`: `take: 200`, `orderBy: { createdAt: 'desc' }`, include
  `items(select status)` + `responsibles(+profile)`; DTO de linha com
  `progressPct: orderProgressPct(...)` + avatares presigned.
- `get(id)`: include completo → 404 se não existe. DTO: autor
  (`profile.fullName ?? name` + avatar presigned), responsáveis (id, name,
  jobTitle, sector, birthDate ISO date, avatar — **sem bloodType**, Decisão 2),
  itens ordenados por position (id/title/description/status), imagens
  presigned, datas ISO date, estimatedMinutes, status, progressPct.
- `update(id, dto)`: `$transaction` → `lockOrder` → patch campos escalares →
  **reconciliação de itens** (se `dto.items` presente): com `id` = update
  title/description; sem `id` = create no fim (position sequencial); ids
  existentes ausentes do array = delete. Resultado `< 1` item →
  `BadRequestException('a tarefa precisa de pelo menos 1 item')`. Se
  `estimatedMinutes` OU o conjunto de itens mudou → re-rateia
  (`distributeMinutes`) sobre os itens finais. Responsáveis (se presente):
  valida como no create + `responsibles: { set: ids.map(...) }`; **novos**
  (diff vs. atuais) → `enqueueForMany` só pra eles. → `recomputeOrder`.
- `listAssignable()`: espelha `chat.listDirectory` **sem** excluir ninguém:
  `{ approvalStatus:'APPROVED', role:'WORKER' }` + profile; DTO: id, name,
  jobTitle, sector, birthDate, avatar presigned.

(`lockOrder`/`recomputeOrder`: extrair pro módulo compartilhado ou duplicar
mínimo — decisão do implementer com o quality gate; NÃO importar JourneyService
inteiro só por isso.)

**Controller**: `@Controller('work-orders')`
`@UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')` na classe inteira;
`GET /work-orders/assignable` DEVE vir declarado **antes** de `GET :id` (ordem
de rota do Nest). Módulo importa `MediaModule` + `NotificationModule` (service
exportado desde a F5) e registra em `app.module.ts`.

**Specs** (`work-orders.service.spec.ts`): create com checklist / sem checklist
(auto-item) / responsável inválido 400 / rateio aplicado / notificação
enfileirada; update reconcilia (update+create+delete) / bloqueia 0 itens /
notifica só os novos responsáveis; list filtra por status e deriva progresso;
assignable não vaza não-aprovado.

**Steps:** testes → FAIL → implementar → PASS → `npm run build` 0.
**Commit**: `feat(backend): WorkOrdersModule — criação/edição/atribuição de tarefas pelo admin + notificação`.

---

### Task 5: e2e

**Files:** Create `swi-backend/test/work-orders.e2e-spec.ts`; Modify
`swi-backend/test/journey.e2e-spec.ts` (e cleanup FK: workOrders antes de users
onde os e2e deletam users — lição F5).

`work-orders.e2e` (padrão dos siblings — app real vs Postgres, users
throwaway; admin ADMIN criado direto via Prisma ou login do seed):
1. `POST /work-orders` com JWT de WORKER → **403**; sem token → 401.
2. Admin cria (2 responsáveis, 2 itens) → 201; `GET /work-orders/:id` → shape
   completo; notificação **criada** pros 2 (inline seam em test-env → síncrono;
   checar via Prisma `notification.findMany`).
3. Responsável A: `GET /journey/tasks` → vê os 2 itens; **worker
   não-responsável** → lista vazia e `GET tasks/:id` → **404**.
4. A: `start` item 1 → pai `in_progress`; `complete` item 1 → pai
   `in_progress`, `progressPct` 50 no list; B: `complete` item 2 → pai
   **`done`** (some da lista do worker — `status ≠ done`).
5. **Prova de concorrência** (FOR UPDATE): ordem com 2 itens, 2 completes
   simultâneos (`Promise.all`) → ambos 2xx e pai termina **`done`**.
6. `PATCH`: edita título, adiciona item (pai `done` → volta `in_progress` —
   Decisão C), remove item, troca responsáveis (novo notificado); tentar
   deixar 0 itens → 400.
7. Ordem **sem checklist** → auto-item aparece na jornada do responsável
   (Decisão B).
8. `GET /work-orders/assignable` → só APPROVED WORKERs.

`journey.e2e` (atualizar): `end` → item ativo fica **`paused`** (não done);
`cancel` → volta `pending` com `accumulatedSeconds` preservado e turno segue
`ongoing`; `complete` limpa `activeTaskId` mas `state` continua `ongoing`;
`photo` → imagem aparece em TODOS os itens da mesma ordem (images do pai).

**Steps:** `npm run test:e2e` → PASS (todas as suites).
**Commit**: `test(backend): e2e de WorkOrders + jornada re-baseada`.

---

### Task 6: mobile — seam + telas

**Files:** Modify `mobile/services/journey/types.ts`, `mockJourneyBackend.ts`
(+`.test.ts`), `apiJourneyBackend.ts` (+`.test.ts`), `JourneyProvider.tsx`,
`mobile/app/(app)/journey/task/[id].tsx`. **`journey/index.tsx` intocada.**

**Step 1 — `types.ts`:**
```ts
export interface Task {
  id: string;
  title: string;
  description: string;
  objective: string;              // ← order.summary (Decisão J)
  estimatedMinutes: number;       // rateio do pai
  status: TaskStatus;             // 4 estados — paused FICA (Decisão D)
  startedAt: string | null;
  accumulatedSeconds: number;
  progressPct: number;
  images: string[];               // ← imagens da ORDEM (Decisão F)
  responsibleCount: number;       // ← substituem interested* (responsáveis reais)
  responsibleNames: string[];
  responsibleAvatars: string[];
}
// assignedTo e scheduledDate REMOVIDOS.
export interface JourneyBackend {
  // ... 8 métodos existentes ...
  completeTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
  cancelTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
}
```

**Step 2 — mock (test-first):** testes novos em `mockJourneyBackend.test.ts`:
`completeTask` → done + progressPct 100 + activeTaskId null + state segue
ongoing; `cancelTask` → pending + tempo bancado; `endJourney` → ativa vira
**paused** (atualizar o teste existente que esperava done). Implementar:
seed interno vira 1 ordem-demo (campos compartilhados `objective`/`images`/
`responsible*` — avatares worker-1..5, 3 nomes demo) com os 4 itens de sempre
(120min cada); reducers `completeTask`/`cancelTask` (endAnchors/pauseAnchors);
`endJourney` troca `done`→`paused`.

**Step 3 — api (test-first):** `apiJourneyBackend.test.ts` cobre os 2 POSTs;
implementar:
```ts
completeTask(taskId) {
  return apiRequest<{ journey: JourneySession; task: Task }>(`/journey/tasks/${taskId}/complete`, { method: 'POST', auth: true });
},
cancelTask(taskId) {
  return apiRequest<{ journey: JourneySession; task: Task }>(`/journey/tasks/${taskId}/cancel`, { method: 'POST', auth: true });
},
```

**Step 4 — provider:** `completeTask`/`cancelTask` no context (padrão do
`startTask`: aplica `{ journey, task }` em session+tasks).

**Step 5 — `task/[id].tsx` (rewire das CTAs — Decisão A):**
- Substituir `finishOrCancel` por dois handlers:
```ts
const finishTask = async () => {  // "Finalizar tarefa" → conclui O ITEM; turno segue
  await completeTask(id ?? task.id);
  router.push('/(app)/journey');
};
const abandonTask = async () => { // "Cancelar tarefa" → larga sem concluir
  await cancelTask(id ?? task.id);
  router.push('/(app)/journey');
};
```
- Seção "Interessados" (label do Figma MANTIDO): `interestedAvatars` →
  `liveTask.responsibleAvatars` (alt = `responsibleNames[i]`), `totalCount` →
  `responsibleCount`, caption →
  `` `${liveTask.responsibleNames[0] ?? 'Joacir Alves'} e mais ${liveTask.responsibleCount - 1} pessoas estão acompanhando essa tarefa` ``.
- Nada mais muda (donut/barra/fotos/breadcrumb intocados).

**Step 6 — higiene:**
`git grep -n "assignedTo\|interestedCount\|interestedAvatars\|scheduledDate" -- mobile/services/journey "mobile/app/(app)/journey"`
→ vazio (lição da branch B: tsc/jest não pegam chave morta em `jest.mock`).

**Step 7:** `npx jest --silent` (todas verdes, contagem ≥ baseline) +
`npx tsc --noEmit` (8 baseline, 0 novos) + `npx expo export --platform web`
exit 0.
**Commit**: `feat(mobile): jornada consome WorkOrders — concluir/cancelar item + responsáveis reais`.

---

### Task 7: verificação integral + docker smoke + review (controller)

1. Backend: `npm run build` 0 / `npm test` / `npm run test:e2e` (2× pra flake).
2. Mobile: jest + tsc baseline + expo export.
3. **Docker smoke REAL** (rebuild da imagem):
```bash
cd swi-backend && docker compose up -d --build && docker compose exec api npx prisma db seed
# admin: JWT via POST /auth/login (admin@swi.local do seed)
# POST /work-orders {"title":"Smoke","responsibleIds":["<worker-id>"],"items":[{"title":"Item 1"},{"title":"Item 2"}]}
# worker: GET /journey/tasks (vê os 2) → start item1 → complete item1
# GET /work-orders?status=in_progress (progressPct 50) → complete item2 → status=done
# foto: presign prefix task/ → POST multipart MinIO → POST tasks/:id/photo → GET da URL nas images de AMBOS os itens da ordem → 200
# socket: worker conectado recebe `notification` domain=journey no create
# seed flagship: GET /journey/tasks do worker@swi.local → 4 itens + 1 card único (ordem sem checklist)
```
4. Two-gate spec+quality por unidade (ao longo) + **review holística** final.
5. Apresentar resultado ao usuário; **commits/PR só com luz verde explícita**.
   PR contra `main`, **sem rastros de IA** (sem Co-Authored-By / sem "Generated
   with Claude Code").

---

### Follow-ups deferidos (documentar no PR)

- UI do admin (`feat/admin-tarefas`): consome estes endpoints; bloqueada pela
  build vermelha do DS StatusChart; copy residual do Figma ("Salvar relatório",
  "…ao seu relatório" no modal) a reportar pro design.
- Deep-link `targetId` → tela da tarefa (herdado F5).
- Push do SO (hard-block deploy); cursor pagination real (diferido global).
- bloodType decorativo no modal (mock até a smartband — Decisão 2).
- Semântica pause/resume de item compartilhado (a MINHA pausa pausa o item
  ativo pra todos — aceito pro piloto; revisar se multi-worker simultâneo no
  MESMO item virar caso real).
