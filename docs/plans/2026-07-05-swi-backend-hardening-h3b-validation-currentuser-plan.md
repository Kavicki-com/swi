# Hardening H3b (validação + @CurrentUser + paginação safety-cap + throttle test-env) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) to implement this plan task-by-task.
>
> Doc **temporário** (`docs/plans/*backend*`): deletar quando o backend inteiro estiver implementado.
> Design irmão: `2026-07-05-swi-backend-hardening-h3b-validation-currentuser-design.md`.

**Goal:** Fechar a 2ª metade do H3 (validação de data do Perfil, decorator `@CurrentUserId`, `@MaxLength` no chat, paginação safety-cap, throttle bypass em test-env) numa fatia **pure-backend, não-quebrante**, sem tocar o mobile.

**Architecture:** 5 fixes backend-only em `swi-backend/src/`, cada um TDD. Nenhum muda o contrato REST (safety-cap devolve array cru; validação/`@MaxLength` trocam 500→400 já tratado pelo mobile; `@CurrentUserId` é refactor interno; throttle-bypass é config de teste). Media policy fica **diferida + documentada** (fix real é quebrante). Branch `feat/backend-hardening-h3b` de `main` (`0ebc57e`).

**Tech Stack:** NestJS 10 + Prisma 5 + Postgres 16 (Docker), class-validator 0.14, `@nestjs/throttler` 6.5, Jest 29 (unit `maxWorkers:50%`) + Supertest (e2e).

---

## Convenções de comando (todas a partir de `swi-backend/`)

- **Build:** `npm run build` → esperado exit 0.
- **Unit (1 arquivo):** `npx jest <padrão>` (ex.: `npx jest is-calendar-date`). **Suíte:** `npm test`.
- **e2e (precisa Docker db UP + migrate 1x):** PowerShell:
  `$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e`
  (Bash: `DATABASE_URL='postgresql://swi:swi@localhost:5432/swi' npm run test:e2e`). Serial (`maxWorkers:1`).
- **Docker up:** `docker compose up --build -d api` (REBUILDA — o container roda o branch checado out; se `docker info` = DOWN, subir Docker Desktop e pollar até READY).
- **NUNCA rastros de IA** nos commits (sem `Co-Authored-By`, sem rodapé). Commit local por task.

---

## Task 1: Validação de data do Perfil (500 → 400)

**Files:**
- Create: `swi-backend/src/profile/is-calendar-date.ts`
- Create: `swi-backend/src/profile/is-calendar-date.spec.ts`
- Modify: `swi-backend/src/profile/dto.ts:1,6`
- Modify: `swi-backend/src/profile/profile.controller.ts:20` (guard defense-in-depth)

**Step 1: Write the failing test** — `src/profile/is-calendar-date.spec.ts`

```ts
import { validate } from 'class-validator'
import { IsCalendarDate } from './is-calendar-date'

class Probe {
  @IsCalendarDate() birthDate!: string
}

const check = async (v: string) => {
  const p = new Probe()
  p.birthDate = v
  return (await validate(p)).length === 0 // true = válido
}

describe('IsCalendarDate', () => {
  it('aceita data de calendário real', async () => {
    expect(await check('1990-05-20')).toBe(true)
    expect(await check('2000-02-29')).toBe(true) // bissexto válido
  })
  it('rejeita mês/dia impossíveis', async () => {
    expect(await check('2000-13-45')).toBe(false)
    expect(await check('2000-02-30')).toBe(false) // fev não tem 30
    expect(await check('2001-02-29')).toBe(false) // 2001 não é bissexto
  })
  it('rejeita shape errado', async () => {
    expect(await check('20-05-1990')).toBe(false)
    expect(await check('not-a-date')).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails** — `npx jest is-calendar-date`
Expected: FAIL (`Cannot find module './is-calendar-date'`).

**Step 3: Write minimal implementation** — `src/profile/is-calendar-date.ts`

```ts
import { registerDecorator, ValidationOptions } from 'class-validator'

// Valida que a string é uma data YYYY-MM-DD que EXISTE no calendário.
// `new Date('YYYY-MM-DD')` parseia como UTC midnight; toISOString() é UTC →
// o round-trip slice(0,10) compara sem drift de timezone. Datas impossíveis
// (2000-13-45 → Invalid Date; 2000-02-30 → rola pra 03-01) não round-trip.
export function IsCalendarDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const d = new Date(value)
          return !Number.isNaN(d.getTime()) && value === d.toISOString().slice(0, 10)
        },
        defaultMessage() {
          return 'birthDate deve ser uma data de calendário válida (YYYY-MM-DD)'
        },
      },
    })
  }
}
```

**Step 4: Run test to verify it passes** — `npx jest is-calendar-date`
Expected: PASS (3 casos).

**Step 5: Wire no DTO** — `src/profile/dto.ts`

```ts
// linha 1: trocar o import Matches por IsCalendarDate
import { IsOptional, IsString, Length } from 'class-validator'
import { IsCalendarDate } from './is-calendar-date'
// linha 6: trocar @Matches(...) por @IsCalendarDate()
  @IsOptional() @IsCalendarDate() birthDate?: string
```

**Step 6: Guard defense-in-depth no controller** — `src/profile/profile.controller.ts:20`

O DTO já barra, mas guarda contra `Invalid Date` explicitamente (importar `BadRequestException` de `@nestjs/common` se ainda não importado):

```ts
// no update():
const data = { ...dto, ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}) }
if (data.birthDate instanceof Date && Number.isNaN(data.birthDate.getTime())) {
  throw new BadRequestException('birthDate inválido')
}
```

**Step 7: Build + suíte unit** — `npm run build` (exit 0) e `npm test` (verde, +3 casos).

**Step 8: Commit**

```bash
git add swi-backend/src/profile/
git commit -m "feat(backend): valida data de calendario do Perfil (2000-13-45 -> 400 em vez de 500)"
```

---

## Task 2: `@CurrentUserId()` decorator (20 métodos, 6 controllers)

**Files:**
- Create: `swi-backend/src/auth/current-user.decorator.ts`
- Create: `swi-backend/src/auth/current-user.decorator.spec.ts`
- Modify (repoint): `swi-backend/src/{chat/chat,journey/journey,notifications/notification,profile/profile,reports/reports,auth/auth}.controller.ts`

**Step 1: Write the failing test** — `src/auth/current-user.decorator.spec.ts`

```ts
import { ExecutionContext } from '@nestjs/common'
import { currentUserIdFactory } from './current-user.decorator'

const ctx = (user: any): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any

describe('currentUserIdFactory', () => {
  it('extrai req.user.userId', () => {
    expect(currentUserIdFactory(undefined, ctx({ userId: 'w1' }))).toBe('w1')
  })
})
```

**Step 2: Run test to verify it fails** — `npx jest current-user.decorator`
Expected: FAIL (módulo não existe).

**Step 3: Write implementation** — `src/auth/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface JwtUser {
  userId: string
  // claims futuros entram aqui (role, email...) — single source of truth do shape do JWT
}

export const currentUserFactory = (_: unknown, ctx: ExecutionContext): JwtUser =>
  ctx.switchToHttp().getRequest().user

export const currentUserIdFactory = (_: unknown, ctx: ExecutionContext): string =>
  ctx.switchToHttp().getRequest().user.userId

export const CurrentUser = createParamDecorator(currentUserFactory)
export const CurrentUserId = createParamDecorator(currentUserIdFactory)
```

**Step 4: Run test to verify it passes** — `npx jest current-user.decorator` → PASS.

**Step 5: Repoint os 6 controllers.** Em CADA método, trocar `@Req() req: any` + `req.user.userId` por `@CurrentUserId() userId: string`, e ajustar o import (remover `Req` se não sobrar uso; importar `CurrentUserId` de `../auth/current-user.decorator`). Exemplo (`chat.controller.ts`):

```ts
// antes:  listConversations(@Req() req: any) { return this.chat.listConversations(req.user.userId) }
// depois: listConversations(@CurrentUserId() userId: string) { return this.chat.listConversations(userId) }
```

Métodos a repointar (20):
- `chat.controller.ts`: listConversations, listDirectory, listMessages, send, markRead (5)
- `journey.controller.ts`: getJourney, listTasks, getTask, startTask, pause, resume, end, addPhoto (8)
- `notification.controller.ts`: list, markAllRead, markRead (3)
- `profile.controller.ts`: me, update (2)
- `reports.controller.ts`: create (1)
- `auth.controller.ts`: me (1) — `const u = await this.users.findById(userId)`

⚠️ Onde o método usava `req` só pro `userId`, **remover `Req` do import** e o `req: any`. Onde também recebe `@Param`/`@Body`, manter esses. `send` no chat mantém `@Param('id')` + `@Body()` + o `if (!dto.body?.trim() && !dto.imageKey)`.

**Step 6: Build** — `npm run build` → exit 0 (pega qualquer `req` órfão ou import quebrado).

**Step 7: Prova de comportamento inalterado — e2e existente.** Subir Docker db, migrate 1x, rodar e2e:
`$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e`
Expected: as 8 suites verdes (cada rota já exercitada → refactor não mudou comportamento).

**Step 8: Commit**

```bash
git add swi-backend/src/
git commit -m "refactor(backend): @CurrentUserId decorator substitui @Req()+req.user.userId (20 metodos)"
```

---

## Task 3: `@MaxLength` no chat + paginação safety-cap

**Files:**
- Modify: `swi-backend/src/chat/dto.ts:1,3`
- Modify: `swi-backend/src/reports/reports.service.ts:17`
- Modify: `swi-backend/src/notifications/notification.service.ts:21`
- Modify: `swi-backend/src/chat/chat.service.ts:30,39`
- Modify (asserts existentes): `swi-backend/src/reports/reports.service.spec.ts:40`, `swi-backend/src/notifications/notification.service.spec.ts:22`
- Modify/add: `swi-backend/src/chat/chat.service.spec.ts`, `swi-backend/src/chat/dto.spec.ts` (novo)

**Step 1: Test do `@MaxLength`** — novo `src/chat/dto.spec.ts`

```ts
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { SendMessageDto } from './dto'

const errs = async (body: string) =>
  (await validate(plainToInstance(SendMessageDto, { body }))).length

describe('SendMessageDto', () => {
  it('aceita body <= 4000', async () => { expect(await errs('a'.repeat(4000))).toBe(0) })
  it('rejeita body > 4000', async () => { expect(await errs('a'.repeat(4001))).toBeGreaterThan(0) })
})
```

**Step 2: Run → FAIL** (`npx jest chat/dto`) — hoje não há limite, `4001` passa.

**Step 3: Implementar `@MaxLength`** — `src/chat/dto.ts`

```ts
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'
// ...
  @IsOptional() @IsString() @MaxLength(4000) body?: string
```

**Step 4: Run → PASS** (`npx jest chat/dto`).

**Step 5: Safety-cap — atualizar asserts existentes + implementar.**

`reports.service.ts:17`:
```ts
const rows = await this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
```
`reports.service.spec.ts:40` — atualizar o assert:
```ts
expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 200 })
```

`notification.service.ts:21`:
```ts
const rows = await this.prisma.notification.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' }, take: 200 })
```
`notification.service.spec.ts:22` — atualizar:
```ts
expect(db.notification.findMany).toHaveBeenCalledWith({ where: { workerId: W }, orderBy: { createdAt: 'desc' }, take: 200 })
```

`chat.service.ts:30` (conversations, `orderBy lastMessageAt desc`) → adicionar `take: 200`.
`chat.service.ts:39` (messages, `orderBy sentAt asc`) → adicionar **`take: -200`** (últimos N mantendo asc):
```ts
const rows = await this.prisma.message.findMany({ where: { conversationId: convId }, orderBy: { sentAt: 'asc' }, take: -200 })
```
Os asserts do chat spec (`:47` só checa `.where`, `:63` só checa `.orderBy`) **não quebram**. Adicionar 1 assert novo em `chat.service.spec.ts` no teste de listMessages:
```ts
expect(db.message.findMany.mock.calls[0][0].take).toBe(-200)
```

**Step 6: Build + suíte unit** — `npm run build` (0) e `npm test` (verde, asserts atualizados + novos).

**Step 7: Commit**

```bash
git add swi-backend/src/
git commit -m "feat(backend): @MaxLength(4000) no chat body + safety-cap take:200 nas listas (msgs take:-200)"
```

---

## Task 4: Throttle bypass em test-env + e2e + verificação/smoke/PR (controller)

**Files:**
- Modify: `swi-backend/src/app.module.ts:22`
- Modify: e2e do profile (`swi-backend/test/*.e2e-spec.ts` que cobre `/profile`), `swi-backend/test/chat.e2e-spec.ts`

**Step 1: Throttle `skipIf`** — `src/app.module.ts:22`

```ts
ThrottlerModule.forRoot({
  throttlers: [{ ttl: 60000, limit: 100 }],
  skipIf: () => process.env.NODE_ENV === 'test',
}),
```

**Step 2: Build** — `npm run build` → exit 0.

**Step 3: e2e — data inválida → 400.** No e2e do profile, adicionar caso: `PUT /profile/me` com `{ birthDate: '2000-13-45' }` (autenticado) → **400** (era 500).

**Step 4: e2e — body longo → 400.** No `chat.e2e`, adicionar: send com `body` de 4001 chars → **400**.

**Step 5: e2e — prova do bypass (2 logins).** No `chat.e2e`, adicionar um caso que faça um **2º login** (o que hoje estouraria o teto de 10/min) e siga verde — provando que `skipIf` desligou o throttle em test-env. (Se o arquivo já loga N vezes, basta adicionar um login extra num teste novo e confirmar 200, não 429.)

**Step 6: Rodar e2e completo** — Docker db UP + migrate:
`$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e`
Expected: 8 suites verdes, incluindo os novos casos. **Confirmar que `auth.e2e` segue verde** (o bypass não deve quebrar nada; a prova de throttle real do H1 é via docker smoke, não e2e).

**Step 7: Commit**

```bash
git add swi-backend/src/app.module.ts swi-backend/test/
git commit -m "test(backend): throttle skipIf em test-env + e2e (data invalida 400, body longo 400, chat 2-login)"
```

**Step 8: Gate holístico + docker smoke (controller = eu, não subagent).**
- `npm run build` (0) / `npm test` (unit verde) / e2e (verde) — anotar contagens (baseline 122/37 → novos).
- **Docker smoke REAL (rebuild):** `docker compose up --build -d api`; então:
  - `PUT /profile/me` com `birthDate:'2000-13-45'` → **400** (não 500).
  - chat send body 4001 → **400**.
  - `GET /reports`, `GET /chat/conversations`, `GET /notifications` respondendo (capados, array cru).
  - As 6 rotas refatoradas pro `@CurrentUserId` todas verdes (login worker → GET /profile/me, /journey, /chat/conversations, /notifications, POST /reports, /auth me).
- **Confirmar diff zero-mobile:** `git diff --stat main -- mobile/` VAZIO.
- **Scan de rastros de IA** nos commits: `git log main..HEAD` sem `Co-Authored-By`/`Generated`.
- Review holística das mudanças. Corrigir achados Critical/Important (amend no commit da task).
- **PR só com luz verde explícita do usuário** (corpo em `<scratchpad>/pr-body-h3b.md`).

---

## Ordem de execução (subagent-driven)

| Task | Escopo | Isolamento |
| --- | --- | --- |
| 1 | Validação de data (novo validator + DTO + guard) | Isolada (só `profile/`) |
| 2 | `@CurrentUserId` decorator + repoint 6 controllers | Isolada (novo decorator + controllers; não toca services) |
| 3 | `@MaxLength` + safety-cap (3 services + specs) | Isolada (services + dtos) |
| 4 | Throttle `skipIf` + e2e + gate/smoke/PR | Controller (eu) fecha |

Cada task 1-3 = **implementer (general-purpose) + two-gate** (spec-reviewer + code-quality `superpowers:code-reviewer`). Task 4 e2e por implementer; gate/smoke/PR por mim. Continuar agents com `SendMessage` pra fixes de review (amend no commit da task, mantém 1 commit/task).

## Diferidos (documentados no design §"Não-objetivos" — implementar **após terminar o H3**)

Media presigned-POST + content-length-range (quebrante); cursor pagination real (quebrante); fan-out notif→fila; shape do 409 do signup.
