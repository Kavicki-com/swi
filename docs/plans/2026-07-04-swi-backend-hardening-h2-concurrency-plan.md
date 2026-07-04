# Hardening H2 (Correctness/concorrência) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar os 3 races de correctness do backend SWI — Chat TOCTOU, atomicidade da Journey e idempotência de start/resume — sem mudança de schema e sem tocar no mobile.

**Architecture:** Pure-backend NestJS + Prisma. T3 = guard idempotente na função pura de âncoras. T2 = `$transaction` interativo do Prisma nos 4 métodos de journey (task+journey commitam juntos). T1 = create-catch-P2002-refetch no chat (o banco arbitra a unicidade da conversa). Ordem: pura → journey → chat → e2e concorrente.

**Tech Stack:** NestJS 10, Prisma 5.22 (Postgres 16 via Docker), Jest + ts-jest (`maxWorkers: 50%`), supertest (e2e serial contra Postgres vivo).

**Design:** `docs/plans/2026-07-04-swi-backend-hardening-h2-concurrency-design.md`

**Convenções deste repo (não reinventar):**
- Rodar da pasta `swi-backend/`. Unit: `npm test -- <path>`. Full unit: `npm test`. e2e: `$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e` (precisa do Docker `db` de pé).
- Mocks de Prisma nos `*.service.spec.ts` são objetos `jest.fn()` por método (ver specs existentes). Sem `PrismaService` real no unit.
- `POST` de rota retorna **201** no e2e; login devolve `body.accessToken` → header `Authorization: Bearer <t>`.
- **Commit local por task** (mensagem sem rastros de IA). **Push/PR só com luz verde explícita do usuário.**

---

## Task 1: T3 — Idempotência de start/resume (`time-anchors.ts`)

Função pura, sem deps, primeiro. Guard: `start`/`resume` viram no-op quando já rodando (não re-ancoram, não perdem o segmento corrido).

**Files:**
- Modify: `swi-backend/src/journey/time-anchors.ts:20-28`
- Test: `swi-backend/src/journey/time-anchors.spec.ts`

**Step 1: Escrever os testes que falham**

Adicionar dentro do `describe` em `time-anchors.spec.ts` (após o caso de progressPct):

```ts
it('startAnchors já-rodando é no-op (não re-ancora, não perde o segmento)', () => {
  const running = { startedAt: T0, accumulatedSeconds: 10, running: true }
  const again = startAnchors(running, T0 + 300_000) // 5min depois, duplo-tap
  expect(again).toEqual(running)                     // âncora intacta → startedAt segue em T0
  expect(elapsedSeconds(again, T0 + 300_000)).toBe(310) // 10 banked + 300s corridos preservados
})

it('resumeAnchors já-rodando é no-op (idempotente)', () => {
  const running = { startedAt: T0, accumulatedSeconds: 40, running: true }
  expect(resumeAnchors(running, T0 + 120_000)).toEqual(running)
})

it('startAnchors parado→rodando ainda ancora (transição legítima)', () => {
  const stopped = { startedAt: null, accumulatedSeconds: 40, running: false }
  expect(startAnchors(stopped, T0)).toEqual({ startedAt: T0, accumulatedSeconds: 40, running: true })
})
```

**Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/journey/time-anchors.spec.ts`
Expected: FAIL — `startAnchors já-rodando` recebe `{ startedAt: T0+300_000, ... }` (re-ancorou), `elapsedSeconds` dá 10 (perdeu os 300s).

**Step 3: Implementar o guard**

Em `time-anchors.ts`, trocar as funções `startAnchors` e `resumeAnchors`:

```ts
export function startAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
export function resumeAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
```

**Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/journey/time-anchors.spec.ts`
Expected: PASS (todos, incl. os 3 casos existentes de start→pause→resume→end intactos — o guard só muda o caminho já-rodando).

**Step 5: Commit**

```bash
git add swi-backend/src/journey/time-anchors.ts swi-backend/src/journey/time-anchors.spec.ts
git commit -m "fix(backend): start/resume idempotentes (no-op quando ja rodando; nao perde tempo corrido)"
```

---

## Task 2: T2 — Atomicidade da Journey (`journey.service.ts`)

Envolver os pares task+journey de `startTask`/`pauseJourney`/`resumeJourney`/`endJourney` num `$transaction` interativo. `getOrCreateToday`/`findMyTask` passam a aceitar um client opcional (default `this.prisma`) pra rodar dentro ou fora da tx. DTOs (presign) ficam FORA da tx.

**Files:**
- Modify: `swi-backend/src/journey/journey.service.ts`
- Test: `swi-backend/src/journey/journey.service.spec.ts`

**Step 1: Ajustar o mock de Prisma pra suportar `$transaction`**

No topo do `journey.service.spec.ts`, trocar o factory `prisma` por um que exponha `$transaction` que invoca o callback com o próprio mock (tx === db → os mocks existentes seguem valendo):

```ts
const prisma = () => {
  const db: any = {
    journey: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    task: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  }
  db.$transaction = jest.fn(async (cb: any) => cb(db))
  return db
}
```

**Step 2: Escrever os testes que falham**

Adicionar ao `describe('JourneyService')`:

```ts
it('startTask roda os 2 writes dentro de uma única transação', async () => {
  const db = prisma()
  db.task.findFirst.mockResolvedValue(taskRow())
  db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
  db.journey.upsert.mockResolvedValue(journeyRow())
  db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
  await new JourneyService(db, media()).startTask('u1', 't1')
  expect(db.$transaction).toHaveBeenCalledTimes(1)
})

it('startTask: falha no 2º write (journey.update) propaga — não engole', async () => {
  const db = prisma()
  db.task.findFirst.mockResolvedValue(taskRow())
  db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
  db.journey.upsert.mockResolvedValue(journeyRow())
  db.journey.update.mockRejectedValue(new Error('db down no 2º write'))
  await expect(new JourneyService(db, media()).startTask('u1', 't1')).rejects.toThrow(/db down/)
})
```

**Step 3: Rodar e confirmar que falha**

Run: `npm test -- src/journey/journey.service.spec.ts`
Expected: FAIL — `db.$transaction` não é chamado (0×), pois o serviço ainda faz writes soltos.

**Step 4: Implementar as transações**

Em `journey.service.ts`:

(a) adicionar o import do namespace `Prisma` e um alias de client:

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { Prisma } from '@prisma/client'
import type { Journey, Task } from '@prisma/client'
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, progressPct, type Anchors } from './time-anchors'

type Db = PrismaService | Prisma.TransactionClient
```

(b) dar client opcional aos helpers:

```ts
private async getOrCreateToday(workerId: string, db: Db = this.prisma): Promise<Journey> {
  const date = this.today()
  return db.journey.upsert({
    where: { workerId_date: { workerId, date } },
    update: {},
    create: { workerId, date, state: 'idle', accumulatedSeconds: 0 },
  })
}

private async findMyTask(workerId: string, id: string, db: Db = this.prisma): Promise<Task | null> {
  return db.task.findFirst({ where: { id, assignedTo: workerId } })
}
```

(c) `startTask` — tx envolve os writes; DTO fora:

```ts
async startTask(workerId: string, taskId: string) {
  const now = Date.now()
  const { savedTask, savedJourney } = await this.prisma.$transaction(async (tx) => {
    const task = await this.findMyTask(workerId, taskId, tx)
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    const ta = startAnchors(this.taskAnchors(task), now)
    const savedTask = await tx.task.update({
      where: { id: task.id },
      data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
    })
    const journey = await this.getOrCreateToday(workerId, tx)
    const ja = startAnchors(this.journeyAnchors(journey), now)
    const savedJourney = await tx.journey.update({
      where: { id: journey.id },
      data: { state: 'ongoing', activeTaskId: taskId, startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
    return { savedTask, savedJourney }
  })
  return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
}
```

(d) `pauseJourney` — tx envolve o par; DTO fora:

```ts
async pauseJourney(workerId: string) {
  const now = Date.now()
  const saved = await this.prisma.$transaction(async (tx) => {
    const journey = await this.getOrCreateToday(workerId, tx)
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
      if (active) {
        const ta = pauseAnchors(this.taskAnchors(active), now)
        await tx.task.update({
          where: { id: active.id },
          data: {
            status: 'paused', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
            progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
          },
        })
      }
    }
    const ja = pauseAnchors(this.journeyAnchors(journey), now)
    return tx.journey.update({
      where: { id: journey.id },
      data: { state: 'paused', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
  })
  return this.journeyToDto(saved)
}
```

(e) `resumeJourney` — mesma forma:

```ts
async resumeJourney(workerId: string) {
  const now = Date.now()
  const saved = await this.prisma.$transaction(async (tx) => {
    const journey = await this.getOrCreateToday(workerId, tx)
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
      if (active) {
        const ta = resumeAnchors(this.taskAnchors(active), now)
        await tx.task.update({
          where: { id: active.id },
          data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
        })
      }
    }
    const ja = resumeAnchors(this.journeyAnchors(journey), now)
    return tx.journey.update({
      where: { id: journey.id },
      data: { state: 'ongoing', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
  })
  return this.journeyToDto(saved)
}
```

(f) `endJourney` — mesma forma:

```ts
async endJourney(workerId: string) {
  const now = Date.now()
  const saved = await this.prisma.$transaction(async (tx) => {
    const journey = await this.getOrCreateToday(workerId, tx)
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
      if (active) {
        const ta = endAnchors(this.taskAnchors(active), now)
        await tx.task.update({
          where: { id: active.id },
          data: {
            status: 'done', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
            progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
          },
        })
      }
    }
    return tx.journey.update({
      where: { id: journey.id },
      data: { state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 },
    })
  })
  return this.journeyToDto(saved)
}
```

> `getJourney`/`listTasks`/`getTask`/`addTaskPhoto` ficam **inalterados** (leitura ou write único — não precisam de tx). `addTaskPhoto` é um único `task.update`, atômico por si.

**Step 5: Rodar e confirmar que passa**

Run: `npm test -- src/journey/journey.service.spec.ts`
Expected: PASS (os 2 novos + todos os existentes — as asserções em `db.task.update`/`db.journey.update` seguem porque tx === db no mock).

**Step 6: Typecheck**

Run: `npm run build`
Expected: 0 erros (o alias `Db` e o import `Prisma` resolvem; `this.iso`/anchors intactos).

**Step 7: Commit**

```bash
git add swi-backend/src/journey/journey.service.ts swi-backend/src/journey/journey.service.spec.ts
git commit -m "fix(backend): journey start/pause/resume/end atomicos ($transaction task+journey)"
```

---

## Task 3: T1 — Chat TOCTOU (`chat.service.ts`)

Envolver a criação lazy da conversa em try/catch-P2002-refetch. `P2002` (unique no id) = "outro request criou no meio-tempo" → re-busca e segue. `NotFoundException` (user inexistente) **não** é P2002 → re-lança (404 intacto).

**Files:**
- Modify: `swi-backend/src/chat/chat.service.ts:1-6` (import) e `:55-56` (create lazy)
- Test: `swi-backend/src/chat/chat.service.spec.ts`

**Step 1: Escrever o teste que falha**

No topo de `chat.service.spec.ts`, adicionar ao import: `import { Prisma } from '@prisma/client'`. Depois, adicionar ao `describe('ChatService')`:

```ts
it('sendMessage: create concorrente que colide (P2002) re-busca a conv, não 500', async () => {
  const db = prisma()
  // 1ª findUnique (início) → null; 2ª (após P2002) → conv já criada pelo request rival
  db.conversation.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(convRow({ unreadByJson: {} }))
  db.user.findMany.mockResolvedValue([userRow(A), userRow(B)])
  db.conversation.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5.22.0' }),
  )
  db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'novo' }))
  db.conversation.update.mockResolvedValue(convRow())
  const out = await new ChatService(db, media(), realtime(), notifications()).sendMessage(A, CONV, { body: 'novo' })
  expect(out.body).toBe('novo')
  expect(db.conversation.findUnique).toHaveBeenCalledTimes(2) // re-buscou após a colisão
})
```

> O caso existente "criaria conversa com participante inexistente → 404" já cobre o re-lançamento do `NotFoundException` (não-P2002). Confirmar que segue verde após o fix.

**Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/chat/chat.service.spec.ts`
Expected: FAIL — o `P2002` do `create` sobe sem tratamento → o teste vê a exceção em vez do envio ok.

**Step 3: Implementar o catch-P2002-refetch**

(a) trocar o import de tipos por um que também traga o **valor** `Prisma` (pro `instanceof`):

```ts
import { Prisma } from '@prisma/client'
import type { Conversation, Message, User, Profile } from '@prisma/client'
```

(b) trocar `chat.service.ts:55-56`:

```ts
let conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
if (!conv) {
  try {
    conv = await this.createConversation(convId, participants)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Outro request criou a conversa entre o findUnique e o create → re-busca.
      conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
      if (!conv) throw e // P2002 sem linha visível: não engolir silenciosamente.
    } else {
      throw e // NotFoundException (user inexistente) e afins seguem propagando.
    }
  }
}
```

**Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/chat/chat.service.spec.ts`
Expected: PASS (o novo caso + os 12 existentes, incl. o 404 de participante inexistente e o create-lazy feliz).

**Step 5: Typecheck**

Run: `npm run build`
Expected: 0 erros.

**Step 6: Commit**

```bash
git add swi-backend/src/chat/chat.service.ts swi-backend/src/chat/chat.service.spec.ts
git commit -m "fix(backend): chat conversa lazy race-safe (catch P2002 + refetch; nao 500)"
```

---

## Task 4: e2e concorrente (chat 2-sends, journey duplo-start)

Provar as invariantes contra Postgres vivo: 2 primeiras mensagens simultâneas = nenhum 500 + 1 conversa; duplo-start = `startedAt` não re-ancora (idempotente) e task+journey ficam consistentes (atomicidade).

**Files:**
- Modify: `swi-backend/test/chat.e2e-spec.ts`
- Modify: `swi-backend/test/journey.e2e-spec.ts`

**Pré-requisito:** Docker `db` de pé + `DATABASE_URL` no ambiente (ver convenções no topo).

**Step 1: Caso concorrente no chat**

Adicionar ao `describe('Chat e2e')`, após o teste de `sendMessage cria a conversa`:

```ts
it('2 primeiras mensagens concorrentes não dão 500 e convergem em 1 conversa', async () => {
  // Zera a conversa pra forçar o caminho de criação lazy sob corrida.
  await prisma.message.deleteMany({ where: { conversationId: convId } })
  await prisma.notification.deleteMany({ where: { workerId: { in: [idA, idB] } } })
  await prisma.conversation.deleteMany({ where: { id: convId } })
  const tA = await login(eA), tB = await login(eB)
  const send = (t: string, body: string) =>
    request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${t}` }).send({ body })
  const [rA, rB] = await Promise.all([send(tA, 'corrida A'), send(tB, 'corrida B')])
  // Invariante: nenhum 500 (aceita 201 nos dois — o perdedor da corrida re-busca e anexa).
  expect([rA.status, rB.status]).toEqual([201, 201])
  const convs = await prisma.conversation.findMany({ where: { id: convId } })
  expect(convs).toHaveLength(1) // exatamente 1 conversa, sem duplicata
  const { body: msgs } = await request(app.getHttpServer()).get(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).expect(200)
  expect(msgs.map((m: any) => m.body).sort()).toEqual(['corrida A', 'corrida B']) // ambas persistiram
})
```

**Step 2: Caso idempotente no journey**

Adicionar ao `describe('Journey e2e')`, após o `lifecycle`:

```ts
it('duplo-start é idempotente: não re-ancora startedAt e mantém task+journey consistentes', async () => {
  const auth = await login()
  const { body: s1 } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/start`).set(auth).expect(201)
  const { body: s2 } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/start`).set(auth).expect(201)
  // Idempotência: o 2º start (já rodando) NÃO move o startedAt → sem perda de tempo corrido.
  expect(s2.task.startedAt).toBe(s1.task.startedAt)
  expect(s2.journey.startedAt).toBe(s1.journey.startedAt)
  // Atomicidade: os dois lados batem (task in_progress ⇔ journey ongoing no mesmo task).
  expect(s2.task.status).toBe('in_progress')
  expect(s2.journey.state).toBe('ongoing')
  expect(s2.journey.activeTaskId).toBe(taskId)
  await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201) // limpa o estado
})
```

**Step 3: Rodar os e2e (Docker db up + DATABASE_URL)**

Run:
```powershell
$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e
```
Expected: PASS — todas as suites (baseline de `main` = **31/7** + os 2 casos novos), sem 500, `startedAt` igual entre os dois starts.

**Step 4: Commit**

```bash
git add swi-backend/test/chat.e2e-spec.ts swi-backend/test/journey.e2e-spec.ts
git commit -m "test(backend): e2e concorrente — chat 2-sends sem 500 + journey duplo-start idempotente"
```

---

## Task 5: Gate + docker smoke + PR (controller)

**Step 1: Gate unit completo (com o cap maxWorkers)**

Run: `npm test`
Expected: PASS — todas as suites verdes, sem SIGTERM (cap `maxWorkers: 50%` já está em `main`).

**Step 2: Gate build**

Run: `npm run build`
Expected: 0 erros.

**Step 3: Confirmar zero-mobile**

Run: `git diff --name-only main...feat/backend-hardening-h2`
Expected: só arquivos sob `swi-backend/` + `docs/plans/`. **Nenhum** `mobile/`. (Sendo zero-mobile, o gate mobile tsc/jest/expo não precisa rodar — apenas confirmar que nada mobile mudou.)

**Step 4: Docker smoke (rebuild na branch H2)**

```powershell
# estar na branch feat/backend-hardening-h2 (o rebuild builda o checkout atual)
docker compose -f swi-backend/docker-compose.yml up --build -d api
```
Provar manualmente (2 tokens de worker):
- 2 `POST /chat/conversations/<conv>/messages` quase simultâneos entre 2 workers numa conversa nova → ambos 200/201, `GET` mostra 1 conversa e as 2 mensagens.
- `POST /journey/tasks/<id>/start` 2× seguido → `startedAt` idêntico; `pause` depois banca o tempo esperado (não zera).

**Step 5: AI-trace scan**

Run: `git log main..feat/backend-hardening-h2 --format='%an|%cn|%B'` e confirmar: sem `Co-Authored-By: Claude`, sem "Generated with Claude Code".

**Step 6: Preparar corpo do PR** em `<scratchpad>/pr-body-h2.md` (não abrir ainda).

**Step 7: PARAR e reportar ao usuário.** Push/PR/merge **só com luz verde explícita**. Apresentar: gate (build/unit/e2e), docker smoke, diff zero-mobile, review holística.

---

## Notas de execução

- **Subagent-driven:** Tasks 1-4 = implementer (general-purpose) por task → spec-reviewer → code-quality (superpowers:code-reviewer). Task 5 = controller (eu): gate + docker smoke + review holística + preparar PR.
- **TDD estrito:** cada task escreve o teste que falha ANTES da implementação; roda e vê falhar; implementa o mínimo; roda e vê passar.
- **DRY/YAGNI:** sem locking pessimista, sem retry-com-backoff, sem filas — catch-P2002 + `$transaction` + guard cobrem os casos reais do piloto.
- **Deferido pro H3:** timing de enumeração (forgot/confirm/reset/signup), validação de data do Perfil, Notif fila, Reports paginação.
