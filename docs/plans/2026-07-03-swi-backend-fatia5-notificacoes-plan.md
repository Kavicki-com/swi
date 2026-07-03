# Fatia 5 (Notificações) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Backend real de Notificações (NestJS/Prisma) com feed REST + push real-time via WebSocket (reusa o `RealtimeModule` da Fatia 4) + emits cross-domain (chat→notif, report→notif), e o cliente mobile REST `apiNotificationBackend` ligado ao seam.

**Architecture:** `NotificationModule` expõe `NotificationService` (list/markRead/markAllRead + `createFor`/`createForMany` injetáveis) e um controller JWT. `ChatService.sendMessage` e `ReportsService.create` injetam `NotificationService` e disparam notificações **best-effort** (try/catch — nunca quebram o write-fonte). O mobile só troca o stub amplify por `apiNotificationBackend` (REST + socket.io); telas/reducers/provider intocados.

**Tech Stack:** NestJS 10, Prisma 5 (Postgres), socket.io / socket.io-client (já instalados na Fatia 4), Jest, supertest. Mobile: Expo/React Native, jest.

**Design:** `docs/plans/2026-07-03-swi-backend-fatia5-notificacoes-design.md`

---

## Convenções e baselines (leia antes de começar)

- **Estilo:** arquivos backend (`swi-backend/src/**`, `test/**`, `prisma/**`) **sem ponto-e-vírgula**; arquivos mobile (`mobile/**`) **com ponto-e-vírgula**. Sempre espelhe o irmão mais próximo.
- **Baselines a preservar** (pós-Fatia 4, em `main`@`45f0443`):
  - backend: `npm run build` exit 0 · `npm test` **57** · `npm run test:e2e` **25**.
  - mobile: `npx tsc --noEmit` **8 erros = baseline exato** (0 novos) · `npx jest` **164** · `npx expo export --platform web` exit 0.
- **COMMITS (regra do projeto, sobrepõe o hábito do skill):** os subagents implementam **no working tree, sem commitar**. O controller (você) faz `git add`/`commit` **só depois** da review holística **E** da luz verde explícita do usuário. **NUNCA** rastros de IA (sem `Co-Authored-By`, sem rodapé "Generated with Claude Code"). Os "commits" citados abaixo são a mensagem sugerida pro fim, não autorização.
- **Modelo `Notification` já existe** (Fatia 0, `prisma/schema.prisma`): `{ id, workerId→User, title, body?, domain(enum), targetId?, read=false, createdAt, updatedAt }`, `@@index([workerId, createdAt])`. **Sem migração nova.**
- **Ponto de atenção crítico (FK):** ligar chat→notif e report→notif faz nascer linhas `Notification` que referenciam `User`. Todo e2e que **apaga usuários** precisa apagar as notificações deles ANTES (senão viola o FK). Tratado nas Tasks 3, 4 e 6 + `maxWorkers:1` no e2e (serial → nenhum spec tem usuários vivos durante o broadcast de outro).

---

## Task 1: NotificationService (service + unit spec, TDD)

**Files:**
- Create: `swi-backend/src/notifications/notification.service.ts`
- Create: `swi-backend/src/notifications/notification.service.spec.ts`

**Step 1: Write the failing spec**

Create `swi-backend/src/notifications/notification.service.spec.ts`:

```ts
import { NotificationService } from './notification.service'
import { NotFoundException } from '@nestjs/common'

const realtime = () => ({ emitToUsers: jest.fn() }) as any
const prisma = () => ({
  notification: {
    findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  },
}) as any

const W = 'worker-1'
const row = (over: any = {}) => ({
  id: 'n1', workerId: W, title: 'T', body: 'B', domain: 'chat',
  targetId: null, read: false, createdAt: new Date('2026-06-23T15:00:00Z'), ...over,
})

describe('NotificationService', () => {
  it('list escopa no worker, ordena createdAt desc e mapeia dto', async () => {
    const db = prisma(); db.notification.findMany.mockResolvedValue([row()])
    const out = await new NotificationService(db, realtime()).list(W)
    expect(db.notification.findMany).toHaveBeenCalledWith({ where: { workerId: W }, orderBy: { createdAt: 'desc' } })
    expect(out[0]).toEqual({ id: 'n1', title: 'T', body: 'B', domain: 'chat', targetId: null, read: false, createdAt: '2026-06-23T15:00:00.000Z' })
  })

  it('list mapeia body null → ""', async () => {
    const db = prisma(); db.notification.findMany.mockResolvedValue([row({ body: null })])
    expect((await new NotificationService(db, realtime()).list(W))[0].body).toBe('')
  })

  it('markRead de outro worker → 404 sem update', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(row({ workerId: 'outro' }))
    await expect(new NotificationService(db, realtime()).markRead(W, 'n1')).rejects.toThrow(NotFoundException)
    expect(db.notification.update).not.toHaveBeenCalled()
  })

  it('markRead inexistente → 404', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(null)
    await expect(new NotificationService(db, realtime()).markRead(W, 'n1')).rejects.toThrow(NotFoundException)
  })

  it('markRead do dono seta read=true', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(row())
    await new NotificationService(db, realtime()).markRead(W, 'n1')
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { read: true } })
  })

  it('markAllRead atualiza só as não-lidas do worker', async () => {
    const db = prisma(); db.notification.updateMany.mockResolvedValue({ count: 3 })
    await new NotificationService(db, realtime()).markAllRead(W)
    expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { workerId: W, read: false }, data: { read: true } })
  })

  it('createFor persiste e empurra ao vivo pro destinatário', async () => {
    const db = prisma(); db.notification.create.mockResolvedValue(row({ domain: 'reports', title: 'Novo relatório' }))
    const rt = realtime()
    const dto = await new NotificationService(db, rt).createFor(W, { domain: 'reports', title: 'Novo relatório', body: 'R1', targetId: 'r1' })
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ workerId: W, domain: 'reports', title: 'Novo relatório', body: 'R1', targetId: 'r1' })
    expect(rt.emitToUsers).toHaveBeenCalledWith([W], 'notification', dto)
  })

  it('createForMany faz broadcast pra cada worker', async () => {
    const db = prisma(); db.notification.create.mockResolvedValue(row())
    const rt = realtime()
    await new NotificationService(db, rt).createForMany(['a', 'b'], { domain: 'reports', title: 'X' })
    expect(db.notification.create).toHaveBeenCalledTimes(2)
    expect(rt.emitToUsers).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2: Run to verify it fails**

Run: `cd swi-backend && npx jest notification.service`
Expected: FAIL — `Cannot find module './notification.service'`.

**Step 3: Write minimal implementation**

Create `swi-backend/src/notifications/notification.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import type { Notification, NotificationDomain } from '@prisma/client'

export interface NotificationPayload {
  title: string
  body?: string | null
  domain: NotificationDomain
  targetId?: string | null
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(workerId: string) {
    const rows = await this.prisma.notification.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' } })
    return rows.map((n) => this.toDto(n))
  }

  async markRead(workerId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findUnique({ where: { id } })
    if (!n || n.workerId !== workerId) throw new NotFoundException('Notificação não encontrada')
    await this.prisma.notification.update({ where: { id }, data: { read: true } })
  }

  async markAllRead(workerId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { workerId, read: false }, data: { read: true } })
  }

  // Superfície injetável cross-domain: cria + empurra ao vivo pro destinatário.
  async createFor(workerId: string, payload: NotificationPayload) {
    const n = await this.prisma.notification.create({
      data: {
        workerId,
        title: payload.title,
        body: payload.body ?? null,
        domain: payload.domain,
        targetId: payload.targetId ?? null,
      },
    })
    const dto = this.toDto(n)
    this.realtime.emitToUsers([workerId], 'notification', dto)
    return dto
  }

  async createForMany(workerIds: string[], payload: NotificationPayload) {
    return Promise.all(workerIds.map((id) => this.createFor(id, payload)))
  }

  private toDto(n: Notification) {
    return {
      id: n.id,
      title: n.title,
      body: n.body ?? '',
      domain: n.domain,
      targetId: n.targetId ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }
  }
}
```

**Step 4: Run to verify it passes**

Run: `cd swi-backend && npx jest notification.service`
Expected: PASS (8 tests).

**Step 5 (suggested commit — HOLD per commit rule):** `feat(backend): NotificationService (list/read/createFor injetável) + testes`

---

## Task 2: NotificationController + NotificationModule + registro

**Files:**
- Create: `swi-backend/src/notifications/notification.controller.ts`
- Create: `swi-backend/src/notifications/notification.module.ts`
- Modify: `swi-backend/src/app.module.ts`

**Step 1: Controller**

Create `swi-backend/src/notifications/notification.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Req() req: any) { return this.notifications.list(req.user.userId) }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@Req() req: any) { return this.notifications.markAllRead(req.user.userId) }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@Req() req: any, @Param('id') id: string) { return this.notifications.markRead(req.user.userId, id) }
}
```

> Nota: `read-all` (1 segmento) e `:id/read` (2 segmentos) não conflitam; a ordem é só higiene.

**Step 2: Module**

Create `swi-backend/src/notifications/notification.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { NotificationController } from './notification.controller'
import { RealtimeModule } from '../realtime/realtime.module'

@Module({
  imports: [RealtimeModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
```

**Step 3: Registrar no app.module**

Modify `swi-backend/src/app.module.ts`: importe `NotificationModule` e adicione ao array `imports` (depois de `RealtimeModule`):

```ts
import { NotificationModule } from './notifications/notification.module'
// ... imports: [ ... , ChatModule, RealtimeModule, NotificationModule ],
```

**Step 4: Verify**

Run: `cd swi-backend && npm run build && npm test`
Expected: build exit 0; **65** unit verdes (57 base + 8 do Task 1).

**Step 5 (suggested commit — HOLD):** `feat(backend): NotificationController + Module (REST /notifications, JWT)`

---

## Task 3: Emit chat→notif (+ atualizar chat.service.spec, chat.e2e, e2e serial)

**Files:**
- Modify: `swi-backend/src/chat/chat.service.ts`
- Modify: `swi-backend/src/chat/chat.module.ts`
- Modify: `swi-backend/src/chat/chat.service.spec.ts`
- Modify: `swi-backend/test/chat.e2e-spec.ts`
- Modify: `swi-backend/test/jest-e2e.json`

**Step 1: Atualizar o spec (falha primeiro — TDD)**

Em `chat.service.spec.ts`:
1. No factory `prisma`, troque `user: { findMany: jest.fn() }` por `user: { findMany: jest.fn(), findUnique: jest.fn() }`.
2. Adicione um factory de notifications abaixo do `realtime`:
   ```ts
   const notifications = () => ({ createFor: jest.fn(), createForMany: jest.fn() }) as any
   ```
3. Em **todas** as chamadas `new ChatService(db, media(), realtime())` / `new ChatService(db, media(), rt)`, adicione o 4º argumento `notifications()` (ou uma var nomeada quando for asserir).
4. Adicione o teste de regressão:
   ```ts
   it('sendMessage dispara notificação cross-domain best-effort pro destinatário', async () => {
     const db = prisma()
     db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: {} }))
     db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
     db.conversation.update.mockResolvedValue(convRow())
     db.user.findUnique.mockResolvedValue(userRow(A))
     const notif = notifications()
     await new ChatService(db, media(), realtime(), notif).sendMessage(A, CONV, { body: 'e aí' })
     expect(notif.createForMany).toHaveBeenCalledWith([B], expect.objectContaining({ domain: 'chat', body: 'e aí', targetId: CONV }))
   })
   ```

Run: `cd swi-backend && npx jest chat.service`
Expected: FAIL (compilação: `ChatService` só aceita 3 args / `createForMany` não chamado).

**Step 2: Implementar no ChatService**

Em `chat.service.ts`:
1. Import: `import { NotificationService } from '../notifications/notification.service'`.
2. Constructor: adicione 4º param `private readonly notifications: NotificationService,`.
3. Em `sendMessage`, **entre** `this.realtime.emitToUsers(conv.participants, 'message', out)` e `return out`, insira:
   ```ts
   // Cross-domain best-effort: notifica o(s) destinatário(s). Falha aqui NUNCA
   // quebra o envio da mensagem — a notificação é derivada do write-fonte.
   const recipients = conv.participants.filter((p) => p !== userId)
   if (recipients.length) {
     try {
       const sender = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
       const senderName = sender?.profile?.fullName ?? sender?.name ?? 'Nova mensagem'
       await this.notifications.createForMany(recipients, {
         domain: 'chat',
         title: senderName,
         body: dto.body || 'Enviou um anexo',
         targetId: convId,
       })
     } catch { /* best-effort */ }
   }
   ```

**Step 3: Ligar o módulo**

Em `chat.module.ts`: importe `NotificationModule` e adicione ao `imports`:
```ts
import { NotificationModule } from '../notifications/notification.module'
@Module({ imports: [MediaModule, RealtimeModule, NotificationModule], providers: [ChatService], controllers: [ChatController] })
```

**Step 4: e2e serial + cleanup de notificações no chat.e2e**

1. Em `swi-backend/test/jest-e2e.json`, adicione `"maxWorkers": 1` (e2e serial → evita FK cross-spec: nenhum spec tem usuários vivos durante o broadcast de outro):
   ```json
   { "moduleFileExtensions": ["js","json","ts"], "rootDir": ".", "testEnvironment": "node",
     "maxWorkers": 1,
     "testRegex": ".e2e-spec.ts$", "transform": { "^.+\\.(t|j)s$": "ts-jest" },
     "setupFiles": ["dotenv/config"] }
   ```
2. Em `chat.e2e-spec.ts`, no `cleanup`, **dentro do `if (ids.length)`, antes** de mexer em conversas, adicione:
   ```ts
   await prisma.notification.deleteMany({ where: { workerId: { in: ids } } }) // chat→notif cria linhas p/ o destinatário
   ```

**Step 5: Verify**

Run: `cd swi-backend && npm test && npm run test:e2e`
Expected: unit verde (chat.service +1 regressão); e2e **25** verdes (chat.e2e passa, cleanup não viola FK).

**Step 6 (suggested commit — HOLD):** `feat(backend): chat→notif emit (best-effort) + e2e serial`

---

## Task 4: Emit report→notif broadcast (+ atualizar reports.service.spec, reports.e2e)

**Files:**
- Modify: `swi-backend/src/reports/reports.service.ts`
- Modify: `swi-backend/src/reports/reports.module.ts`
- Modify: `swi-backend/src/reports/reports.service.spec.ts`
- Modify: `swi-backend/test/reports.e2e-spec.ts`

**Step 1: Atualizar o spec (falha primeiro)**

Em `reports.service.spec.ts`:
1. No factory `prisma`, adicione `findMany` ao `user`: `user: { findUnique: jest.fn(), findMany: jest.fn() }`.
2. Adicione factory: `const notifications = () => ({ createForMany: jest.fn() }) as any` (abaixo do `media`).
3. Em **todas** as chamadas `new ReportsService(db, media())`, adicione 3º arg `notifications()`.
4. Nos testes que chamam `.create(...)`, adicione `db.user.findMany.mockResolvedValue([])` no setup (caminho feliz do broadcast).
5. Adicione o teste de regressão:
   ```ts
   it('create faz broadcast pros outros workers aprovados (best-effort)', async () => {
     const db = prisma()
     db.user.findUnique.mockResolvedValue({ name: 'A', profile: null })
     db.report.create.mockResolvedValue(row({ id: 'r9', title: 'R9' }))
     db.user.findMany.mockResolvedValue([{ id: 'w2' }, { id: 'w3' }])
     const notif = notifications()
     await new ReportsService(db, media(), notif).create('author-1', { title: 'R9' } as any)
     expect(db.user.findMany).toHaveBeenCalledWith({ where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: 'author-1' } }, select: { id: true } })
     expect(notif.createForMany).toHaveBeenCalledWith(['w2', 'w3'], expect.objectContaining({ domain: 'reports', body: 'R9', targetId: 'r9' }))
   })
   ```

Run: `cd swi-backend && npx jest reports.service`
Expected: FAIL (`ReportsService` só aceita 2 args / `createForMany` não chamado).

**Step 2: Implementar no ReportsService**

Em `reports.service.ts`:
1. Import: `import { NotificationService } from '../notifications/notification.service'`.
2. Constructor: adicione `private readonly notifications: NotificationService,`.
3. Em `create`, **entre** `const r = await this.prisma.report.create({...})` e `return this.toDto(r)`, insira:
   ```ts
   // Cross-domain best-effort: relatório novo notifica os OUTROS workers aprovados
   // (inbox de relatórios é org-wide). Falha aqui não quebra a criação.
   try {
     const others = await this.prisma.user.findMany({
       where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: authorId } },
       select: { id: true },
     })
     await this.notifications.createForMany(others.map((u) => u.id), {
       domain: 'reports',
       title: 'Novo relatório',
       body: dto.title,
       targetId: r.id,
     })
   } catch { /* best-effort */ }
   ```

**Step 3: Ligar o módulo**

Em `reports.module.ts`:
```ts
import { NotificationModule } from '../notifications/notification.module'
@Module({ imports: [MediaModule, NotificationModule], providers: [ReportsService], controllers: [ReportsController] })
```

**Step 4: Cleanup de broadcast no reports.e2e**

Em `reports.e2e-spec.ts`, troque o `cleanup` por (apaga as notificações do broadcast dos relatórios de teste por `targetId`, antes de reports/users):
```ts
const cleanup = async () => {
  const reports = await prisma.report.findMany({ where: { author: { email } }, select: { id: true } })
  const rids = reports.map((r) => r.id)
  if (rids.length) await prisma.notification.deleteMany({ where: { targetId: { in: rids } } })
  await prisma.report.deleteMany({ where: { author: { email } } })
  await prisma.user.deleteMany({ where: { email } })
}
```

**Step 5: Verify**

Run: `cd swi-backend && npm test && npm run test:e2e`
Expected: unit verde (reports.service +1); e2e **25** verdes.

**Step 6 (suggested commit — HOLD):** `feat(backend): report→notif broadcast (best-effort) pros workers aprovados`

---

## Task 5: Seed das notificações do worker (Opção A)

**Files:**
- Modify: `swi-backend/prisma/seed.ts`

**Step 1: Import do enum**

Na linha 1, troque `import { PrismaClient } from '@prisma/client'` por:
```ts
import { PrismaClient, type NotificationDomain } from '@prisma/client'
```

**Step 2: Bloco de seed**

No fim de `main()` (antes de fechar a função), adicione:

```ts
  // ===== Fatia 5 (Notificações): feed demo do worker (Opção A, fidelidade) =====
  // Migrado do array estático de mockNotificationBackend.ts (12 itens). createdAt
  // decrescente (1º = mais recente); mix read/unread. targetId null (deep-link a
  // recurso específico = pendência; a tela roteia por domain).
  const NOTIF_BASE = new Date('2026-06-23T15:00:00.000Z')
  const notifAt = (min: number) => new Date(NOTIF_BASE.getTime() - min * 60_000)
  const SEED_NOTIFS: { title: string; body: string; domain: NotificationDomain; read: boolean; min: number }[] = [
    { title: 'Alerta Meteorológico', body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', domain: 'weather', read: false, min: 5 },
    { title: 'Atividade de Colaborador', body: 'Ana atualizou o status da manutenção preventiva no setor de produção.', domain: 'chat', read: false, min: 30 },
    { title: 'Feedback Recebido', body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.', domain: 'chat', read: false, min: 90 },
    { title: 'Novo Relatório Atribuído', body: 'Relatório de segurança do setor 5 foi designado para sua análise.', domain: 'reports', read: true, min: 180 },
    { title: 'Relatório de Qualidade', body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.', domain: 'reports', read: true, min: 240 },
    { title: 'Notificação de Treinamento', body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.', domain: 'journey', read: true, min: 300 },
    { title: 'Nova Tarefa Atribuída', body: 'Realizar auditoria dos processos de armazenamento até o final da semana.', domain: 'journey', read: true, min: 360 },
    { title: 'Nova Inspeção Programada', body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.', domain: 'journey', read: true, min: 420 },
    { title: 'Mudança no Cronograma', body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.', domain: 'journey', read: true, min: 480 },
    { title: 'Comentário em Relatório', body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`, domain: 'chat', read: true, min: 540 },
    { title: 'Atualização de Procedimento', body: 'Procedimento de emergência revisado e disponível para consulta.', domain: 'faq', read: true, min: 600 },
    { title: 'Novo Comentário', body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`, domain: 'chat', read: true, min: 660 },
  ]
  await prisma.notification.deleteMany({ where: { workerId: worker.id } }) // idempotente
  for (const n of SEED_NOTIFS) {
    await prisma.notification.create({
      data: { workerId: worker.id, title: n.title, body: n.body, domain: n.domain, read: n.read, createdAt: notifAt(n.min) },
    })
  }
```

**Step 3: Verify (typecheck do seed)**

Run: `cd swi-backend && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (`NotificationDomain` reconhecido). O seed roda de verdade no Task 9 (docker smoke).

**Step 4 (suggested commit — HOLD):** `feat(backend): seed das 12 notificações do worker (Opção A)`

---

## Task 6: e2e de Notificações (REST + cross-domain 2 sockets)

**Files:**
- Create: `swi-backend/test/notifications.e2e-spec.ts`

**Step 1: Escrever o e2e** (espelha `chat.e2e-spec.ts`)

Create `swi-backend/test/notifications.e2e-spec.ts`:

```ts
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Notifications e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const eA = 'notif-a@ex.com', eB = 'notif-b@ex.com'
  let idA = '', idB = ''
  const reportIds: string[] = []
  const key = (a: string, b: string) => [a, b].sort().join('#')
  const cpath = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: [eA, eB] } } })
    const ids = users.map((u) => u.id)
    // Notifications têm FK p/ User → apagar ANTES dos users. Cobre as criadas
    // PARA os test users (workerId) e o broadcast dos relatórios de teste (targetId).
    await prisma.notification.deleteMany({ where: { OR: [{ workerId: { in: ids } }, { targetId: { in: reportIds } }] } })
    await prisma.report.deleteMany({ where: { authorId: { in: ids } } })
    if (ids.length) {
      const convs = await prisma.conversation.findMany({ where: { participants: { hasSome: ids } } })
      const convIds = convs.map((c) => c.id)
      if (convIds.length) await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } })
      if (convIds.length) await prisma.conversation.deleteMany({ where: { id: { in: convIds } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: [eA, eB] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    await app.listen(0)
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    const mk = async (email: string, name: string) =>
      (await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    idA = await mk(eA, 'Notif A'); idB = await mk(eB, 'Notif B')
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('sem token → 401', () => request(app.getHttpServer()).get('/notifications').expect(401))

  it('list/read/read-all + ownership 404', async () => {
    const n = await prisma.notification.create({ data: { workerId: idB, title: 'Oi', body: 'corpo', domain: 'faq', read: false } })
    const tB = await login(eB), tA = await login(eA)
    const { body: list } = await request(app.getHttpServer()).get('/notifications').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(list.find((x: any) => x.id === n.id)).toBeTruthy()
    await request(app.getHttpServer()).post(`/notifications/${n.id}/read`).set({ Authorization: `Bearer ${tA}` }).expect(404) // A não é dono
    await request(app.getHttpServer()).post(`/notifications/${n.id}/read`).set({ Authorization: `Bearer ${tB}` }).expect(204)
    const { body: list2 } = await request(app.getHttpServer()).get('/notifications').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(list2.find((x: any) => x.id === n.id).read).toBe(true)
    await request(app.getHttpServer()).post('/notifications/read-all').set({ Authorization: `Bearer ${tB}` }).expect(204)
  })

  it('cross-domain: B recebe notification (chat) quando A manda mensagem', async () => {
    const tA = await login(eA)
    const convId = key(idA, idB)
    const sock: Socket = io(base, { auth: { token: await login(eB) }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando notification')), 4000)
      sock.on('notification', (n) => { clearTimeout(timer); resolve(n) })
      sock.on('connect_error', (e) => { clearTimeout(timer); reject(e) })
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'oi B' }).expect(201)
    const n = await got
    expect(n.domain).toBe('chat')
    expect(n.targetId).toBe(convId)
    sock.close()
  })

  it('cross-domain: B recebe notification (reports) quando A posta relatório', async () => {
    const tA = await login(eA)
    const sock: Socket = io(base, { auth: { token: await login(eB) }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando notification reports')), 4000)
      sock.on('notification', (n) => { if (n.domain === 'reports') { clearTimeout(timer); resolve(n) } })
      sock.on('connect_error', (e) => { clearTimeout(timer); reject(e) })
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    const { body: r } = await request(app.getHttpServer()).post('/reports').set({ Authorization: `Bearer ${tA}` }).send({ title: 'Relatório e2e' }).expect(201)
    reportIds.push(r.id)
    const n = await got
    expect(n.domain).toBe('reports')
    expect(n.targetId).toBe(r.id)
    sock.close()
  })
})
```

**Step 2: Verify**

Run: `cd swi-backend && npm run test:e2e`
Expected: **~29-30** e2e verdes (25 base + 4-5 novos). Suite serial (maxWorkers:1).

**Step 3 (suggested commit — HOLD):** `test(backend): e2e de Notificações (REST + push cross-domain 2 sockets)`

---

## Task 7: Mobile — apiNotificationBackend (+test)

**Files:**
- Create: `mobile/services/notifications/apiNotificationBackend.ts`
- Create: `mobile/services/notifications/apiNotificationBackend.test.ts`

**Step 1: Test primeiro** (espelha `services/chat/apiChatBackend.test.ts`)

Create `mobile/services/notifications/apiNotificationBackend.test.ts`:

```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/session', () => ({ getUserId: jest.fn(() => 'me') }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'tok') }))
const on = jest.fn(); const close = jest.fn()
const mockIo = jest.fn((..._a: any[]) => ({ on, close }))
jest.mock('socket.io-client', () => ({ io: (...a: any[]) => mockIo(...a) }))

import { apiRequest } from '../api/http'
import { apiNotificationBackend } from './apiNotificationBackend'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('apiNotificationBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); mockIo.mockClear(); on.mockClear(); close.mockClear() })

  it('myId vem do singleton de sessão', () => { expect(apiNotificationBackend.myId).toBe('me') })

  it('listNotifications → GET /notifications', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiNotificationBackend.listNotifications()
    expect(apiRequest).toHaveBeenCalledWith('/notifications', { auth: true })
  })

  it('markRead → POST /notifications/:id/read', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiNotificationBackend.markRead('n1')
    expect(apiRequest).toHaveBeenCalledWith('/notifications/n1/read', { method: 'POST', auth: true })
  })

  it('markAllRead → POST /notifications/read-all', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiNotificationBackend.markAllRead()
    expect(apiRequest).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST', auth: true })
  })

  it('registerPushToken é no-op (não faz request)', async () => {
    await apiNotificationBackend.registerPushToken('expo-token')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('subscribe conecta o socket e entrega notification', async () => {
    const cb = jest.fn()
    const unsub = apiNotificationBackend.subscribe(cb)
    await flush()
    expect(mockIo).toHaveBeenCalledTimes(1)
    const handler = on.mock.calls.find((c) => c[0] === 'notification')![1]
    handler({ id: 'n1', domain: 'chat' })
    expect(cb).toHaveBeenCalledWith({ id: 'n1', domain: 'chat' })
    unsub(); expect(close).toHaveBeenCalled()
  })
})
```

Run: `cd mobile && npx jest apiNotificationBackend`
Expected: FAIL — módulo não existe.

**Step 2: Implementar** (espelha `apiChatBackend.ts`)

Create `mobile/services/notifications/apiNotificationBackend.ts`:

```ts
import * as SecureStore from 'expo-secure-store';
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, NotificationBackend } from './types';
import { apiRequest } from '../api/http';
import { getUserId } from '../api/session';
import { API_URL } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Backend devolve o shape mobile pronto (ISO no createdAt). `subscribe` troca o
// event-bus do mock por um socket.io real (evento 'notification'). `registerPushToken`
// fica no-op seam — a entrega de push do SO é deploy-gated (SNS/FCM/APNs + expo-notifications).
export const apiNotificationBackend: NotificationBackend = {
  get myId() { return getUserId(); },

  listNotifications() { return apiRequest<AppNotification[]>('/notifications', { auth: true }); },

  async markRead(id) {
    await apiRequest<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true });
  },

  async markAllRead() {
    await apiRequest<void>('/notifications/read-all', { method: 'POST', auth: true });
  },

  async registerPushToken() {
    // no-op seam: entrega de push do SO é deploy-gated (SNS/FCM/APNs + device token).
  },

  subscribe(cb) {
    let socket: Socket | null = null;
    let closed = false;
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (closed) return;
      socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
      socket.on('notification', (n: AppNotification) => { cb(n); });
    })();
    return () => { closed = true; socket?.close(); };
  },
};
```

**Step 3: Verify**

Run: `cd mobile && npx jest apiNotificationBackend`
Expected: PASS (6 tests).

**Step 4 (suggested commit — HOLD):** `feat(mobile): apiNotificationBackend (REST + socket.io + push seam)`

---

## Task 8: Mobile — despin do seletor + deletar amplify stub

**Files:**
- Modify: `mobile/services/notifications/getNotificationBackend.ts`
- Modify: `mobile/services/notifications/getNotificationBackend.test.ts`
- Delete: `mobile/services/notifications/amplifyNotificationBackend.ts`

**Step 1: Reescrever o teste** (espelha `getChatBackend.test.ts`)

Substitua `getNotificationBackend.test.ts` por:

```ts
// getNotificationBackend honra a flag DATA_BACKEND (mock|api), igual getChatBackend.
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getNotificationBackend } = require('./getNotificationBackend');
  const { mockNotificationBackend } = require('./mockNotificationBackend');
  const { apiNotificationBackend } = require('./apiNotificationBackend');
  return { getNotificationBackend, mockNotificationBackend, apiNotificationBackend };
}

describe('getNotificationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getNotificationBackend, mockNotificationBackend } = loadWith('mock');
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });

  it('retorna apiNotificationBackend com a flag em api', () => {
    const { getNotificationBackend, apiNotificationBackend } = loadWith('api');
    expect(getNotificationBackend()).toBe(apiNotificationBackend);
  });
});
```

Run: `cd mobile && npx jest getNotificationBackend` → FAIL (ainda pinado no mock).

**Step 2: Despinar o seletor**

Substitua `getNotificationBackend.ts` por:

```ts
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { NotificationBackend } from './types';
import { mockNotificationBackend } from './mockNotificationBackend';
import { apiNotificationBackend } from './apiNotificationBackend';

// Fatia Notificações migrada: honra a flag DATA_BACKEND (igual getChatBackend).
export function getNotificationBackend(): NotificationBackend {
  return DATA_BACKEND === 'api' ? apiNotificationBackend : mockNotificationBackend;
}
```

**Step 3: Deletar o stub amplify**

Delete `mobile/services/notifications/amplifyNotificationBackend.ts`. Confirme que nada mais o importa: `git grep amplifyNotificationBackend -- mobile/` deve ficar vazio.

**Step 4: Verify (full mobile gate)**

Run:
```
cd mobile && npx jest getNotificationBackend && npx tsc --noEmit && npx jest && npx expo export --platform web
```
Expected: getNotificationBackend PASS; `tsc` **8 baseline** (0 novos); jest verde (164 + apiNotificationBackend 6 = ~170; despin inalterado no total); expo export exit 0.

**Step 5 (suggested commit — HOLD):** `feat(mobile): despin getNotificationBackend + remove amplify stub`

---

## Task 9: Verificação full-branch + docker smoke + PR (CONTROLLER = você, não subagent)

**Step 1: Gate full-branch**
- Backend: `cd swi-backend && npm run build && npm test && npm run test:e2e` → build 0 · unit ~65 · e2e ~29-30.
- Mobile: `cd mobile && npx tsc --noEmit` (8 baseline, 0 novos) · `npx jest` (verde) · `npx expo export --platform web` (0).

**Step 2: Docker smoke REAL (o que tsc/jest não provam — REBUILD obrigatório)**
```
cd swi-backend && docker compose up --build -d
npm run prisma:seed
```
Provar (curl/PowerShell/Bash):
1. `GET /notifications` sem token → **401**.
2. login `worker@swi.local`/`worker123` → `GET /notifications` → **200** com **12 itens** (seed), 3 não-lidas.
3. `POST /notifications/read-all` → **204**; `GET /notifications` → todas `read:true`.
4. `POST /notifications/:id/read` de um id do worker → **204**.
5. **Cross-domain push (2 sockets no container)** — script Node temporário no scratchpad (técnica do smoke do Chat): romulo (`romulo@swi.local`/`worker123`) conecta socket → worker envia mensagem de chat pra romulo via REST → romulo recebe `notification` (domain `chat`). Repetir: worker posta `/reports` → romulo recebe `notification` (domain `reports`). **Apagar o script depois.**

**Step 3: Review holística** — 1 subagent revisor no diff inteiro (disciplina das fatias anteriores).

**Step 4: Commit + PR (SÓ com luz verde explícita do usuário)**
- Commits: `docs` (design+plan) · `feat(backend)` (notification module + emits + seed + e2e) · `feat(mobile)` (apiNotificationBackend + despin). **Sem rastros de IA.**
- PR contra `main` (branch `feat/backend-notificacoes`), corpo em arquivo no scratchpad (Windows sem `gh`/`jq` → REST API via `node -e fetch`, como no Chat).

---

## Ordem de execução (subagent-driven)

Tasks 1→2→3→4→5→6 (backend) e 7→8 (mobile), **two-gate (spec + code-quality) por task** + review entre tasks. Task 9 = controller.
Dependências: 3 e 4 exigem 1+2; 6 exige 3+4+5; 7 é autônoma (mocka tudo); 8 exige 7. Tasks 1, 7 podem começar em paralelo.
