# Chat real no painel admin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fiar o chat do admin (página `ChatInbox` + painel `ChatSection` da sidebar) ao backend de chat pronto — REST pra escrever, socket.io pra receber ao vivo — copiando o padrão do mobile, com anexo de imagem.

**Architecture:** Um `ChatProvider` (React Context) compartilhado serve as duas superfícies. Camada pura (`chatReducers`/`types` copiados do mobile) + client REST no envelope (`api/chats.ts`) + socket (`chat/chatSocket.ts`) + mapeadores DTO→tipos-da-UI. A UI (`ChatInbox`, `AppLayout`) troca o mock pelo provider mantendo os componentes DS como estão.

**Tech Stack:** React + react-native-web, Vitest (globals, `fireEvent`), `@kavicki/swi-design-system`, `socket.io-client`, `apiFetch` (envelope `MockResponse {data,error}`).

**Ref design:** `docs/plans/2026-07-23-swi-admin-chat-realtime-design.md`

**Paths:** cwd = `mobile/`; admin em `../swi-admin`. Rodar comandos do admin com `cd ../swi-admin`.

**Contrato backend (não muda):** ver o design. Resumo: `GET /chat/conversations|directory`, `GET/POST /chat/conversations/:id/messages`, `POST /chat/conversations/:id/read` (204). Socket emite só `message` (MessageDto). Conversa id = `[a,b].sort().join('#')` (encodeURIComponent no `#`). DTOs: `Conversation{id,participants[],participantNames[],participantSubtitles[],participantAvatars[],lastMessageBody,lastMessageAt,unreadBy}`, `Message{id,conversationId,participants[],senderId,body,imageUri,sentAt}`, `Contact{workerId,name,sector,role,avatarUri}`.

---

## Task 0: dependência socket.io-client

**Step 1:** `cd ../swi-admin && npm install socket.io-client`
**Step 2:** Confirmar que entrou em `dependencies` do `package.json` (não devDeps).
**Step 3: Commit** `chore(admin): adiciona socket.io-client`.

---

## Unidade A — Camada de fiação (pura, sem UI)

### Task A1: copiar tipos + reducers do mobile

**Files:**
- Create: `swi-admin/src/services/chat/types.ts`
- Create: `swi-admin/src/services/chat/chatReducers.ts`
- Create: `swi-admin/src/services/chat/chatReducers.test.ts`

**Step 1:** Copiar **verbatim** de `mobile/services/chat/types.ts` as interfaces `Conversation`, `Message`, `Contact` (deixar de fora `ChatBackend` — o admin não usa a interface de swap). Ajustar o comentário de topo pra "mirror do swi-backend".

**Step 2:** Copiar **verbatim** `mobile/services/chat/chatReducers.ts` (funções `conversationKey`, `unreadFor`, `resolveContact`, `sortByRecent`, `applyMessage`, `markRead` + `ResolvedContact`). É código puro, sem deps externas.

**Step 3: Escrever o teste (RED)** `chatReducers.test.ts`:
```ts
import { conversationKey, applyMessage, markRead, unreadFor } from './chatReducers'
import type { Conversation, Message } from './types'

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'a#b', participants: ['a', 'b'], participantNames: ['A', 'B'],
  participantSubtitles: ['', ''], participantAvatars: ['', ''],
  lastMessageBody: '', lastMessageAt: null, unreadBy: {}, ...over,
})
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', conversationId: 'a#b', participants: ['a', 'b'], senderId: 'b',
  body: 'oi', imageUri: null, sentAt: '2026-07-23T10:00:00.000Z', ...over,
})

describe('conversationKey', () => {
  it('ordena e junta com #', () => {
    expect(conversationKey('b', 'a')).toBe('a#b')
    expect(conversationKey('a', 'b')).toBe('a#b')
  })
})
describe('applyMessage', () => {
  it('incrementa unread de todos menos o remetente e atualiza lastMessage', () => {
    const [c] = applyMessage([conv()], msg({ senderId: 'b', body: 'oi' }))
    expect(c!.unreadBy).toEqual({ a: 1 })
    expect(c!.lastMessageBody).toBe('oi')
    expect(c!.lastMessageAt).toBe('2026-07-23T10:00:00.000Z')
  })
  it('mensagem só-imagem usa "📷 Imagem" no lastMessage', () => {
    const [c] = applyMessage([conv()], msg({ body: '', imageUri: 'x' }))
    expect(c!.lastMessageBody).toBe('📷 Imagem')
  })
  it('re-ordena por recência (mais nova primeiro)', () => {
    const older = conv({ id: 'a#b', lastMessageAt: '2026-07-20T00:00:00.000Z' })
    const newer = conv({ id: 'a#c', participants: ['a','c'], lastMessageAt: '2026-07-22T00:00:00.000Z' })
    const out = applyMessage([older, newer], msg({ conversationId: 'a#b', sentAt: '2026-07-23T00:00:00.000Z' }))
    expect(out[0]!.id).toBe('a#b')
  })
})
describe('markRead', () => {
  it('zera unread do myId', () => {
    const [c] = markRead([conv({ unreadBy: { a: 3 } })], 'a#b', 'a')
    expect(unreadFor(c!, 'a')).toBe(0)
  })
})
```

**Step 4: Rodar (RED→GREEN):** `cd ../swi-admin && npx vitest run src/services/chat/chatReducers.test.ts`. Como é cópia fiel, deve passar direto (o teste protege a cópia).

**Step 5: Commit** `feat(admin): copia types + chatReducers do mobile (camada pura de chat)`.

### Task A2: client REST `api/chats.ts`

**Files:**
- Create: `swi-admin/src/services/api/chats.ts`
- Create: `swi-admin/src/services/api/chats.test.ts`

**Step 1: Escrever o teste (RED)** `chats.test.ts` (segue o estilo do `users.test.ts`: stub de `fetch`, envelope `{data,error}`):
```ts
import { vi } from 'vitest'
import { chatsApi } from './chats'

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)
afterEach(() => vi.unstubAllGlobals())

describe('chatsApi.listConversations', () => {
  it('GET /chat/conversations no envelope', async () => {
    const f = okJson([{ id: 'a#b' }]); vi.stubGlobal('fetch', f)
    const { data, error } = await chatsApi.listConversations()
    expect(error).toBeNull(); expect(data![0]!.id).toBe('a#b')
    expect((f.mock.calls[0] as [string])[0]).toContain('/chat/conversations')
  })
})
describe('chatsApi.listMessages', () => {
  it('encoda o # do id na URL', async () => {
    const f = okJson([]); vi.stubGlobal('fetch', f)
    await chatsApi.listMessages('a#b')
    expect((f.mock.calls[0] as [string])[0]).toContain('/chat/conversations/a%23b/messages')
  })
})
describe('chatsApi.sendMessage', () => {
  it('POST body {body,imageKey}', async () => {
    const f = okJson({ id: 'm1' }); vi.stubGlobal('fetch', f)
    await chatsApi.sendMessage('a#b', { body: 'oi', imageKey: 'chat/x.jpg' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/chat/conversations/a%23b/messages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ body: 'oi', imageKey: 'chat/x.jpg' })
  })
})
describe('chatsApi.markRead', () => {
  it('POST /read (204 → data null, error null)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)
    const { error } = await chatsApi.markRead('a#b')
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/chat/conversations/a%23b/read'); expect(init.method).toBe('POST')
  })
})
describe('erro de rede', () => {
  it('→ {data:null, error}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    const { data, error } = await chatsApi.listConversations()
    expect(data).toBeNull(); expect(error?.message).toBeTruthy()
  })
})
```

**Step 2: Implementar (GREEN)** `chats.ts` — envelope idêntico ao `api/users.ts` (importar o helper de envelope que o users.ts usa; se for inline lá, replicar o mesmo `try { return { data: await apiFetch(...), error: null } } catch (e) { return { data: null, error: e as ApiError } }`). Verificar primeiro como `api/users.ts` embrulha e **reusar o mesmo padrão/helper**.
```ts
import { apiFetch, type ApiError } from './http'
import type { Conversation, Message, Contact } from '../chat/types'
import type { MockResponse } from '../mockApi/types'

const conv = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`
async function envelope<T>(p: Promise<T>): Promise<MockResponse<T>> {
  try { return { data: await p, error: null } }
  catch (e) { return { data: null, error: e as ApiError } }
}

export const chatsApi = {
  listConversations: () => envelope(apiFetch<Conversation[]>('/chat/conversations')),
  listDirectory: () => envelope(apiFetch<Contact[]>('/chat/directory')),
  listMessages: (id: string) => envelope(apiFetch<Message[]>(`${conv(id)}/messages`)),
  sendMessage: (id: string, dto: { body?: string; imageKey?: string }) =>
    envelope(apiFetch<Message>(`${conv(id)}/messages`, { method: 'POST', body: JSON.stringify(dto) })),
  markRead: (id: string) =>
    envelope(apiFetch<null>(`${conv(id)}/read`, { method: 'POST' })),
}
```
> Se `api/users.ts` já exporta um helper de envelope, importar dele em vez de redefinir `envelope` (DRY). Conferir antes de escrever.

**Step 3: Rodar** `npx vitest run src/services/api/chats.test.ts` → PASS.
**Step 4: Commit** `feat(admin): api/chats.ts (REST de chat no envelope)`.

### Task A3: `chatSocket.ts` (recebe `message` ao vivo)

**Files:**
- Create: `swi-admin/src/services/chat/chatSocket.ts`
- Create: `swi-admin/src/services/chat/chatSocket.test.ts`

**Step 1: Implementar** `chatSocket.ts` (porta do `subscribe` do mobile; token do `readToken()`, URL do `VITE_API_URL`):
```ts
import { io, type Socket } from 'socket.io-client'
import type { Message } from './types'
import { readToken } from '../api/http'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// Assina o canal global de mensagens ao vivo. Retorna cleanup. O server só
// emite 'message'; toda escrita é REST (ver design).
export function subscribeMessages(cb: (m: Message) => void): () => void {
  const socket: Socket = io(BASE_URL, {
    auth: { token: readToken() },
    transports: ['websocket'],
  })
  socket.on('message', cb)
  return () => { socket.close() }
}
```

**Step 2: Escrever o teste (RED→GREEN)** `chatSocket.test.ts` — mockar `socket.io-client`:
```ts
import { vi } from 'vitest'
const onMock = vi.fn(); const closeMock = vi.fn()
const ioMock = vi.fn(() => ({ on: onMock, close: closeMock }))
vi.mock('socket.io-client', () => ({ io: ioMock }))
import { subscribeMessages } from './chatSocket'

afterEach(() => { onMock.mockClear(); closeMock.mockClear(); ioMock.mockClear() })

it('conecta com auth.token e transports websocket, assina message, cleanup fecha', () => {
  const cb = vi.fn()
  const stop = subscribeMessages(cb)
  const opts = (ioMock.mock.calls[0] as [string, any])[1]
  expect(opts.transports).toEqual(['websocket'])
  expect('token' in opts.auth).toBe(true)
  expect((onMock.mock.calls[0] as [string, unknown])[0]).toBe('message')
  stop(); expect(closeMock).toHaveBeenCalled()
})
```

**Step 3: Rodar** `npx vitest run src/services/chat/chatSocket.test.ts` → PASS.
**Step 4: Commit** `feat(admin): chatSocket.ts (socket.io recebe message ao vivo)`.

### Task A4: mapeadores DTO → tipos da UI

**Files:**
- Create: `swi-admin/src/services/chat/chatMap.ts`
- Create: `swi-admin/src/services/chat/chatMap.test.ts`

Contexto: a UI (`ChatInbox`, `ChatSection`) consome `ChatContact`/`ChatMessage` de `mockApi/chats.ts`. Mapear os DTOs reais nesses shapes evita reescrever a UI. **`ChatMessage` ganha `imageUri?` na Task B1** — o mapper já emite o campo.

**Step 1: Escrever o teste (RED)** `chatMap.test.ts`:
```ts
import { messageToUi, conversationToContact, directoryToContact, timeOf } from './chatMap'
import type { Conversation, Message, Contact } from './types'

const myId = 'me'
const message = (o: Partial<Message> = {}): Message => ({
  id: 'm1', conversationId: 'me#w1', participants: ['me','w1'], senderId: 'w1',
  body: 'oi', imageUri: null, sentAt: '2026-07-23T13:05:00.000Z', ...o,
})

describe('messageToUi', () => {
  it('senderId===myId → "me"; senão "them"; mapeia text/imageUri/time', () => {
    expect(messageToUi(message({ senderId: 'me' }), myId).sender).toBe('me')
    const m = messageToUi(message({ senderId: 'w1', body: 'oi', imageUri: 'u' }), myId)
    expect(m.sender).toBe('them'); expect(m.text).toBe('oi'); expect(m.imageUri).toBe('u')
    expect(m.time).toMatch(/\d{2}:\d{2}/)
  })
})
describe('conversationToContact', () => {
  it('id = conversationId; nome/setor/avatar do participante que não sou eu; unread e messages', () => {
    const c: Conversation = {
      id: 'me#w1', participants: ['me','w1'], participantNames: ['Eu','Worker Um'],
      participantSubtitles: ['','Setor Leste'], participantAvatars: ['','av1'],
      lastMessageBody: 'oi', lastMessageAt: '2026-07-23T13:05:00.000Z', unreadBy: { me: 2 },
    }
    const ct = conversationToContact(c, [message()], myId)
    expect(ct.id).toBe('me#w1'); expect(ct.name).toBe('Worker Um')
    expect(ct.sector).toBe('Setor Leste'); expect(ct.avatarUri).toBe('av1')
    expect(ct.unreadCount).toBe(2); expect(ct.messages!.length).toBe(1)
  })
})
describe('directoryToContact', () => {
  it('Contact do directory → ChatContact com id = conversationKey(myId, workerId), sem messages', () => {
    const d: Contact = { workerId: 'w9', name: 'Zé', sector: 'Norte', role: 'Operador', avatarUri: 'a9' }
    const ct = directoryToContact(d, myId)
    expect(ct.id).toBe('me#w9'); expect(ct.name).toBe('Zé'); expect(ct.role).toBe('Operador')
  })
})
```

**Step 2: Implementar (GREEN)** `chatMap.ts`:
```ts
import type { Conversation, Message, Contact } from './types'
import { conversationKey, resolveContact, unreadFor } from './chatReducers'
import type { ChatContact, ChatMessage } from '../mockApi/chats'

export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function messageToUi(m: Message, myId: string): ChatMessage {
  return {
    id: m.id,
    text: m.body,
    sender: m.senderId === myId ? 'me' : 'them',
    time: timeOf(m.sentAt),
    imageUri: m.imageUri ?? undefined,
  }
}

export function conversationToContact(c: Conversation, msgs: Message[], myId: string): ChatContact {
  const r = resolveContact(c, myId)
  return {
    id: c.id, name: r.name, sector: r.subtitle, avatarUri: r.avatarUri,
    subtitle: r.subtitle, unreadCount: unreadFor(c, myId) || undefined,
    messages: msgs.map((m) => messageToUi(m, myId)),
  }
}

export function directoryToContact(d: Contact, myId: string): ChatContact {
  return {
    id: conversationKey(myId, d.workerId), name: d.name, sector: d.sector,
    avatarUri: d.avatarUri, role: d.role, subtitle: d.sector,
  }
}
```

**Step 3: Rodar** `npx vitest run src/services/chat/chatMap.test.ts` → PASS.
**Step 4: Commit** `feat(admin): mapeadores DTO→ChatContact/ChatMessage`.

### Task A5: `ChatProvider`

**Files:**
- Create: `swi-admin/src/services/chat/ChatProvider.tsx`
- Create: `swi-admin/src/services/chat/ChatProvider.test.tsx`

Estado: `conversations: Conversation[]`, `messagesByConv: Record<string, Message[]>`, `directory: Contact[]`, `loadStatus: 'loading'|'ready'|'empty'|'error'`. Expõe `myId`, `load()`, `openConversation(id)`, `send(id, body, file?)`, `keyFor(workerId)`. Usa um ref-mirror de `conversations` pra o listener não fechar sobre estado velho (igual mobile).

**Step 1: Escrever o teste (RED)** `ChatProvider.test.tsx` — mockar `api/chats`, `chatSocket`, `api/upload`, e um `useAuth` com `user.id='me'`. Um componente-sonda consome o context e dispara ações:
```ts
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

const listConversations = vi.fn()
const listDirectory = vi.fn(async () => ({ data: [], error: null }))
const listMessages = vi.fn(async () => ({ data: [], error: null }))
const sendMessage = vi.fn(async () => ({ data: null, error: null }))
const markRead = vi.fn(async () => ({ data: null, error: null }))
vi.mock('../api/chats', () => ({ chatsApi: { listConversations, listDirectory, listMessages, sendMessage, markRead } }))
let socketCb: (m: any) => void = () => {}
vi.mock('./chatSocket', () => ({ subscribeMessages: (cb: any) => { socketCb = cb; return () => {} } }))
vi.mock('../api/upload', () => ({ uploadImage: vi.fn(async () => 'chat/x.jpg') }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

import { ChatProvider, useChat } from './ChatProvider'

function Probe() {
  const { loadStatus, conversations, send } = useChat()
  return (
    <>
      <span data-testid="status">{loadStatus}</span>
      <span data-testid="count">{conversations.length}</span>
      <button onClick={() => send('me#w1', 'oi')}>send</button>
    </>
  )
}
const setup = () => render(<ChatProvider><Probe /></ChatProvider>)

it('carrega e fica ready com conversas', async () => {
  listConversations.mockResolvedValueOnce({ data: [{ id: 'me#w1', participants: ['me','w1'], participantNames:['Eu','W'], participantSubtitles:['',''], participantAvatars:['',''], lastMessageBody:'', lastMessageAt:null, unreadBy:{} }], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  expect(screen.getByTestId('count').textContent).toBe('1')
})
it('mensagem do socket de conversa desconhecida → refetch da lista', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  listConversations.mockResolvedValueOnce({ data: [{ id: 'me#w2', participants:['me','w2'], participantNames:['Eu','W2'], participantSubtitles:['',''], participantAvatars:['',''], lastMessageBody:'oi', lastMessageAt:'2026-07-23T10:00:00Z', unreadBy:{ me:1 } }], error: null })
  socketCb({ id:'m1', conversationId:'me#w2', participants:['me','w2'], senderId:'w2', body:'oi', imageUri:null, sentAt:'2026-07-23T10:00:00Z' })
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
})
it('send chama chatsApi.sendMessage', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  fireEvent.click(screen.getByText('send'))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('me#w1', { body: 'oi' }))
})
```

**Step 2: Implementar (GREEN)** `ChatProvider.tsx`. Pontos-chave:
- `useEffect` no mount: `load()` (Promise.all conversations+directory; set `loadStatus`) e `subscribeMessages(onMessage)` (cleanup no unmount).
- `conversationsRef` espelha `conversations` (atualizar em todo setConversations) — o `onMessage` lê do ref.
- `onMessage(m)`: se `conversationsRef.current` tem `m.conversationId` → `setConversations(applyMessage(prev, m))` e, se aquele thread já está em `messagesByConv`, append; senão → `refetchConversations()` (nova conversa). Se `m.conversationId === openConvRef.current` e `m.senderId !== myId` → `markRead` REST + `setConversations(markReadReducer(...))`.
- `openConversation(id)`: `listMessages(id)` → `messagesByConv[id]`; `markRead(id)` REST + `markRead` reducer; seta `openConvRef.current = id`.
- `send(id, body, file?)`: `const imageKey = file ? await uploadImage(file) : undefined; await chatsApi.sendMessage(id, imageKey ? { body, imageKey } : { body })`. **Sem otimista** (o eco do socket aplica). Se `error` → repassar pro caller (throw/retorno) pra UI dar toast.
- `keyFor(workerId)` = `conversationKey(myId, workerId)`.
- `myId` = `useAuth().user?.id ?? ''`.
- Exporta `useChat()` (throw se fora do provider).
- `uploadImage(file)` = a função generalizada da Task B3 (import de `../api/upload`). Para o teste, `../api/upload` é mockado, então a assinatura só precisa existir. **Fazer B3 antes de A5 se preferir a implementação real já pronta** (ver nota de ordem no fim).

**Step 3: Rodar** `npx vitest run src/services/chat/ChatProvider.test.tsx` → PASS.
**Step 4: Commit** `feat(admin): ChatProvider (estado real de chat: load/open/send + socket)`.

---

## Unidade B — UI

### Task B1: `ChatMessage` ganha `imageUri` + `ChatBubble` renderiza imagem

**Files:**
- Modify: `swi-admin/src/services/mockApi/chats.ts` (type `ChatMessage`)
- Modify: `swi-admin/src/pages/chat/ChatInbox.tsx` (componente `ChatBubble`)
- Test: `swi-admin/src/pages/chat/ChatInbox.test.tsx` (ou o teste existente do bubble)

**Step 1:** Em `mockApi/chats.ts`, adicionar `imageUri?: string` ao type `ChatMessage` (bolha com imagem). Comentar: "anexo resolvido (presigned); quando presente, a bolha mostra a imagem".

**Step 2: Escrever o teste (RED)** — renderizar `ChatBubble` (ou o inbox) com uma mensagem que tem `imageUri` e asserir que um `<img>`/DS `Image` aparece (via `testID` novo `chat-bubble-image`). Ver como o teste atual do inbox monta (usar o mesmo harness).

**Step 3: Implementar (GREEN)** no `ChatBubble`: quando `message.imageUri`, renderizar a imagem (usar o componente de imagem do DS se houver; senão `Image` do react-native-web) com `testID="chat-bubble-image"`, mantendo o texto abaixo se `text` também existir. **Sem hardcode de token** (usar `useTheme`).

**Step 4: Rodar** `npx vitest run src/pages/chat/ChatInbox.test.tsx` → PASS.
**Step 5: Commit** `feat(admin): bolha de chat renderiza anexo de imagem`.

### Task B2: `ChatInbox` consome o `ChatProvider`

**Files:**
- Modify: `swi-admin/src/pages/chat/ChatInbox.tsx` (l.481-522 e o que derivar de `contacts`)
- Test: `swi-admin/src/pages/chat/ChatInbox.test.tsx`

**Step 1: Escrever o teste (RED)** — envolver o `ChatInbox` num `ChatProvider` mockado (mesma técnica da Task A5: mock de `api/chats` retornando 1 conversa + directory) e asserir: (a) a conversa real aparece na lista; (b) digitar + "Enviar" chama `send` do provider; (c) selecionar uma conversa chama `openConversation`. Reusar os mocks de A5.

**Step 2: Implementar (GREEN):**
- Trocar `const [contacts,setContacts]=useState(...)` + o `useEffect` de `chatsApi.list()` (l.491-499) por: `const { conversations, messagesByConv, directory, myId, openConversation, send, loadStatus } = useChat()`.
- Derivar `contacts: ChatContact[]` = `conversations.map((c) => conversationToContact(c, messagesByConv[c.id] ?? [], myId))`. A lista "Novo Chat" usa `directory.map((d) => directoryToContact(d, myId))`.
- `selectedContactId`: default deixa de ser `'chat-romulo'`; se sem param, usar a 1ª conversa (ou nenhuma → estado "selecione/inicie uma conversa"). Ao selecionar, chamar `openConversation(id)` (efeito no `selectedContactId`).
- `handleSend`: `await send(selectedContactId, draft.trim(), pendingImage ?? undefined)` (pendingImage vem da B3); limpar draft; em erro → `showToast`. **Remover o append local** (o socket traz de volta).
- Manter todo o resto da UI (ContactRow/ChatBubble/painel) intacto. O painel direito lê identidade do contato selecionado (nome/setor/cargo/avatar reais); campos de vitais continuam do `DEMO_PROFILE` (mock) — deixar como está.

**Step 3: Rodar** vitest do inbox → PASS. Rodar a suíte inteira do inbox pra pegar regressões.
**Step 4: Commit** `feat(admin): ChatInbox real via ChatProvider (lista/thread/envio + Novo Chat)`.

### Task B3: anexo de imagem no compositor + generalizar o upload

**Files:**
- Modify: `swi-admin/src/services/api/upload.ts` (parametrizar prefix)
- Modify: `swi-admin/src/services/api/upload.test.ts`
- Modify: `swi-admin/src/pages/chat/ChatInbox.tsx` (botão de anexo + estado `pendingImage`)

**Step 1: Generalizar o upload (RED→GREEN).** Refatorar `upload.ts` pra uma função `uploadImage(file, prefix: 'order'|'chat'): Promise<string>` (mesmo corpo, `prefix` no presign), e manter `uploadOrderImage = (f) => uploadImage(f, 'order')` como wrapper (não quebra os callers de WorkOrder). Atualizar/estender `upload.test.ts` pra cobrir `prefix: 'chat'` (asserir o body do presign leva `prefix:'chat'`).

**Step 2: Escrever o teste (RED)** no inbox — clicar no botão de anexo, simular seleção de arquivo (input `type=file`), "Enviar" → `send` é chamado com o File; mockar `uploadImage`. (Testar o fluxo até `send(id, body, file)`.)

**Step 3: Implementar (GREEN)** no compositor do `ChatInbox`: um botão "anexar" (Icon do DS) que aciona um `<input type="file" accept="image/png,image/jpeg" hidden>`; ao escolher, guardar em `pendingImage: File | null` + preview opcional; `handleSend` passa `pendingImage` pro `send` e limpa. Validar tipo/tamanho já é feito dentro de `uploadImage`.

**Step 4: Rodar** vitest (inbox + upload) → PASS.
**Step 5: Commit** `feat(admin): anexo de imagem no chat (upload prefix chat + compositor)`.

### Task B4: `AppLayout` — `ChatSection` vive do provider

**Files:**
- Modify: `swi-admin/src/app/AppLayout.tsx` (remove `CHAT_USERS` l.50-67; ChatSection l.~229 e l.~314)
- Test: `swi-admin/src/app/AppLayout.test.tsx` (se existir; senão criar smoke)

**Step 1: Escrever o teste (RED)** — renderizar `AppLayout` dentro de um `ChatProvider` mockado com 1 conversa com unread, asserir que o `ChatSection` recebe/renderiza esse contato (nome + badge). Se o AppLayout já tem teste, estender.

**Step 2: Implementar (GREEN):**
- Remover o const `CHAT_USERS`.
- `const { conversations, myId } = useChat()`; derivar `users = conversations.map((c) => { const r = resolveContact(c, myId); return { id: c.id, name: r.name, subtitle: r.subtitle, avatarUri: r.avatarUri, unreadCount: unreadFor(c, myId) || undefined } })`.
- Passar `users` pro `ChatSection` (as duas ocorrências: drawer + sidebar). `onUserPress(id)` → `navigate('/chat/' + id)` (id agora é `a#b`; a rota `/chat/:contactId` casa). `onExpand` → `navigate('/chat')`.

**Step 3:** Garantir que o `ChatProvider` **envolve** o `AppLayout` (Task B5).
**Step 4: Rodar** vitest do AppLayout → PASS.
**Step 5: Commit** `feat(admin): ChatSection da sidebar/drawer vive do ChatProvider`.

### Task B5: montar o `ChatProvider` na árvore

**Files:**
- Modify: `swi-admin/src/app/App.tsx` (ou onde `AppLayout` + rotas de chat são montados)

**Step 1:** Envolver a subárvore autenticada (que contém `AppLayout` e as rotas `/chat`, `/chat/:contactId`) com `<ChatProvider>`. Uma instância só (estado compartilhado entre sidebar e inbox). Montar **abaixo** do `AuthProvider` (precisa do `useAuth().user.id`) e só quando logado (evitar socket sem sessão) — se a subárvore autenticada já é condicional a login, basta pôr o provider ali.

**Step 2: Rodar** `cd ../swi-admin && npx tsc -b && npx vitest run && npm run build` → tudo verde.
**Step 3: Commit** `feat(admin): monta ChatProvider acima do AppLayout + rotas de chat`.

---

## Verificação final (ao vivo)

**Pré:** stack de dev no ar (api 3001, vite 5173, db 5433). Reusar o worker do seed pra responder via API (token de `worker@swi.local`/`worker123`).

1. **Playwright:** login admin → abrir `/chat`. Inbox vazio (esperado). "Novo Chat" → escolher um worker do directory → enviar uma mensagem de texto → a bolha aparece (veio pelo socket, não append). 0 erros de console.
2. **Eco ao vivo:** via API (segundo "usuário"), logar como o worker e `POST /chat/conversations/<me#worker>/messages` respondendo → a mensagem aparece **ao vivo** no thread do admin e o badge sobe na sidebar (`ChatSection`).
3. **Anexo:** enviar uma imagem (JPG pequeno) → sobe pro MinIO (9002), a bolha renderiza a imagem.
4. **Mark-read:** abrir o thread com unread → badge zera (via `POST /read`); confirmar no `GET /chat/conversations` que `unreadBy[adminId]===0`.
5. Restaurar: apagar as conversas de teste do admin do db (psql) se quiser deixar limpo (opcional — são dados de demo).

## Ordem de execução / notas

- **Ordem sugerida:** Task 0 → A1 → A2 → A3 → A4 → **B3-step1 (generalizar upload)** → A5 → B1 → B2 → B3(resto) → B4 → B5. (Generalizar o `uploadImage` antes de A5 dá a assinatura real; mas como o teste de A5 mocka `../api/upload`, dá pra seguir A5 antes e só garantir a função em B3.)
- **socket sem sessão:** o provider só deve montar logado; senão o handshake falha e o server desconecta (inofensivo, mas evita ruído). Ver Task B5.
- **`selectedContactId` default:** o `'chat-romulo'` some; tratar "nenhuma conversa" com estado vazio amigável (não crashar em `selectedContact null`).
- **Regra DS:** `ChatSection`, `Avatar`, `Input`, `Icon` etc. usados como estão; bolha de imagem usa o Image do DS se existir. Sem hardcode de token (`useTheme`).
- **NÃO commitar** eas.json, .playwright-mcp, screenshots, docker-compose.ports-alt.yml.
- **Backend intocado** — nenhuma mudança em `swi-backend` nesta fatia.
