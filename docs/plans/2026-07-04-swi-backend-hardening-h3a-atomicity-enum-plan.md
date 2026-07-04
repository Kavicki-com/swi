# Hardening H3a (atomicidade restante + enumeration timing) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar a atomicidade que sobrou do H2 (`unreadByJson` do chat + `addTaskPhoto` da journey) e o timing de enumeração deferido do H1 (`confirm`/`reset`/`forgot` + `@Throttle` no signup), sem mudança de schema e sem tocar o mobile.

**Architecture:** Pure-backend NestJS + Prisma. Atomicidade single-row: `unreadByJson` via `$executeRaw` (`jsonb_set` — Prisma não tem increment de jsonb) e `imageKeys` via `{ push }` nativo (`array_append`). Enumeration: espelha o fix de login do H1 (sempre 1 bcrypt via `DUMMY_HASH`; trabalho dummy no `forgot`; `@Throttle` no signup). Ordem: journey → chat → auth → e2e.

**Tech Stack:** NestJS 10, Prisma 5.22 (Postgres 16 jsonb + text[]), Jest + ts-jest (`maxWorkers: 50%`), supertest (e2e serial).

**Design:** `docs/plans/2026-07-04-swi-backend-hardening-h3a-atomicity-enum-design.md`

**Convenções (não reinventar):**
- Rodar de `swi-backend/`. Unit: `npm test -- <path>`. Full: `npm test`. e2e: `$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e` (Docker `db` de pé).
- Mocks de Prisma nos `*.service.spec.ts` = objetos `jest.fn()` por método.
- `import bcrypt from 'bcrypt'` (default — `import *` quebra o `spyOn` no ts-jest, lição do H1). `DUMMY_HASH`/`hash`/`verifyHash` já existem em `src/auth/codes.ts`.
- **Commit local por task**, sem rastros de IA. **Push/PR só com luz verde explícita.**

---

## Task 1: `addTaskPhoto` atômico (`journey.service.ts`)

Trocar o RMW `[...task.imageKeys, imageKey]` pelo `{ push }` nativo do Prisma (compila pra `array_append` atômico). Mantém o `findMyTask` (404 de ownership).

**Files:**
- Modify: `swi-backend/src/journey/journey.service.ts:138-146` (`addTaskPhoto`)
- Test: `swi-backend/src/journey/journey.service.spec.ts` (o caso `addTaskPhoto faz append...`)

**Step 1: Ajustar o teste existente + adicionar asserção do push**

No `journey.service.spec.ts`, **substituir** o teste `addTaskPhoto faz append da key e presigna na volta` por:

```ts
it('addTaskPhoto usa push atômico (array_append) e presigna na volta', async () => {
  const db = prisma()
  db.task.findFirst.mockResolvedValue(taskRow({ imageKeys: ['task/a.jpg'] }))
  // o mock resolve o push pra o array final (o DB faz o append real)
  db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), imageKeys: ['task/a.jpg', data.imageKeys.push] }))
  const out = await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')
  expect(db.task.update.mock.calls[0][0].data.imageKeys).toEqual({ push: 'task/b.jpg' }) // atômico, não spread
  expect(out.images).toEqual(['signed:task/a.jpg', 'signed:task/b.jpg'])
})
```

**Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/journey/journey.service.spec.ts`
Expected: FAIL — hoje `data.imageKeys` é o array spread `['task/a.jpg','task/b.jpg']`, não `{ push: 'task/b.jpg' }`.

**Step 3: Implementar o push atômico**

Em `journey.service.ts`, trocar o corpo de `addTaskPhoto`:

```ts
async addTaskPhoto(workerId: string, taskId: string, imageKey: string) {
  const task = await this.findMyTask(workerId, taskId)
  if (!task) throw new NotFoundException('Tarefa não encontrada')
  const saved = await this.prisma.task.update({
    where: { id: task.id },
    data: { imageKeys: { push: imageKey } },   // array_append atômico (era [...task.imageKeys, imageKey])
  })
  return this.taskToDto(saved)
}
```

**Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/journey/journey.service.spec.ts`
Expected: PASS (o caso ajustado + todos os existentes — start/pause/resume/end intactos).

**Step 5: Typecheck**

Run: `npm run build` — 0 erros.

**Step 6: Commit**

```bash
git add swi-backend/src/journey/journey.service.ts swi-backend/src/journey/journey.service.spec.ts
git commit -m "fix(backend): addTaskPhoto atomico (push/array_append; nao read-modify-write)"
```

---

## Task 2: `unreadByJson` atômico (`chat.service.ts`)

Trocar o RMW do `conversation.update` (contador de não-lidas) por `$executeRaw` `jsonb_set` atômico em `sendMessage` e `markRead`. Conversa é 2-party → 1 destinatário.

**Files:**
- Modify: `swi-backend/src/chat/chat.service.ts` (`sendMessage` `:62-68`, `markRead` `:90-95`)
- Test: `swi-backend/src/chat/chat.service.spec.ts`

**Step 1: Ajustar o mock e reescrever os 2 testes que assertavam `conversation.update`**

(a) No factory `prisma()` do `chat.service.spec.ts`, adicionar `$executeRaw`:

```ts
const prisma = () => ({
  conversation: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { findMany: jest.fn(), create: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(1),
}) as any
```

(b) **Substituir** `sendMessage anexa e incrementa unread do destinatário` por (agora o incremento é SQL-side → o unit prova que o statement atômico é emitido pro destinatário certo, o e2e prova o acúmulo):

```ts
it('sendMessage emite UPDATE atômico do unread pro destinatário (não conversation.update)', async () => {
  const db = prisma()
  db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { bbbb: 1 } }))
  db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
  await new ChatService(db, media(), realtime(), notifications()).sendMessage(A, CONV, { body: 'e aí' })
  expect(db.$executeRaw).toHaveBeenCalledTimes(1)
  const params = db.$executeRaw.mock.calls[0]        // [templateStrings, ...values]
  expect(params).toContain(B)                        // destinatário (não-remetente)
  expect(params).toContain(CONV)                     // a conversa certa
  expect(db.conversation.update).not.toHaveBeenCalled() // RMW eliminado
})
```

(c) **Substituir** `markRead zera meu unread (membership ok)` por:

```ts
it('markRead zera meu unread via UPDATE atômico (membership ok)', async () => {
  const db = prisma()
  db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { aaaa: 5, bbbb: 1 } }))
  await new ChatService(db, media(), realtime(), notifications()).markRead(A, CONV)
  expect(db.$executeRaw).toHaveBeenCalledTimes(1)
  expect(db.$executeRaw.mock.calls[0]).toContain(A)   // zera o MEU contador
  expect(db.conversation.update).not.toHaveBeenCalled()
})
```

> Os demais testes (create-lazy, P2002-refetch, notif best-effort, id não-canônico, 404s) já mockam o suficiente; só precisam do `$executeRaw` no factory (adicionado em (a)). Confirmar que seguem verdes.

**Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/chat/chat.service.spec.ts`
Expected: FAIL — hoje `sendMessage`/`markRead` chamam `conversation.update` e nunca `$executeRaw`.

**Step 3: Implementar o `$executeRaw` atômico**

Em `chat.service.ts`, no `sendMessage`, **trocar** o bloco que hoje é:
```ts
const unread = this.unreadOf(conv)
for (const p of conv.participants) if (p !== userId) unread[p] = (unread[p] ?? 0) + 1
await this.prisma.conversation.update({
  where: { id: convId },
  data: { lastMessageBody: dto.body || (dto.imageKey ? '📷 Imagem' : ''), lastMessageAt: now, unreadByJson: unread },
})
```
por:
```ts
// Conversa é 2-party → exatamente 1 destinatário (o participante ≠ remetente).
const recipientId = conv.participants.find((p) => p !== userId)!
const lastBody = dto.body || (dto.imageKey ? '📷 Imagem' : '')
// UPDATE atômico: incrementa o contador do destinatário sem read-modify-write (fecha o lost-update).
await this.prisma.$executeRaw`
  UPDATE "Conversation"
  SET "lastMessageBody" = ${lastBody},
      "lastMessageAt"   = ${now},
      "unreadByJson"    = jsonb_set(
        COALESCE("unreadByJson", '{}'::jsonb),
        ARRAY[${recipientId}],
        to_jsonb(COALESCE(("unreadByJson"->>${recipientId})::int, 0) + 1),
        true)
  WHERE id = ${convId}`
```

No `markRead`, **trocar**:
```ts
const conv = await this.assertMember(userId, convId)
const unread = this.unreadOf(conv)
unread[userId] = 0
await this.prisma.conversation.update({ where: { id: convId }, data: { unreadByJson: unread } })
```
por:
```ts
await this.assertMember(userId, convId)   // membership → 404 se não-membro
await this.prisma.$executeRaw`
  UPDATE "Conversation"
  SET "unreadByJson" = jsonb_set(COALESCE("unreadByJson", '{}'::jsonb), ARRAY[${userId}], '0'::jsonb, true)
  WHERE id = ${convId}`
```

> Se o helper `unreadOf` ficar sem uso após a troca, removê-lo (YAGNI). Se ainda for usado por `toConvDto` (leitura), mantê-lo. Verificar com grep antes.

**Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/chat/chat.service.spec.ts`
Expected: PASS (os 2 reescritos + os existentes; `$executeRaw` no factory).

**Step 5: Typecheck**

Run: `npm run build` — 0 erros.

**Step 6: Commit**

```bash
git add swi-backend/src/chat/chat.service.ts swi-backend/src/chat/chat.service.spec.ts
git commit -m "fix(backend): unreadByJson atomico (jsonb_set; fecha lost-update em send/markRead)"
```

---

## Task 3: Enumeration timing (`auth.service.ts` + `auth.controller.ts`)

`confirm`/`reset` sempre 1 bcrypt compare (via `DUMMY_HASH`); `forgot` faz trabalho dummy no ramo sem-user; `signup` ganha `@Throttle 5/min`.

**Files:**
- Modify: `swi-backend/src/auth/auth.service.ts` (`confirm` `:49-58`, `forgotPassword` `:69-78`, `resetPassword` `:80-89`)
- Modify: `swi-backend/src/auth/auth.controller.ts:12` (`signup`)
- Test: `swi-backend/src/auth/auth.service.spec.ts`

**Step 1: Escrever os testes que falham** (mirror do timing-guard do login)

Adicionar ao `auth.service.spec.ts` (usa o `import bcrypt from 'bcrypt'` já no topo + `DUMMY_HASH` já importado):

```ts
describe('AuthService enumeration-timing (H3a)', () => {
  it('confirm com e-mail inexistente AINDA roda bcrypt.compare (contra DUMMY_HASH) e dá BadRequest', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.confirm({ email: 'nao@existe.com', code: '123456' })).rejects.toBeInstanceOf(BadRequestException)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH)
    spy.mockRestore()
  })
  it('reset com e-mail inexistente AINDA roda bcrypt.compare (contra DUMMY_HASH) e dá BadRequest', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.resetPassword({ email: 'nao@existe.com', code: '123456', newPassword: 'nova123' })).rejects.toBeInstanceOf(BadRequestException)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH)
    spy.mockRestore()
  })
  it('forgot com e-mail inexistente AINDA roda bcrypt.hash (trabalho dummy) e fica silencioso', async () => {
    const { svc, users, mail } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'hash')
    await expect(svc.forgotPassword({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)     // custo constante equivalente ao caminho real
    expect(mail.sendResetCode).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

**Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/auth/auth.service.spec.ts`
Expected: FAIL — hoje `confirm`/`reset` short-circuitam antes do compare (spy 0×) e `forgot` retorna sem hashear (spy 0×).

**Step 3: Implementar a equalização**

Em `auth.service.ts`:

`confirm`:
```ts
async confirm(p: { email: string; code: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  const ok = await verifyHash(p.code, u?.confirmationCodeHash ?? DUMMY_HASH)  // sempre 1 compare
  if (!u || !u.confirmationCodeHash || !u.confirmationExpires || !ok) throw new BadRequestException('Código inválido')
  if (u.confirmationExpires < new Date()) throw new BadRequestException('Código expirado')
  await this.prisma.user.update({
    where: { id: u.id },
    data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
  })
}
```

`resetPassword`:
```ts
async resetPassword(p: { email: string; code: string; newPassword: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  const ok = await verifyHash(p.code, u?.resetCodeHash ?? DUMMY_HASH)          // sempre 1 compare
  if (!u || !u.resetCodeHash || !u.resetExpires || !ok) throw new BadRequestException('Código inválido')
  if (u.resetExpires < new Date()) throw new BadRequestException('Código expirado')
  await this.prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await hash(p.newPassword), resetCodeHash: null, resetExpires: null },
  })
}
```

`forgotPassword`:
```ts
async forgotPassword(p: { email: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  const code = generateCode()
  if (!u) {
    await hash(code)   // trabalho dummy equivalente ao caminho real (1 bcrypt), descartado → sem oráculo de timing
    return             // silencioso de propósito
  }
  await this.prisma.user.update({
    where: { id: u.id },
    data: { resetCodeHash: await hash(code), resetExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
  })
  await this.mail.sendResetCode(p.email, code)
}
```

Em `auth.controller.ts:12`, adicionar o throttle no `signup`:
```ts
@Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('signup') signup(@Body() b: SignupDto) { return this.auth.signup(b) }
```

**Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/auth/auth.service.spec.ts`
Expected: PASS — os 3 novos + todos os existentes (incl. `confirm código expirado`, `reset expirado`, `reset código errado`, `forgot silencioso`, `forgot real gera e-mail`, o timing-guard do login). Confirmar em especial: o caso `confirm com código expirado → BadRequest` segue verde (código correto → `ok=true` → passa o 1º throw → cai no check de expiração).

**Step 5: Typecheck**

Run: `npm run build` — 0 erros.

**Step 6: Commit**

```bash
git add swi-backend/src/auth/auth.service.ts swi-backend/src/auth/auth.controller.ts swi-backend/src/auth/auth.service.spec.ts
git commit -m "fix(backend): fecha timing de enumeracao em confirm/reset/forgot + throttle 5/min no signup"
```

---

## Task 4: e2e concorrente (chat contador, journey photos)

Provar o acúmulo atômico contra Postgres vivo.

**Files:**
- Modify: `swi-backend/test/chat.e2e-spec.ts`
- Modify: `swi-backend/test/journey.e2e-spec.ts`

**Pré-requisito:** Docker `db` up + `DATABASE_URL` no ambiente.

**Step 1: Caso do contador no chat** — adicionar ao `describe('Chat e2e')`, após o caso concorrente do H2:

```ts
it('N sends concorrentes acumulam o unread do destinatário sem lost-update', async () => {
  const N = 6
  const tA = await login(eA), tB = await login(eB)
  // garante a conversa criada e zera o unread do B
  await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'seed' }).expect(201)
  await request(app.getHttpServer()).post(`${cpath(convId)}/read`).set({ Authorization: `Bearer ${tB}` }).expect(204)
  // N envios concorrentes A→B
  await Promise.all(Array.from({ length: N }, (_, i) =>
    request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: `c${i}` }).expect(201),
  ))
  const { body: convs } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tB}` }).expect(200)
  expect(convs.find((c: any) => c.id === convId).unreadBy[idB]).toBe(N) // exato N — hoje seria < N por lost-update
})
```

**Step 2: Caso dos photos no journey** — adicionar ao `describe('Journey e2e')`, após o duplo-start do H2:

```ts
it('N addTaskPhoto concorrentes acumulam todas as keys sem lost-update', async () => {
  const auth = await login()
  const { body: before } = await request(app.getHttpServer()).get(`/journey/tasks/${taskId}`).set(auth).expect(200)
  const base = before.images.length
  const N = 6
  const key = (i: number) => `task/${String(i).padStart(8, '0')}-0000-0000-0000-000000000000.jpg`
  await Promise.all(Array.from({ length: N }, (_, i) =>
    request(app.getHttpServer()).post(`/journey/tasks/${taskId}/photo`).set(auth).send({ imageKey: key(i) }).expect(201),
  ))
  const { body: after } = await request(app.getHttpServer()).get(`/journey/tasks/${taskId}`).set(auth).expect(200)
  expect(after.images.length).toBe(base + N) // todas as N — hoje seria < base+N por lost-update
})
```

**Step 3: Rodar os e2e**

Run: `$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e`
Expected: PASS — todas as suites + os 2 casos novos; contador === N; images === base+N.

**Step 4: Commit**

```bash
git add swi-backend/test/chat.e2e-spec.ts swi-backend/test/journey.e2e-spec.ts
git commit -m "test(backend): e2e concorrente — unread acumula N + photos acumulam N (sem lost-update)"
```

---

## Task 5: Gate + docker smoke + PR (controller)

**Step 1:** `npm test` — todas as suites verdes (sem SIGTERM).
**Step 2:** `npm run build` — 0 erros.
**Step 3:** `git diff --name-only main...feat/backend-hardening-h3a` — só `swi-backend/` + `docs/plans/`; **nenhum** `mobile/`.
**Step 4: Docker smoke (rebuild na branch H3a):** `docker compose -f swi-backend/docker-compose.yml up --build -d api`; provar: N sends concorrentes de 2 workers numa conversa → contador de não-lidas do destinatário = **N exato**; N photos concorrentes numa task → **N keys**; confirm/reset com código errado seguem 400.
**Step 5: AI-trace scan:** `git log main..feat/backend-hardening-h3a --format='%an|%cn|%B'` — sem `Co-Authored-By: Claude`, sem "Generated with Claude Code".
**Step 6:** Preparar corpo do PR em `<scratchpad>/pr-body-h3a.md` (não abrir).
**Step 7: PARAR e reportar.** Push/PR/merge **só com luz verde explícita**.

---

## Notas de execução

- **Subagent-driven:** Tasks 1-4 = implementer (general-purpose) + two-gate (spec-reviewer + code-quality); Task 5 = controller (eu).
- **TDD estrito:** teste falha ANTES da implementação; roda/vê falhar; implementa mínimo; roda/vê passar.
- **DRY/YAGNI:** atomicidade single-row = 1 statement atômico (não tx+lock); enumeration = espelha o H1.
- **Deferido → H3b:** validação de data do Perfil + `@CurrentUser()` + `@MaxLength` no body + paginação/media policy (toca mobile) + shape do 409 do signup.
