# Fatia 4 — Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) task-by-task.

**Goal:** Ligar as telas de Chat ao backend real: `ChatModule` (conversas/mensagens/diretório) + `RealtimeModule` (gateway WebSocket socket.io com JWT no handshake) no NestJS, reusando o `MediaModule` da Fatia 2, + `apiChatBackend` (REST + socket) no mobile atrás do seam `DATA_BACKEND==='api'`.

**Architecture:** Ver `docs/plans/2026-07-02-swi-backend-fatia4-chat-design.md`. Backend espelha `src/journey/` + um gateway WS novo em `src/realtime/` (na mesma porta 3000). `sendMessage` persiste e **emite `message`** pras salas `user:<id>` dos participantes → o `subscribe(null)` de cada cliente dispara o append. `myId` síncrono vem de um singleton de sessão populado no login. Models `Conversation`/`Message` já existem (Fatia 0) — **sem migration nova**; o único serviço novo é o WS (mesmo processo).

**Tech Stack:** NestJS + `@nestjs/websockets` + `@nestjs/platform-socket.io` (deps novas) + Prisma + `@nestjs/jwt` (já instalado) + `@aws-sdk/*` (Fatia 2); Expo/RN + `socket.io-client` (dep nova) + Jest.

**⚠️ Pré-requisito de branch:** a Fatia 4 modifica **os mesmos arquivos** que a Fatia 3 (PR #27 aberto): `swi-backend/src/app.module.ts`, `swi-backend/prisma/seed.ts`, `swi-backend/src/media/dto.ts`, `swi-backend/src/media/media.controller.ts`. Pra não conflitar, a base **precisa incluir a Fatia 3**:
- **(preferida)** Mergear #27 → `main`, depois `git switch main && git pull && git switch -c feat/backend-chat`.
- **(stack)** Antes do merge: `git switch -c feat/backend-chat feat/backend-jornada` (empilha na Fatia 3); reabrir/retarget o PR contra `main` **após** #27 mergear.

Também depende da **mídia da Fatia 2** (`MediaModule`/`uploadImage`, já em `main` via #26).

**Baselines (pós-Jornada, base = inclui Fatia 3):** backend build 0, unit **44**, e2e **19**; mobile jest **151**, tsc **8** (0 novos), expo export web exit 0. **Docker smoke obrigatório** (com MinIO real + 2 sockets). Confirmar as contagens reais na base antes de começar e ajustar os "esperados" abaixo.

**Identidade:** `req.user.userId` (do JWT) escopando conversas/mensagens; membership = `participants ∋ userId` → **404** pra não-membro. `myId` no cliente = `user.id` da sessão.

**Contrato mobile (intocado):** `ChatBackend` (7 membros) em `mobile/services/chat/types.ts`. `ChatProvider` lê `myId` **síncrono** e só chama `subscribe(null, …)`.

---

### Task 1: branch + deps

**Step 1 — branch** (base precisa ter a Fatia 3; ver pré-requisito):
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git fetch origin
# preferida (após #27 mergear):
git switch main && git pull && git switch -c feat/backend-chat
# OU stack (antes do merge):
# git switch -c feat/backend-chat feat/backend-jornada
```
Confirmar que a base tem a Fatia 3 e a mídia da Fatia 2:
```bash
ls swi-backend/src/journey/journey.service.ts swi-backend/src/media/media.service.ts mobile/services/api/uploadMedia.ts
```
(Os três precisam existir — senão a base está errada.)

**Step 2 — deps backend** (WebSocket):
```bash
cd swi-backend && npm install @nestjs/websockets @nestjs/platform-socket.io
```

**Step 3 — dep mobile** (cliente socket):
```bash
cd ../mobile && npm install socket.io-client
```

**Step 4 — sanity da base verde** (antes de tocar em nada):
```bash
cd ../swi-backend && npm run build && npm test        # build 0, unit 44
cd ../mobile && npx tsc --noEmit                       # 8 baseline
```
Anotar as contagens reais (base) — são o baseline pros deltas.

**Step 5 — commit** (só com luz verde; ver nota no fim):
```bash
git add swi-backend/package.json swi-backend/package-lock.json mobile/package.json mobile/package-lock.json
git commit -m "chore(backend): deps do gateway WebSocket (nest ws + socket.io) e socket.io-client no mobile"
```

---

### Task 2: `RealtimeGateway` + `RealtimeModule` (TDD — JWT no handshake)

**Files:** Create `swi-backend/src/realtime/realtime.gateway.ts` + `realtime.gateway.spec.ts` + `realtime.module.ts`.

> **Antes:** abrir `swi-backend/src/auth/jwt-secret.ts` e confirmar que `requireJwtSecret()` lê `process.env.JWT_SECRET`. O teste seta essa env; se o nome diferir, ajustar.

**Step 1 — teste falhando** (`realtime.gateway.spec.ts`):
```ts
import { RealtimeGateway } from './realtime.gateway'
import { JwtService } from '@nestjs/jwt'

const secret = 'test-secret-realtime'

const fakeSocket = (token?: string) => {
  const joined: string[] = []
  return {
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {} as Record<string, unknown>,
    join: (r: string) => joined.push(r),
    disconnect: jest.fn(),
    _joined: joined,
  }
}

describe('RealtimeGateway', () => {
  const jwt = new JwtService({ secret })
  let g: RealtimeGateway
  beforeAll(() => { process.env.JWT_SECRET = secret })
  beforeEach(() => { g = new RealtimeGateway(jwt) })

  it('connect com token válido entra na sala user:<sub>', () => {
    const token = jwt.sign({ sub: 'u1', role: 'WORKER' })
    const c = fakeSocket(token) as any
    g.handleConnection(c)
    expect(c.data.userId).toBe('u1')
    expect(c._joined).toContain('user:u1')
    expect(c.disconnect).not.toHaveBeenCalled()
  })

  it('connect sem/ com token inválido desconecta', () => {
    const c = fakeSocket('lixo') as any
    g.handleConnection(c)
    expect(c.disconnect).toHaveBeenCalled()
    const c2 = fakeSocket(undefined) as any
    g.handleConnection(c2)
    expect(c2.disconnect).toHaveBeenCalled()
  })

  it('emitToUsers emite o evento nas salas de cada participante', () => {
    const emit = jest.fn()
    const to = jest.fn(() => ({ emit }))
    ;(g as any).server = { to }
    g.emitToUsers(['a', 'b'], 'message', { id: 'm1' })
    expect(to).toHaveBeenCalledWith('user:a')
    expect(to).toHaveBeenCalledWith('user:b')
    expect(emit).toHaveBeenCalledWith('message', { id: 'm1' })
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2:** `cd swi-backend && npx jest src/realtime/realtime.gateway.spec.ts` → FAIL (módulo não existe).

**Step 3 — implementar** (`realtime.gateway.ts`):
```ts
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { requireJwtSecret } from '../auth/jwt-secret'

// Gateway WS único (chat agora; notificações na Fatia 5). Mesma porta HTTP (3000).
// Autentica no handshake com o MESMO segredo JWT do REST; cada conexão entra na
// sala `user:<userId>` pra ser endereçável por `emitToUsers`.
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server
  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    const token = this.extractToken(client)
    try {
      const payload = this.jwt.verify(token, { secret: requireJwtSecret() }) as { sub: string }
      client.data.userId = payload.sub
      client.join(this.room(payload.sub))
    } catch {
      client.disconnect()
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const id of userIds) this.server.to(this.room(id)).emit(event, payload)
  }

  private room(userId: string): string { return `user:${userId}` }

  private extractToken(client: Socket): string {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth
    const header = client.handshake.headers?.authorization
    return header?.startsWith('Bearer ') ? header.slice(7) : ''
  }
}
```

**Step 4 — module** (`realtime.module.ts`; `JwtModule.register({})` provê `JwtService`, o segredo entra no `verify`):
```ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { RealtimeGateway } from './realtime.gateway'

@Module({ imports: [JwtModule.register({})], providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
```

**Step 5:** `npx jest src/realtime/realtime.gateway.spec.ts` → PASS (3/3).

**Step 6 — commit:**
```bash
git add swi-backend/src/realtime
git commit -m "feat(backend): RealtimeGateway (socket.io, JWT no handshake) + RealtimeModule"
```

---

### Task 3: `ChatService` (TDD — Prisma + Media + Gateway mockados)

**Files:** Create `swi-backend/src/chat/chat.service.ts` + `chat.service.spec.ts`.

**Step 1 — teste falhando** (`chat.service.spec.ts`). Cobre: diretório (aprovados/worker exceto eu), create-or-attach, membership 404, bump de unread, emit pros participantes, `toDto` presign/coalesce:
```ts
import { ChatService } from './chat.service'
import { NotFoundException } from '@nestjs/common'

const media = () => ({
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
}) as any
const realtime = () => ({ emitToUsers: jest.fn() }) as any

const prisma = () => ({
  conversation: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { findMany: jest.fn(), create: jest.fn() },
  user: { findMany: jest.fn() },
}) as any

// ids "uuid-like" sem '#'; a conversa A#B é sort([A,B]).join('#').
const A = 'aaaa', B = 'bbbb'
const CONV = [A, B].sort().join('#')

const userRow = (id: string, over: any = {}) => ({
  id, name: `n-${id}`, role: 'WORKER', approvalStatus: 'APPROVED',
  profile: { fullName: `full-${id}`, sector: 'Setor Leste', jobTitle: 'Operador', avatarKey: `chat/avatars/${id}.png` },
  ...over,
})
const convRow = (over: any = {}) => ({
  id: CONV, participants: [A, B], participantNames: ['full-aaaa', 'full-bbbb'],
  participantSubtitles: ['Setor Leste', 'Setor Leste'], participantAvatarKeys: ['chat/avatars/aaaa.png', 'chat/avatars/bbbb.png'],
  lastMessageBody: 'oi', lastMessageAt: new Date('2026-06-23T13:00:00Z'), unreadByJson: { aaaa: 2 }, ...over,
})
const msgRow = (over: any = {}) => ({
  id: 'm1', conversationId: CONV, senderId: B, body: 'oi', imageKey: null, sentAt: new Date('2026-06-23T13:00:00Z'), ...over,
})

describe('ChatService', () => {
  it('listDirectory traz workers aprovados exceto eu, presignando avatar', async () => {
    const db = prisma(); db.user.findMany.mockResolvedValue([userRow(B)])
    const out = await new ChatService(db, media(), realtime()).listDirectory(A)
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ approvalStatus: 'APPROVED', role: 'WORKER', id: { not: A } })
    expect(out[0]).toEqual({ workerId: B, name: 'full-bbbb', sector: 'Setor Leste', role: 'Operador', avatarUri: 'signed:chat/avatars/bbbb.png' })
  })

  it('listConversations escopa em participants ∋ eu e ordena por recência', async () => {
    const db = prisma(); db.conversation.findMany.mockResolvedValue([convRow()])
    const out = await new ChatService(db, media(), realtime()).listConversations(A)
    expect(db.conversation.findMany.mock.calls[0][0].where).toEqual({ participants: { has: A } })
    expect(out[0].participantAvatars).toEqual(['signed:chat/avatars/aaaa.png', 'signed:chat/avatars/bbbb.png'])
    expect(out[0].unreadBy).toEqual({ aaaa: 2 })
    expect(out[0].lastMessageAt).toBe('2026-06-23T13:00:00.000Z')
  })

  it('listMessages de não-membro → 404', async () => {
    const db = prisma(); db.conversation.findUnique.mockResolvedValue(convRow({ participants: ['x', 'y'] }))
    await expect(new ChatService(db, media(), realtime()).listMessages(A, CONV)).rejects.toThrow(NotFoundException)
  })

  it('listMessages devolve as mensagens (asc) presignando imageKey', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow())
    db.message.findMany.mockResolvedValue([msgRow(), msgRow({ id: 'm2', imageKey: 'chat/x.jpg', body: null })])
    const out = await new ChatService(db, media(), realtime()).listMessages(A, CONV)
    expect(db.message.findMany.mock.calls[0][0].orderBy).toEqual({ sentAt: 'asc' })
    expect(out[0].imageUri).toBeNull()
    expect(out[1].imageUri).toBe('signed:chat/x.jpg')
    expect(out[0].senderId).toBe(B)
  })

  it('sendMessage cria a conversa lazy (create-or-attach) quando não existe', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(null)
    db.user.findMany.mockResolvedValue([userRow(A), userRow(B)])
    db.conversation.create.mockResolvedValue(convRow({ lastMessageBody: null, lastMessageAt: null, unreadByJson: {} }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'novo' }))
    db.conversation.update.mockResolvedValue(convRow())
    const rt = realtime()
    const out = await new ChatService(db, media(), rt).sendMessage(A, CONV, { body: 'novo' })
    expect(db.conversation.create).toHaveBeenCalledTimes(1)     // lazy create
    const created = db.conversation.create.mock.calls[0][0].data
    expect(created.id).toBe(CONV)
    expect(created.participants).toEqual([A, B])                 // ordenado
    expect(out.body).toBe('novo')
    expect(rt.emitToUsers).toHaveBeenCalledWith([A, B], 'message', expect.objectContaining({ id: 'm1' }))
  })

  it('sendMessage anexa e incrementa unread do destinatário', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { bbbb: 1 } }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
    db.conversation.update.mockResolvedValue(convRow())
    await new ChatService(db, media(), realtime()).sendMessage(A, CONV, { body: 'e aí' })
    const upd = db.conversation.update.mock.calls[0][0].data
    expect(upd.unreadByJson).toEqual({ bbbb: 2 })                // +1 pro outro; não pra mim
    expect(upd.lastMessageBody).toBe('e aí')
  })

  it('sendMessage num conv que não me contém → 404', async () => {
    const db = prisma()
    await expect(new ChatService(db, media(), realtime()).sendMessage('zzzz', CONV, { body: 'x' })).rejects.toThrow(NotFoundException)
  })

  it('markRead zera meu unread (membership ok)', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { aaaa: 5, bbbb: 1 } }))
    db.conversation.update.mockResolvedValue(convRow())
    await new ChatService(db, media(), realtime()).markRead(A, CONV)
    expect(db.conversation.update.mock.calls[0][0].data.unreadByJson).toEqual({ aaaa: 0, bbbb: 1 })
  })
})
```

**Step 2:** `npx jest src/chat/chat.service.spec.ts` → FAIL.

**Step 3 — implementar** (`chat.service.ts`):
```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import type { Conversation, Message, User, Profile } from '@prisma/client'

type UserWithProfile = User & { profile: Profile | null }

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listDirectory(userId: string) {
    const users = await this.prisma.user.findMany({
      where: { approvalStatus: 'APPROVED', role: 'WORKER', id: { not: userId } },
      include: { profile: true },
      orderBy: { name: 'asc' },
    })
    return Promise.all(users.map((u) => this.toContact(u)))
  }

  async listConversations(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { has: userId } },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    })
    return Promise.all(rows.map((c) => this.toConvDto(c)))
  }

  async listMessages(userId: string, convId: string) {
    await this.assertMember(userId, convId)
    const rows = await this.prisma.message.findMany({ where: { conversationId: convId }, orderBy: { sentAt: 'asc' } })
    return Promise.all(rows.map((m) => this.toMsgDto(m)))
  }

  async sendMessage(userId: string, convId: string, dto: { body?: string; imageKey?: string }) {
    const participants = convId.split('#')
    if (!participants.includes(userId)) throw new NotFoundException('Conversa não encontrada')

    let conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
    if (!conv) conv = await this.createConversation(convId, participants)

    const now = new Date()
    const msg = await this.prisma.message.create({
      data: { conversationId: convId, senderId: userId, body: dto.body ?? null, imageKey: dto.imageKey ?? null, sentAt: now },
    })

    const unread: Record<string, number> = { ...((conv.unreadByJson as Record<string, number>) ?? {}) }
    for (const p of conv.participants) if (p !== userId) unread[p] = (unread[p] ?? 0) + 1
    await this.prisma.conversation.update({
      where: { id: convId },
      data: { lastMessageBody: dto.body || (dto.imageKey ? '📷 Imagem' : ''), lastMessageAt: now, unreadByJson: unread },
    })

    const out = await this.toMsgDto(msg)
    this.realtime.emitToUsers(conv.participants, 'message', out)
    return out
  }

  async markRead(userId: string, convId: string) {
    const conv = await this.assertMember(userId, convId)
    const unread: Record<string, number> = { ...((conv.unreadByJson as Record<string, number>) ?? {}) }
    unread[userId] = 0
    await this.prisma.conversation.update({ where: { id: convId }, data: { unreadByJson: unread } })
  }

  // ---- helpers ----
  private async assertMember(userId: string, convId: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
    if (!conv || !conv.participants.includes(userId)) throw new NotFoundException('Conversa não encontrada')
    return conv
  }

  private async createConversation(convId: string, parts: string[]): Promise<Conversation> {
    const users = await this.prisma.user.findMany({ where: { id: { in: parts } }, include: { profile: true } })
    const byId = new Map(users.map((u) => [u.id, u as UserWithProfile]))
    return this.prisma.conversation.create({
      data: {
        id: convId,
        participants: parts,
        participantNames: parts.map((id) => byId.get(id)?.profile?.fullName ?? byId.get(id)?.name ?? ''),
        participantSubtitles: parts.map((id) => byId.get(id)?.profile?.sector ?? ''),
        participantAvatarKeys: parts.map((id) => byId.get(id)?.profile?.avatarKey ?? ''),
        unreadByJson: {},
      },
    })
  }

  private async toContact(u: UserWithProfile) {
    return {
      workerId: u.id,
      name: u.profile?.fullName ?? u.name,
      sector: u.profile?.sector ?? '',
      role: u.profile?.jobTitle ?? '',
      avatarUri: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
    }
  }

  private async toConvDto(c: Conversation) {
    const participantAvatars = await Promise.all(
      c.participantAvatarKeys.map((k) => (k ? this.media.presignGet(k) : Promise.resolve(''))),
    )
    return {
      id: c.id,
      participants: c.participants,
      participantNames: c.participantNames,
      participantSubtitles: c.participantSubtitles,
      participantAvatars,
      lastMessageBody: c.lastMessageBody ?? '',
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      unreadBy: (c.unreadByJson as Record<string, number>) ?? {},
    }
  }

  private async toMsgDto(m: Message) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      participants: m.conversationId.split('#'),
      senderId: m.senderId,
      body: m.body ?? '',
      imageUri: m.imageKey ? await this.media.presignGet(m.imageKey) : null,
      sentAt: m.sentAt.toISOString(),
    }
  }
}
```

> **Nota Prisma:** `orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } }` exige Prisma ≥ 4.16 (o repo está em 5.22 — ok). Se o client reclamar do tipo, confirmar `npx prisma generate` na base.

**Step 4:** `npx jest src/chat/chat.service.spec.ts` → PASS (8/8).

**Step 5 — commit:**
```bash
git add swi-backend/src/chat/chat.service.ts swi-backend/src/chat/chat.service.spec.ts
git commit -m "feat(backend): ChatService (create-or-attach, membership 404, toDto presign, emit realtime)"
```

---

### Task 4: Chat DTO + Controller + Module + prefixo `chat` na mídia + registro

**Files:** Create `swi-backend/src/chat/dto.ts`, `chat.controller.ts`, `chat.module.ts`. Modify `swi-backend/src/media/dto.ts`, `swi-backend/src/media/media.controller.ts` (aceitar prefixo `chat`), `swi-backend/src/app.module.ts`.

**Step 1 — DTO** (`chat/dto.ts`; `imageKey` restrito ao prefixo `chat/` — anti-abuso):
```ts
import { IsOptional, IsString, Matches } from 'class-validator'
export class SendMessageDto {
  @IsOptional() @IsString() body?: string
  @IsOptional() @IsString()
  @Matches(/^chat\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey?: string
}
```
("pelo menos um dos dois" é checado no controller — Step 2.)

**Step 2 — Controller** (`chat.controller.ts`):
```ts
import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ChatService } from './chat.service'
import { SendMessageDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  listConversations(@Req() req: any) { return this.chat.listConversations(req.user.userId) }

  @Get('directory')
  listDirectory(@Req() req: any) { return this.chat.listDirectory(req.user.userId) }

  @Get('conversations/:id/messages')
  listMessages(@Req() req: any, @Param('id') id: string) { return this.chat.listMessages(req.user.userId, id) }

  @Post('conversations/:id/messages')
  send(@Req() req: any, @Param('id') id: string, @Body() dto: SendMessageDto) {
    if (!dto.body?.trim() && !dto.imageKey) throw new BadRequestException('Mensagem vazia')
    return this.chat.sendMessage(req.user.userId, id, dto)
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  markRead(@Req() req: any, @Param('id') id: string) { return this.chat.markRead(req.user.userId, id) }
}
```

**Step 3 — Module** (`chat.module.ts`):
```ts
import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'

@Module({ imports: [MediaModule, RealtimeModule], providers: [ChatService], controllers: [ChatController] })
export class ChatModule {}
```

**Step 4 — prefixo `chat` na mídia.** Em `swi-backend/src/media/dto.ts`, o `PresignDto.prefix` hoje aceita `['reports','task']` (Fatia 3). Adicionar `'chat'`:
```ts
@IsOptional() @IsString() @IsIn(['reports', 'task', 'chat']) prefix?: string
```
(o `media.controller.ts` já repassa `dto.prefix ?? 'reports'` — nenhuma mudança de fluxo).

**Step 5 — registrar** `ChatModule` **e** `RealtimeModule` em `app.module.ts` (array `imports`, ao lado de `JourneyModule`).
> ⚠️ **Edições acopladas (import + uso) com o hook Fact-Forcing:** aplicar **em passos separados** — primeiro o `import`, confirmar que passou, depois o array `imports`. (Lição da Fatia 3: um edit duplo pode aplicar fora de ordem e quebrar o build.)

**Step 6:** `npm run build` → exit 0; `npm test` → **55** (44 + 3 gateway + 8 service). Confirmar a contagem real e ajustar.

**Step 7 — commit:**
```bash
git add swi-backend/src/chat swi-backend/src/media/dto.ts swi-backend/src/app.module.ts
git commit -m "feat(backend): ChatModule (dto+controller+module) + prefixo chat/ na mídia + registro"
```

---

### Task 5: seed — workers aprovados + diretório + conversas/mensagens (Opção A)

**Files:** Modify `swi-backend/prisma/seed.ts`. Create `swi-backend/prisma/fixtures/chat-avatars/worker-{1..8}.png` (cópia dos assets do mobile — mantém o swi-backend self-contained).

**Step 1 — copiar 8 avatares** pro swi-backend:
```bash
mkdir -p swi-backend/prisma/fixtures/chat-avatars
cp mobile/assets/avatars/worker-1.png mobile/assets/avatars/worker-2.png \
   mobile/assets/avatars/worker-3.png mobile/assets/avatars/worker-4.png \
   mobile/assets/avatars/worker-5.png mobile/assets/avatars/worker-6.png \
   mobile/assets/avatars/worker-7.png mobile/assets/avatars/worker-8.png \
   swi-backend/prisma/fixtures/chat-avatars/
```

**Step 2 — estender `seed.ts`** (append no `main()`, depois do `worker` principal). Cria 8 workers aprovados (com Profile+avatar no MinIO) e semeia as conversas/mensagens espelhando o `DIRECTORY`/`THREADS` do mock (`mobile/services/chat/mockChatBackend.ts`). Usa o `worker` principal (`worker@swi.local`) como "eu":

```ts
// imports no topo (se ainda não houver da Fatia 3):
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { join } from 'path'

// ---- dentro do main(), após o worker principal (== "eu") ----
// conversationKey: paridade EXATA com mobile/services/chat/chatReducers.ts
const convKey = (a: string, b: string) => [a, b].sort().join('#')

// Diretório demo (subset dos 8 primeiros contatos do mock, com email determinístico).
const CONTACTS = [
  { n: 1, email: 'romulo@swi.local',   name: 'Romulo Cardoso',           sector: 'Setor Leste', role: 'Operador' },
  { n: 2, email: 'ezequiel@swi.local', name: 'Ezequiel Almeida',         sector: 'Setor Leste', role: 'Operador' },
  { n: 3, email: 'josue@swi.local',    name: 'Josué Oliveira',           sector: 'Setor Leste', role: 'Técnico de Manutenção' },
  { n: 4, email: 'carlos@swi.local',   name: 'Carlos Santos',            sector: 'Setor Leste', role: 'Operador' },
  { n: 5, email: 'antonio@swi.local',  name: 'Antonio Carlos Figueira',  sector: 'Setor Leste', role: 'Supervisor' },
  { n: 6, email: 'jennifer@swi.local', name: 'Jennifer Gomes',           sector: 'Setor Leste', role: 'Analista de Segurança' },
  { n: 7, email: 'adriana@swi.local',  name: 'Adriana Santos Almeida',   sector: 'Setor Leste', role: 'Operadora' },
  { n: 8, email: 'compressor@swi.local', name: 'Carlos Santos (Manut.)', sector: 'Setor Leste', role: 'Operador' },
]

// Threads espelhando o mock (baseDay decresce → recência; unread = badge do inbox de "eu").
type Seg = { from: 'me' | 'them'; body: string; time: string }
const THREADS: { n: number; unread: number; baseDay: string; texts: Seg[] }[] = [
  { n: 1, unread: 10, baseDay: '2026-06-23', texts: [
    { from: 'them', body: 'Vamos precisar alinhar com a equipe de transporte sobre os horários.', time: '13:42' },
    { from: 'me',   body: 'Combinado. Já enviei a planilha para o pessoal do operacional.', time: '13:50' },
    { from: 'them', body: 'Perfeito. Obrigado pelo retorno rápido.', time: '13:55' },
    { from: 'them', body: 'Ainda não recebemos atualizações recentes do setor de segurança.', time: '14:20' },
    { from: 'them', body: 'Bom dia! Alguma novidade sobre a detonação de explosivos na área 7?', time: '14:25' },
    { from: 'me',   body: 'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.', time: '14:57' },
    { from: 'them', body: 'Os especialistas estão agendando uma reunião para discutir os próximos passos.', time: '15:10' },
    { from: 'them', body: 'É recomendado manter a área isolada até segunda ordem das autoridades competentes.', time: '15:15' },
  ] },
  { n: 2, unread: 2, baseDay: '2026-06-22', texts: [
    { from: 'them', body: 'Conseguimos finalizar a inspeção do turno da manhã.', time: '09:10' },
    { from: 'me',   body: 'Ótimo, registra no relatório por favor.', time: '09:18' },
    { from: 'them', body: 'Já registrado. Algum ponto de atenção?', time: '09:30' },
  ] },
  { n: 3, unread: 2, baseDay: '2026-06-21', texts: [
    { from: 'them', body: 'A bomba hidráulica voltou a apresentar ruído.', time: '11:05' },
    { from: 'them', body: 'Vou abrir uma OS de manutenção preventiva.', time: '11:12' },
  ] },
  { n: 4, unread: 0, baseDay: '2026-06-20', texts: [
    { from: 'me',   body: 'Carlos, consegue cobrir o turno da tarde amanhã?', time: '16:40' },
    { from: 'them', body: 'Consigo sim, sem problema.', time: '16:52' },
  ] },
  { n: 5, unread: 0, baseDay: '2026-06-19', texts: [
    { from: 'them', body: 'Reunião de segurança confirmada para sexta às 14h.', time: '10:00' },
  ] },
  { n: 6, unread: 0, baseDay: '2026-06-18', texts: [
    { from: 'them', body: 'Os EPIs novos chegaram no almoxarifado.', time: '08:30' },
    { from: 'me',   body: 'Show, vou retirar os do nosso setor.', time: '08:45' },
  ] },
  { n: 7, unread: 0, baseDay: '2026-06-17', texts: [
    { from: 'me',   body: 'Adriana, o checklist da área 3 está pronto?', time: '13:20' },
    { from: 'them', body: 'Está, enviei por e-mail também.', time: '13:35' },
    { from: 'them', body: 'Qualquer coisa me avisa.', time: '13:36' },
  ] },
  { n: 8, unread: 0, baseDay: '2026-06-16', texts: [
    { from: 'them', body: 'Fechamos o reparo do compressor.', time: '17:05' },
  ] },
]

// S3 client + upload de avatar (mesmo guard da Fatia 3).
const s3 = new S3Client({
  endpoint: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
  forcePathStyle: true,
  region: process.env.MINIO_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  },
})
const bucket = process.env.MINIO_BUCKET ?? 'swi-media'
const uploadAvatar = async (n: number): Promise<string> => {
  const key = `chat/avatars/worker-${n}.png`
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key,
    Body: readFileSync(join(__dirname, 'fixtures', 'chat-avatars', `worker-${n}.png`)),
    ContentType: 'image/png',
  }))
  return key
}

// Cria/atualiza os 8 workers (aprovados) + Profile com avatar.
const bcrypt = await import('bcrypt')
const pass = await bcrypt.hash('worker123', 10)
const contactIds = new Map<number, string>()
for (const c of CONTACTS) {
  let avatarKey = ''
  try { avatarKey = await uploadAvatar(c.n) }
  catch (e) { console.warn(`[seed] avatar worker-${c.n} falhou (bucket up?):`, (e as Error).message) }
  const u = await prisma.user.upsert({
    where: { email: c.email },
    update: { approvalStatus: 'APPROVED', emailVerified: true },
    create: { email: c.email, name: c.name, passwordHash: pass, role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
  })
  contactIds.set(c.n, u.id)
  await prisma.profile.upsert({
    where: { userId: u.id },
    update: { fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey },
    create: { userId: u.id, fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey },
  })
}

// Semeia conversas + mensagens (idempotente: apaga as conversas de "eu" e recria).
const meId = worker.id  // "eu" = worker@swi.local (o objeto `worker` criado acima no seed)
const myConvIds = CONTACTS.map((c) => convKey(meId, contactIds.get(c.n)!))
await prisma.message.deleteMany({ where: { conversationId: { in: myConvIds } } })
await prisma.conversation.deleteMany({ where: { id: { in: myConvIds } } })

const isoFor = (day: string, time: string) => new Date(`${day}T${time}:00.000Z`)
for (const th of THREADS) {
  const otherId = contactIds.get(th.n)!
  const id = convKey(meId, otherId)
  const parts = [meId, otherId].sort()
  const other = CONTACTS.find((c) => c.n === th.n)!
  const meAvatar = '' // "eu" usa o avatar do meu Profile se houver; card resolve por índice
  await prisma.conversation.create({
    data: {
      id,
      participants: parts,
      participantNames: parts.map((p) => (p === meId ? 'Você' : other.name)),
      participantSubtitles: parts.map((p) => (p === meId ? '' : other.sector)),
      participantAvatarKeys: parts.map((p) => (p === meId ? meAvatar : `chat/avatars/worker-${th.n}.png`)),
      lastMessageBody: th.texts[th.texts.length - 1].body,
      lastMessageAt: isoFor(th.baseDay, th.texts[th.texts.length - 1].time),
      unreadByJson: th.unread > 0 ? { [meId]: th.unread } : {},
    },
  })
  for (const t of th.texts) {
    await prisma.message.create({
      data: {
        conversationId: id,
        senderId: t.from === 'me' ? meId : otherId,
        body: t.body,
        imageKey: null,
        sentAt: isoFor(th.baseDay, t.time),
      },
    })
  }
}
```

> **Nomes das variáveis:** confirmar como o seed atual (Fatia 3) nomeia o worker principal e o `prisma` client, e alinhar (`worker`, `prisma`). Se o seed usa `PrismaClient` inline, reusar a mesma instância.

**Step 3 — rodar** (stack up pro upload): `docker compose up -d && npm run prisma:seed` → sem erro; 8 users + 8 conversas + mensagens criadas; log dos avatares.

**Step 4 — commit:**
```bash
git add swi-backend/prisma/seed.ts swi-backend/prisma/fixtures/chat-avatars
git commit -m "feat(backend): seed do chat (8 workers aprovados + diretório + conversas/mensagens, avatares no MinIO)"
```

---

### Task 6: e2e chat (supertest vs Postgres real) + prova WS de 2 sockets

**Files:** Create `swi-backend/test/chat.e2e-spec.ts` (espelha o cabeçalho `process.env.MINIO_* ??=` do `reports`/`journey` e2e).

**Step 1 — teste.** Dois workers throwaway (A e B); exercita REST + o push real-time via 2 clientes socket.io (o app precisa de porta real → `app.listen(0)`):
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

describe('Chat e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const eA = 'chat-a@ex.com', eB = 'chat-b@ex.com'
  let idA = '', idB = '', convId = ''
  const key = (a: string, b: string) => [a, b].sort().join('#')
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }
  const cleanup = async () => {
    const ids = [idA, idB].filter(Boolean)
    if (ids.length) {
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } })
      await prisma.conversation.deleteMany({ where: { id: key(idA, idB) } })
    }
    await prisma.user.deleteMany({ where: { email: { in: [eA, eB] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    await app.listen(0) // porta real pro socket.io
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    const bcrypt = await import('bcrypt')
    const mk = async (email: string, name: string) => (await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    await cleanup()
    idA = await mk(eA, 'Chat A'); idB = await mk(eB, 'Chat B')
    convId = key(idA, idB)
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('sem token → 401', () => request(app.getHttpServer()).get('/chat/conversations').expect(401))

  it('listDirectory traz o outro worker', async () => {
    const t = await login(eA)
    const { body } = await request(app.getHttpServer()).get('/chat/directory').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(body.map((c: any) => c.workerId)).toContain(idB)
  })

  it('sendMessage cria a conversa e aparece nas listas; markRead zera unread', async () => {
    const tA = await login(eA), tB = await login(eB)
    await request(app.getHttpServer()).post(`/chat/conversations/${convId}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'oi B' }).expect(201)
    // B vê a conversa com unread 1
    const { body: convsB } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tB}` }).expect(200)
    const cB = convsB.find((c: any) => c.id === convId)
    expect(cB.unreadBy[idB]).toBe(1)
    // B lê as mensagens
    const { body: msgs } = await request(app.getHttpServer()).get(`/chat/conversations/${convId}/messages`).set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(msgs[0].body).toBe('oi B')
    // B markRead → unread zera
    await request(app.getHttpServer()).post(`/chat/conversations/${convId}/read`).set({ Authorization: `Bearer ${tB}` }).expect(204)
    const { body: convsB2 } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(convsB2.find((c: any) => c.id === convId).unreadBy[idB]).toBe(0)
  })

  it('não-membro → 404', async () => {
    const tA = await login(eA)
    const alheia = key('outro-x', 'outro-y')
    await request(app.getHttpServer()).get(`/chat/conversations/${alheia}/messages`).set({ Authorization: `Bearer ${tA}` }).expect(404)
  })

  it('mensagem vazia → 400', async () => {
    const tA = await login(eA)
    await request(app.getHttpServer()).post(`/chat/conversations/${convId}/messages`).set({ Authorization: `Bearer ${tA}` }).send({}).expect(400)
  })

  it('real-time: B recebe pelo socket a mensagem que A envia', async () => {
    const tA = await login(eA), tB = await login(eB)
    const sock: Socket = io(base, { auth: { token: tB }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      sock.on('message', resolve)
      sock.on('connect_error', reject)
      setTimeout(() => reject(new Error('timeout esperando message')), 4000)
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    await request(app.getHttpServer()).post(`/chat/conversations/${convId}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'push!' }).expect(201)
    const msg = await got
    expect(msg.body).toBe('push!')
    expect(msg.conversationId).toBe(convId)
    sock.close()
  })
})
```

**Step 2:** `docker compose up -d db` (se preciso) + `npm run test:e2e` → **26** (19 + 7 chat). MinIO **não** precisa estar up (presign é puro; o socket usa a porta do Nest).
> Se o teste de socket ficar flaky no CI (ordem connect/emit), manter o `await connect` antes do POST (já está) — é a barreira que garante que a sala foi entrada antes da emissão.

**Step 3 — commit:**
```bash
git add swi-backend/test/chat.e2e-spec.ts
git commit -m "test(backend): e2e do chat (REST + membership + prova WS de 2 sockets)"
```

---

### Task 7 (mobile): singleton de sessão + wiring no apiAuthBackend (TDD)

**Files:** Create `mobile/services/api/session.ts` + `session.test.ts`. Modify `mobile/services/auth/apiAuthBackend.ts` (+`apiAuthBackend.test.ts`).

**Step 1 — teste** (`session.test.ts`):
```ts
import { setUserId, getUserId, clearUserId } from './session'
describe('session singleton', () => {
  afterEach(() => clearUserId())
  it('default vazio', () => { expect(getUserId()).toBe('') })
  it('set/get', () => { setUserId('u1'); expect(getUserId()).toBe('u1') })
  it('clear volta a vazio', () => { setUserId('u1'); clearUserId(); expect(getUserId()).toBe('') })
})
```

**Step 2:** `cd mobile && npx jest services/api/session.test.ts` → FAIL.

**Step 3 — implementar** (`session.ts`):
```ts
// Id do worker logado, em memória, pra APIs que precisam do `myId` de forma
// SÍNCRONA (o token vive no SecureStore, que é async). Populado no login.
let userId = '';
export function setUserId(id: string): void { userId = id ?? ''; }
export function getUserId(): string { return userId; }
export function clearUserId(): void { userId = ''; }
```

**Step 4 — wiring** no `apiAuthBackend.ts`: `signIn` e `getCurrentUser` gravam o id; `signOut` limpa.
```ts
import { setUserId, clearUserId } from '../api/session'
// signIn, após pegar { accessToken, user }:
await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
setUserId(user.id)
return user
// getCurrentUser, no caminho de sucesso: const u = await apiRequest('/auth/me', { auth: true }); setUserId(u.id); return u
// signOut: await SecureStore.deleteItemAsync(TOKEN_KEY); clearUserId()
```
Atualizar `apiAuthBackend.test.ts`: após `signIn`, `expect(getUserId()).toBe(<id do user mockado>)`; após `signOut`, `expect(getUserId()).toBe('')`.

**Step 5:** `npx jest services/api/session.test.ts services/auth/apiAuthBackend.test.ts` → PASS. `npx tsc --noEmit` (8 baseline).

**Step 6 — commit:**
```bash
git add mobile/services/api/session.ts mobile/services/api/session.test.ts mobile/services/auth/apiAuthBackend.ts mobile/services/auth/apiAuthBackend.test.ts
git commit -m "feat(mobile): singleton de sessão (userId síncrono) populado no login"
```

---

### Task 8 (mobile): `apiChatBackend` + despin do selector (TDD)

**Files:** Create `mobile/services/chat/apiChatBackend.ts` + `apiChatBackend.test.ts`. Delete `mobile/services/chat/amplifyChatBackend.ts`. Modify `getChatBackend.ts` + `getChatBackend.test.ts`.

**Step 1 — teste** (`apiChatBackend.test.ts`; mocka `../api/http`, `../api/uploadMedia`, `../api/session`, `socket.io-client`, `expo-secure-store`):
```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }))
jest.mock('../api/session', () => ({ getUserId: jest.fn(() => 'me') }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'tok') }))
const on = jest.fn(); const close = jest.fn()
const ioMock = jest.fn(() => ({ on, close }))
jest.mock('socket.io-client', () => ({ io: (...a: any[]) => ioMock(...a) }))

import { apiRequest } from '../api/http'
import { uploadImage } from '../api/uploadMedia'
import { apiChatBackend } from './apiChatBackend'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('apiChatBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); (uploadImage as jest.Mock).mockReset(); ioMock.mockClear(); on.mockClear(); close.mockClear() })

  it('myId vem do singleton de sessão', () => { expect(apiChatBackend.myId).toBe('me') })

  it('listConversations → GET /chat/conversations', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 'a#b' }])
    await apiChatBackend.listConversations()
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations', { auth: true })
  })

  it('listMessages → GET /chat/conversations/:id/messages', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiChatBackend.listMessages('a#b')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a#b/messages', { auth: true })
  })

  it('listDirectory → GET /chat/directory', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiChatBackend.listDirectory()
    expect(apiRequest).toHaveBeenCalledWith('/chat/directory', { auth: true })
  })

  it('sendMessage sem imagem → POST body', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'm1' })
    await apiChatBackend.sendMessage('a#b', 'oi')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a#b/messages', { method: 'POST', body: { body: 'oi' }, auth: true })
  })

  it('sendMessage com imagem sobe (prefixo chat) e manda a key', async () => {
    (uploadImage as jest.Mock).mockResolvedValue('chat/k.jpg')
    ;(apiRequest as jest.Mock).mockResolvedValue({ id: 'm1' })
    await apiChatBackend.sendMessage('a#b', '', 'file:///x.jpg')
    expect(uploadImage).toHaveBeenCalledWith('file:///x.jpg', 'chat')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a#b/messages', { method: 'POST', body: { body: '', imageKey: 'chat/k.jpg' }, auth: true })
  })

  it('markRead → POST /read', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiChatBackend.markRead('a#b')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a#b/read', { method: 'POST', auth: true })
  })

  it('subscribe conecta o socket e entrega só as msgs do filtro', async () => {
    const cb = jest.fn()
    const unsub = apiChatBackend.subscribe(null, cb)
    await flush()
    expect(ioMock).toHaveBeenCalledTimes(1)
    const handler = on.mock.calls.find((c) => c[0] === 'message')![1]
    handler({ conversationId: 'a#b', body: 'x' })
    expect(cb).toHaveBeenCalledWith({ conversationId: 'a#b', body: 'x' })
    unsub(); expect(close).toHaveBeenCalled()
  })

  it('subscribe(convId) filtra outras conversas', async () => {
    const cb = jest.fn()
    apiChatBackend.subscribe('a#b', cb)
    await flush()
    const handler = on.mock.calls.find((c) => c[0] === 'message')![1]
    handler({ conversationId: 'OUTRA', body: 'y' })
    expect(cb).not.toHaveBeenCalled()
    handler({ conversationId: 'a#b', body: 'z' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2:** `npx jest services/chat/apiChatBackend.test.ts` → FAIL.

**Step 3 — implementar** (`apiChatBackend.ts`):
```ts
import * as SecureStore from 'expo-secure-store';
import { io, type Socket } from 'socket.io-client';
import type { ChatBackend, Conversation, Message, Contact } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { getUserId } from '../api/session';
import { API_URL } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Backend já devolve o shape mobile pronto (URLs presigned, ISO) → sem fromApi.
// `subscribe` troca o event-bus in-memory do mock por um socket.io real; o
// ChatProvider só usa subscribe(null), mas o filtro por convId é honrado.
export const apiChatBackend: ChatBackend = {
  get myId() { return getUserId(); },

  listConversations() { return apiRequest<Conversation[]>('/chat/conversations', { auth: true }); },
  listMessages(conversationId) { return apiRequest<Message[]>(`/chat/conversations/${conversationId}/messages`, { auth: true }); },
  listDirectory() { return apiRequest<Contact[]>('/chat/directory', { auth: true }); },

  async sendMessage(conversationId, body, imageUri) {
    const imageKey = imageUri ? await uploadImage(imageUri, 'chat') : undefined;
    const payload = imageKey ? { body, imageKey } : { body };
    return apiRequest<Message>(`/chat/conversations/${conversationId}/messages`, { method: 'POST', body: payload, auth: true });
  },

  async markRead(conversationId) {
    await apiRequest<void>(`/chat/conversations/${conversationId}/read`, { method: 'POST', auth: true });
  },

  subscribe(conversationId, cb) {
    let socket: Socket | null = null;
    let closed = false;
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (closed) return;
      socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
      socket.on('message', (m: Message) => {
        if (conversationId === null || m.conversationId === conversationId) cb(m);
      });
    })();
    return () => { closed = true; socket?.close(); };
  },
};
```
> **`myId` getter:** o `ChatBackend` declara `readonly myId: string`. Um `get myId()` satisfaz a interface (propriedade de leitura) e lê o singleton no momento do uso — melhor que capturar '' no import.

**Step 4 — despin** `getChatBackend.ts`:
```ts
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';
import { apiChatBackend } from './apiChatBackend';

export function getChatBackend(): ChatBackend {
  return DATA_BACKEND === 'api' ? apiChatBackend : mockChatBackend;
}
```
E `getChatBackend.test.ts`: caso "api" espera `apiChatBackend` (espelha `getJourneyBackend.test`). Deletar `amplifyChatBackend.ts`.
> Confirmar o import da flag: usar o MESMO caminho que `getJourneyBackend.ts`/`getReportsBackend.ts` (`../../lib/featureFlags`). Se o mock atual do `getChatBackend` importava outro path, alinhar.

**Step 5:** `npx tsc --noEmit` (8, 0 novos) + `npx jest services/chat services/api` (verde). `git grep "amplifyChatBackend" -- mobile/` → vazio.

**Step 6 — commit:**
```bash
git add mobile/services/chat/apiChatBackend.ts mobile/services/chat/apiChatBackend.test.ts mobile/services/chat/getChatBackend.ts mobile/services/chat/getChatBackend.test.ts
git rm mobile/services/chat/amplifyChatBackend.ts
git commit -m "feat(mobile): apiChatBackend (REST + socket.io) + despin do seam de chat; aposenta amplify"
```

---

### Task 9: docker smoke (2 sockets) + tripé mobile + two-gate + PR

**Step 1 — smoke** (round-trip real que tsc/jest não provam; stack + seed + 2 sockets):
```bash
cd swi-backend && docker compose up --build -d && sleep 8 && npm run prisma:seed
# login "eu" + um contato do seed
MET=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}' | grep -o '"accessToken":"[^"]*"' | sed 's/.*:"//;s/"//')
BT=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"romulo@swi.local","password":"worker123"}' | grep -o '"accessToken":"[^"]*"' | sed 's/.*:"//;s/"//')
# diretório + inbox populado (Opção A)
curl -s -o /dev/null -w 'DIR=%{http_code}\n' localhost:3000/chat/directory -H "Authorization: Bearer $MET"
curl -s localhost:3000/chat/conversations -H "Authorization: Bearer $MET" | grep -o '"lastMessageBody":"[^"]*"' | head -3
```
Prova WS (Node com o socket.io-client do mobile), num arquivo `swi-backend/tmp-smoke.mjs` (apagar depois):
```js
import { io } from '../mobile/node_modules/socket.io-client/dist/socket.io.esm.min.js'
const MET = process.env.MET, BT = process.env.BT
const me = process.argv[2], other = process.argv[3]  // ids
const conv = [me, other].sort().join('#')
const s = io('http://localhost:3000', { auth: { token: BT }, transports: ['websocket'] })
s.on('connect', async () => {
  s.on('message', (m) => { console.log('RECEBIDO', m.body); process.exit(0) })
  await fetch(`http://localhost:3000/chat/conversations/${conv}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MET}` }, body: JSON.stringify({ body: 'push real-time!' }) })
})
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 5000)
```
Rodar com os ids reais (pegar do `/chat/directory`): `MET=$MET BT=$BT node swi-backend/tmp-smoke.mjs <meId> <romuloId>` → imprime `RECEBIDO push real-time!`. Depois: `rm swi-backend/tmp-smoke.mjs`.
> Se o import cross-sibling do socket.io-client atritar no Windows, usar o próprio e2e de socket (Task 6) como prova automatizada e reduzir o smoke ao REST + seed.

Expected: `DIR=200`; inbox lista `lastMessageBody`; WS imprime `RECEBIDO`.

**Step 2 — tripé mobile:** `cd mobile && npx tsc --noEmit` (8) `; npx jest` (verde, 151 + novos) `; npx expo export --platform web` (exit 0).

**Step 3 — two-gate + holística:** review spec-compliance (bate no design, campo-a-campo) + quality por metade (backend, mobile) via subagents; review holística da fatia. Corrigir legítimos/no-escopo e re-verificar verde. Atenção especial ao real-time (o smoke/e2e de socket é a prova) e ao `myId` síncrono.

**Step 4 — push + PR** (SÓ com luz verde explícita): `git push -u origin feat/backend-chat` + PR contra `main` (REST API — sem `gh`; corpo em arquivo no scratchpad; **sem rodapé de IA**). Se empilhado na Fatia 3, retarget/rebase após #27 mergear.

---

## Fora do escopo (YAGNI)

- Bot de eco / respondedor sintético (o outro lado não responde sozinho — paridade com o mock; real-time provado por 2 sockets).
- Presença / "digitando" / recibo de entrega-leitura (fora do contrato do seam).
- Paginação de conversas/mensagens.
- Push de SO (`expo-notifications`/SNS) — Fatia 5+.
- Saúde/vitals (mock permanente até a smartband).
- Deploy AWS (WS atrás do ALB com sticky/Redis adapter se >1 réplica; MinIO→S3; `chat/avatars` do seed vira fixture/IaC; segredo JWT via SSM) — herança da rodada.
- Notificações/clima/evacuação — fatias seguintes.

---

## Nota de commits

A rodada commita **por task** mas **só com luz verde explícita do usuário** (regra do projeto: aprovar plano ≠ autorizar commit). Os blocos `git commit` acima são o ponto de corte sugerido; executá-los depende do OK. O design-doc + este plano vão num commit `docs(backend): design + plano da Fatia 4 (Chat)` (paridade com o `25f214d` da Fatia 3), também sob luz verde.
