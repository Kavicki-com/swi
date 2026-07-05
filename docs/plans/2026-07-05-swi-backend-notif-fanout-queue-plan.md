# Fan-out de notificações via fila (pg-boss) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) to implement this plan task-by-task.
>
> Doc **temporário** (`docs/plans/*backend*`). Design irmão: `2026-07-05-swi-backend-notif-fanout-queue-design.md`.

**Goal:** Tirar o fan-out de notificações (`createForMany`) do request path, roteando-o por uma fila durável pg-boss (Postgres) processada por um worker in-process — sem tocar mobile/admin.

**Architecture:** Novo `QueueService` (pg-boss) com um **inline test-seam** (`NODE_ENV==='test'` → roda o handler síncrono, preservando o determinismo dos e2e). `NotificationService.enqueueForMany` enfileira `notifications.fanout` {workerIds,payload}; o worker handler reusa o `createForMany` existente. Os 3 callers (reports/chat/weather) trocam `await createForMany` por `await enqueueForMany`. Branch `feat/backend-notif-fanout-queue` de `main`@`9477ba9`.

**Tech Stack:** NestJS 10 + Prisma 5 + Postgres 16 + **pg-boss** (fila em Postgres), Jest.

---

## Convenções de comando (de `swi-backend/`)

- `npm run build` (exit 0); `npx jest <padrão>`; suíte `npm test`; e2e `DATABASE_URL='postgresql://swi:swi@localhost:5432/swi' npm run test:e2e` (Docker db up + migrate).
- Docker: `docker compose up --build -d api` (rebuild). git de fora de `swi-backend/`: `git -C <repo-root>`.
- NUNCA rastros de IA. **Commit local por task É autorizado** (modo subagent-driven; só push/PR pede luz verde).

## ⚠️ Caveat pg-boss (API muda por major)

A API do pg-boss difere entre versões: **v10** exige `boss.createQueue(name)` antes de `send`/`work`, e o handler de `work` recebe um **array** de jobs (`async (jobs) => ...`). **v9** não tem `createQueue` e o handler recebe **1 job** (`async (job) => ...`). **Confira a major instalada** (`npm ls pg-boss`) e siga a API dela. O código abaixo é pra **v10** (atual); o `QueueService` encapsula a diferença — se cair na v9, ajuste só o interior de `registerWorker`/`enqueue` (sem `createQueue`, handler single).

---

## Task 1: `QueueModule` / `QueueService` (pg-boss + inline test-seam)

**Files:**
- Create: `swi-backend/src/queue/queue.service.ts`
- Create: `swi-backend/src/queue/queue.module.ts`
- Create: `swi-backend/src/queue/queue.service.spec.ts`
- Modify: `swi-backend/package.json` (dep via `npm install`)

**Step 1: instalar** — de `swi-backend/`: `npm install pg-boss`. Rode `npm ls pg-boss` e anote a major (pro caveat acima). Confirmar em `dependencies`.

**Step 2 (TDD): teste** — `swi-backend/src/queue/queue.service.spec.ts`. Testa o **inline seam** (em test-env, `enqueue` roda o handler registrado) sem tocar pg-boss:
```ts
import { QueueService } from './queue.service'

describe('QueueService (inline test-seam, NODE_ENV=test)', () => {
  it('enqueue roda o handler registrado inline (sem pg-boss)', async () => {
    const svc = new QueueService()
    const seen: any[] = []
    await svc.registerWorker('job.x', async (data) => { seen.push(data) })
    await svc.enqueue('job.x', { a: 1 })
    expect(seen).toEqual([{ a: 1 }])
  })
  it('enqueue sem handler registrado é no-op (não lança)', async () => {
    const svc = new QueueService()
    await expect(svc.enqueue('nada', { a: 1 })).resolves.toBeUndefined()
  })
})
```
(`process.env.NODE_ENV` já é `test` sob jest.) Rode `npx jest queue.service` → **FAIL** (módulo não existe).

**Step 3: implementar** — `swi-backend/src/queue/queue.service.ts` (API v10; ver caveat):
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import PgBoss from 'pg-boss'

type Handler = (data: any) => Promise<void>

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QueueService.name)
  private boss: PgBoss | null = null
  private readonly handlers = new Map<string, Handler>()
  private readonly inline = process.env.NODE_ENV === 'test' // seam: roda inline nos testes

  async onModuleInit() {
    if (this.inline) return // sem pg-boss em test-env (determinismo dos e2e)
    this.boss = new PgBoss(process.env.DATABASE_URL as string)
    this.boss.on('error', (e) => this.log.error(`pg-boss: ${e.message}`))
    await this.boss.start()
    // re-wire handlers registrados antes do start (se houver)
    for (const [name, handler] of this.handlers) await this.wire(name, handler)
  }

  async onModuleDestroy() {
    if (this.boss) await this.boss.stop({ graceful: true })
  }

  // Registra o worker de um job. Chamado no boot (ex.: NotificationService.onModuleInit).
  async registerWorker(name: string, handler: Handler) {
    this.handlers.set(name, handler)
    if (this.boss) await this.wire(name, handler) // se o boss já subiu
  }

  private async wire(name: string, handler: Handler) {
    await this.boss!.createQueue(name) // v10: idempotente
    await this.boss!.work(name, async (jobs: PgBoss.Job[]) => {
      for (const job of jobs) await handler(job.data)
    })
  }

  async enqueue(name: string, data: any): Promise<void> {
    if (this.inline || !this.boss) {
      const h = this.handlers.get(name)
      if (h) await h(data) // inline: roda o handler síncrono
      return
    }
    await this.boss.send(name, data, { retryLimit: 2, retryBackoff: true })
  }
}
```
`swi-backend/src/queue/queue.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { QueueService } from './queue.service'

@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
```
Rode `npx jest queue.service` → **PASS**.

**Step 4: registrar no AppModule** — `swi-backend/src/app.module.ts`: adicionar `QueueModule` aos `imports`.

**Step 5: build + unit** — `npm run build` (0) e `npm test` (verde, +2 casos).

**Step 6: commit**
```bash
git add swi-backend/
git commit -m "feat(backend): QueueService (pg-boss) com inline test-seam"
```

---

## Task 2: `NotificationService.enqueueForMany` + worker handler

**Files:**
- Modify: `swi-backend/src/notifications/notification.service.ts`
- Modify: `swi-backend/src/notifications/notification.module.ts` (importar `QueueModule`)
- Modify: `swi-backend/src/notifications/notification.service.spec.ts`

**Step 1 (TDD): teste** — em `notification.service.spec.ts`, um caso novo: `enqueueForMany` enfileira o job `notifications.fanout` com `{workerIds, payload}`:
```ts
it('enqueueForMany enfileira o job notifications.fanout', async () => {
  const db = prisma(); const rt = realtime()
  const queue = { enqueue: jest.fn(), registerWorker: jest.fn() } as any
  const svc = new NotificationService(db, rt, queue)
  const payload = { domain: 'reports', title: 'X' } as any
  await svc.enqueueForMany(['a', 'b'], payload)
  expect(queue.enqueue).toHaveBeenCalledWith('notifications.fanout', { workerIds: ['a', 'b'], payload })
})
```
(Ajuste os `new NotificationService(db, rt)` existentes pra passar um `queue` mock — ver Step 3.) Rode `npx jest notification.service` → **FAIL**.

**Step 2: implementar** — `notification.service.ts`:
- Injetar `QueueService` no construtor (3º param): `private readonly queue: QueueService`.
- Constante do nome do job: `const FANOUT_JOB = 'notifications.fanout'`.
- Registrar o worker no boot (implementar `OnModuleInit`):
```ts
async onModuleInit() {
  await this.queue.registerWorker(FANOUT_JOB, async (data: { workerIds: string[]; payload: NotificationPayload }) => {
    await this.createForMany(data.workerIds, data.payload)
  })
}
```
- Novo método:
```ts
async enqueueForMany(workerIds: string[], payload: NotificationPayload): Promise<void> {
  await this.queue.enqueue(FANOUT_JOB, { workerIds, payload })
}
```
`createFor`/`createForMany`/`list`/`markRead`/`markAllRead` **intactos** (o handler reusa `createForMany`).

**Step 3: NotificationModule** — importar `QueueModule` em `notification.module.ts` (pra o `QueueService` estar disponível). Ajustar os specs existentes: onde instanciam `new NotificationService(db, rt)`, passar um 3º arg `queue` mock (`{ enqueue: jest.fn(), registerWorker: jest.fn() }`). Os testes de `createFor`/`createForMany` seguem válidos (não usam a fila).

**Step 4: build + unit** — `npm run build` (0), `npm test` (verde).

**Step 5: commit**
```bash
git add swi-backend/
git commit -m "feat(backend): NotificationService.enqueueForMany + worker handler (reusa createForMany)"
```

---

## Task 3: Repoint dos 3 callers (reports/chat/weather)

**Files:**
- Modify: `swi-backend/src/reports/reports.service.ts:53`
- Modify: `swi-backend/src/chat/chat.service.ts:106`
- Modify: `swi-backend/src/weather/weather-alert.service.ts:32`
- Modify: specs `reports.service.spec.ts`, `chat.service.spec.ts`, `weather-alert.service.spec.ts`

**Step 1: repoint** — em cada caller, trocar `await this.notifications.createForMany(<ids>, {...})` por `await this.notifications.enqueueForMany(<ids>, {...})`. Mesma lista de recipients, mesmo payload; só o método muda (enfileira em vez de fan-out inline). O `findMany(others)` do reports **fica** (query barata no request). Os try/catch best-effort **ficam**.

**Step 2: atualizar specs** — os specs que hoje assertam `createForMany` no caller passam a assertar `enqueueForMany` (mesmos args):
- `reports.service.spec.ts:92` → `expect(notif.enqueueForMany).toHaveBeenCalledWith(['w2','w3'], expect.objectContaining({...}))` (+ trocar o mock `createForMany: jest.fn()` por `enqueueForMany: jest.fn()` no factory `notifications()`, linha ~9; manter `createForMany` se algum outro teste usar).
- `chat.service.spec.ts:140` → `enqueueForMany` (+ o factory `notifications()` linha ~9 ganha `enqueueForMany: jest.fn()`).
- `weather-alert.service.spec.ts:24` → `enqueueForMany` (+ o mock `createForMany` do `mk()` linha ~6 vira `enqueueForMany`).
- Os casos de "best-effort: fan-out rejeita → write sobrevive" (`reports.spec:101`, `chat.spec:150`) passam a mockar `enqueueForMany.mockRejectedValue` (ou `.mockImplementation(() => { throw })`).

**Step 3: build + unit** — `npm run build` (0), `npm test` (verde — todos os specs de caller atualizados).

**Step 4: commit**
```bash
git add swi-backend/
git commit -m "refactor(backend): reports/chat/weather enfileiram o fan-out (enqueueForMany) em vez de createForMany inline"
```

---

## Task 4: Verificação + docker smoke + PR (controller = eu)

**Step 1: gate** — backend build 0 / unit / e2e (`DATABASE_URL=... npm run test:e2e`, 8 suites verdes — o inline-seam mantém o determinismo). Zero mobile/admin (`git diff --stat main..HEAD -- mobile/ swi-admin/` VAZIO).

**Step 2: docker smoke REAL (rebuild)** — `docker compose up --build -d api` (NODE_ENV unset → **pg-boss real**, async). Com JWT do worker seedado:
- `POST /reports` (como worker) → **retorna rápido**; então em <2s **os OUTROS workers têm a notif** (`GET /notifications` de outro worker mostra a 'reports' nova) → prova o **fan-out async ao vivo** via pg-boss.
- Verificar que o pg-boss processou: opcional, checar o schema `pgboss` (`docker compose exec -T db psql ... -c "select name,state from pgboss.job order by createdon desc limit 5"`) → job `notifications.fanout` = `completed`.
- **Durabilidade (prova mais forte, opcional):** enfileirar (criar report) e **restart do container api** (`docker compose restart api`); confirmar que jobs pendentes ainda processam (sobrevivem ao restart) — o "durável".
- Scan de rastros de IA + zero-mobile/admin.

**Step 3: review holística** + fixes Critical/Important (amend/commit focado).

**Step 4: PR** — só com luz verde explícita (corpo em `<scratchpad>/pr-body-fanout-queue.md`).

---

## Ordem de execução (subagent-driven)

| Task | Escopo | Isolamento |
| --- | --- | --- |
| 1 | QueueModule/QueueService (pg-boss + inline seam) | Isolada (`src/queue/` + app.module import) |
| 2 | NotificationService.enqueueForMany + worker | Isolada (`src/notifications/`) |
| 3 | Repoint 3 callers + specs | Isolada (reports/chat/weather services) |
| 4 | Gate + docker smoke + PR | Controller (eu) |

Tasks 1-3 = implementer + **two-gate** (spec + quality). Commit local por task; **push/PR só com luz verde, sem rastros de IA**.

## Diferido que continua

Cursor pagination real (a outra fatia pós-H3, quebrante backend+mobile).
