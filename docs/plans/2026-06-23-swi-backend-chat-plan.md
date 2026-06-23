# Chat (SWI Backend) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Design: `2026-06-23-swi-backend-chat-design.md`. Roadmap: `2026-06-22-swi-backend-roadmap-design.md`.
> **Commit rule (SWI):** os steps de commit abaixo são estrutura — NÃO commitar sem luz verde explícita do usuário (igual Fatias 1/3/Relatórios/Jornada, aprovação por lote).

**Goal:** Ligar o chat do app worker (inbox com preview + não-lidas, thread com mensagens em **tempo real**, anexo de imagem, "Novo Chat" via diretório) a um backend real `Conversation`+`Message`+`Contact` (Amplify Gen 2 + S3), via Abordagem A (mock+amplify atrás de flag), deploy-gated.

**Architecture:** Três models em `swi-backend` (`Conversation` com estado por-viewer em `unreadByJson` + arrays paralelos de snapshot; `Message` lista por `conversationId`; `Contact` = diretório leve `authenticated().read`). No mobile, `services/chat/` espelha `services/journey/`: um módulo **puro** `chatReducers.ts` centraliza a lógica de lista (bump lastMessage, unread por-viewer, resolver contato, ordenar), reusado pelo mock e pelo provider; `ChatBackend` (interface, com seam **`subscribe()`**) + impl `mock` (event-bus em memória → thread/inbox ao vivo) / `amplify` (stub `onCreate`, deploy-gated) + selector por flag `AUTH_BACKEND`; um `ChatProvider` novo carrega + subscreve. As 2 telas (`inbox`/`[userId]`) trocam arrays inline pelo provider, com loading/empty/error. Só `chatReducers.ts` + `mock` são unit-testados; `amplify` é typechecado (sem conta AWS).

**Tech Stack:** Expo Router / React Native, `@kavicki/swi-design-system`, `aws-amplify` (Data + Storage), `@aws-amplify/backend`, jest-expo.

**Refinamento de interface vs design (registrado):** o design citou `startConversation(contactWorkerId)`. O plano realiza a **criação lazy** de forma mais limpa via **`conversationId` determinístico** (`[myId, contactId].sort().join('#')`): a thread sempre conhece o id sem a conversa existir, e `sendMessage` **cria-ou-anexa** (lazy no 1º envio). Não há `startConversation` separado. Mesma decisão do design ("Conversation só criada no 1º envio"), realização mais simples.

---

## Phase 0 — Branch

### Task 0: Criar a branch stacked

**Step 1:** `git checkout feat/mobile-login` (confirmar tree limpo: `git status`).
**Step 2:** `git checkout -b feat/backend-chat`.
Expected: nova branch a partir de `feat/mobile-login` (tip `95c601c`).

---

## Phase 1 — Backend (`swi-backend`)

### Task 1: Adicionar os models `Conversation` + `Message` + `Contact`

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts` (dentro do `a.schema({ ... })`, após `Task`)

**Step 1:** Adicionar ao schema:

```ts
  Conversation: a
    .model({
      participants: a.string().array().required(),   // [meSub, themSub] (Cognito subs)
      participantNames: a.string().array(),          // snapshot denorm paralelo (sem join)
      participantSubtitles: a.string().array(),      // "Setor Leste"
      participantAvatarKeys: a.string().array(),     // avatar keys (uris no mock)
      lastMessageBody: a.string(),                   // preview do inbox (compartilhado)
      lastMessageAt: a.datetime(),                   // ordenação do inbox
      unreadByJson: a.json(),                         // { [sub]: count } — unread POR-viewer
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participants'),
      allow.group('admin'),
    ]),

  Message: a
    .model({
      conversationId: a.string().required(),         // FK lógico (lista por conversationId; sem hasMany)
      participants: a.string().array().required(),   // denormaliza p/ ownersDefinedIn
      senderId: a.string().required(),               // autor (define me/them na bubble)
      body: a.string(),                              // texto (pode ser vazio se só imagem)
      imageKey: a.string(),                          // anexo S3 opcional (uri no mock)
      sentAt: a.datetime().required(),               // ordenação + "time" da bubble
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participants'),
      allow.group('admin'),
    ]),

  Contact: a
    .model({
      workerId: a.string().required(),               // Cognito sub
      name: a.string().required(),
      sector: a.string(),                            // → subtitle do card
      role: a.string(),                              // "Operador de escavadeira" (header user-info)
      avatarKey: a.string(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),            // roster público não-sensível
      allow.group('admin'),
    ]),
```

**Step 2:** Verificar tipos do backend.
Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0 (sem erros). Se `ownersDefinedIn` (plural) divergir da versão instalada de `@aws-amplify/backend`, conferir os tipos instalados antes de ajustar — **não inventar API** (precedente: `ownerDefinedIn` singular já usado em `HealthData`/`Journey`/`Task`).

### Task 2: Storage S3 — prefixo `chat/`

**Files:**
- Modify: `swi-backend/amplify/storage/resource.ts`

**Step 1:** Adicionar o prefixo `chat/{entity_id}/*` (um bucket `swiMedia`, agora três prefixos). `backend.ts` já importa o export `storage` — **não precisa mudar**.

```ts
import { defineStorage } from '@aws-amplify/backend';

// Anexos de relatórios + fotos de tarefas + imagens de chat. Worker autenticado
// lê; o dono escreve no próprio prefixo. Um bucket, prefixo por domínio.
export const storage = defineStorage({
  name: 'swiMedia',
  access: (allow) => ({
    'reports/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    'journey/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    'chat/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
```

**Step 2:** Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0.

**Step 3 (commit — aguardar OK):** `git add swi-backend/amplify/data/resource.ts swi-backend/amplify/storage/resource.ts`.

---

## Phase 2 — Service layer mobile (TDD)

Novo diretório: `mobile/services/chat/`. Espelha `mobile/services/journey/`.

### Task 3: `types.ts`

**Files:** Create `mobile/services/chat/types.ts`

> Espelho local dos models `Conversation`/`Message`/`Contact` (siblings isolados; NÃO importar o Schema — após deploy, `ampx generate` pode substituir). `sentAt`/`lastMessageAt` são ISO strings. `unreadByJson` (json) vira `unreadBy: Record<string, number>`; `imageKey`/`avatarKey`/`participantAvatarKeys` viram uris resolvidas (`imageUri`/`avatarUri`/`participantAvatars`), espelhando `images` da Jornada. `myId` no backend = o sub do worker logado (mock = `'me'`).

```ts
export interface Conversation {
  id: string;
  participants: string[];           // [myId, contactId] (Cognito subs)
  participantNames: string[];       // paralelo a participants
  participantSubtitles: string[];   // "Setor Leste"
  participantAvatars: string[];     // uris (resolvidas de keys no amplify)
  lastMessageBody: string;
  lastMessageAt: string | null;     // ISO datetime
  unreadBy: Record<string, number>; // sub -> count (de unreadByJson)
}

export interface Message {
  id: string;
  conversationId: string;
  participants: string[];
  senderId: string;                 // === myId ⇒ bubble "me"
  body: string;
  imageUri: string | null;          // anexo resolvido (de imageKey no amplify)
  sentAt: string;                   // ISO datetime
}

export interface Contact {
  workerId: string;
  name: string;
  sector: string;                   // → subtitle do card
  role: string;                     // header do user-info
  avatarUri: string;                // uri resolvida
}

export interface ChatBackend {
  readonly myId: string;            // sub do worker logado (mock = 'me')
  listConversations(): Promise<Conversation[]>;
  listMessages(conversationId: string): Promise<Message[]>;
  listDirectory(): Promise<Contact[]>;
  // cria-ou-anexa: se a conversa (id determinístico) não existe, cria do diretório
  sendMessage(conversationId: string, body: string, imageUri?: string): Promise<Message>;
  markRead(conversationId: string): Promise<void>;
  // conversationId === null ⇒ canal global (inbox); senão a thread daquela conversa
  subscribe(conversationId: string | null, cb: (msg: Message) => void): () => void;
}
```

### Task 4: `chatReducers.ts` (módulo PURO) + teste — TDD

> O coração da fatia (análogo ao `progress.ts` da Jornada): lógica de lista determinística e pura. `conversationKey` dá o id determinístico (lazy create). Sem `Date.now()` — `sentAt` chega pronto na `Message`. Ordenação por ISO string (lexicográfica = cronológica).

**Files:**
- Create: `mobile/services/chat/chatReducers.ts`
- Test: `mobile/services/chat/chatReducers.test.ts`

**Step 1 — Escrever o teste que falha:**

```ts
import {
  conversationKey, unreadFor, resolveContact, sortByRecent, applyMessage, markRead,
} from './chatReducers';
import type { Conversation, Message } from './types';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'me#1',
  participants: ['me', '1'],
  participantNames: ['Você', 'Romulo Cardoso'],
  participantSubtitles: ['', 'Setor Leste'],
  participantAvatars: ['me.png', 'romulo.png'],
  lastMessageBody: 'oi',
  lastMessageAt: '2026-06-23T10:00:00.000Z',
  unreadBy: { me: 2 },
  ...over,
});

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', conversationId: 'me#1', participants: ['me', '1'],
  senderId: '1', body: 'nova', imageUri: null, sentAt: '2026-06-23T11:00:00.000Z',
  ...over,
});

describe('chatReducers — conversationKey', () => {
  it('é determinístico e independe da ordem', () => {
    expect(conversationKey('me', '1')).toBe('1#me');
    expect(conversationKey('1', 'me')).toBe('1#me');
  });
});

describe('chatReducers — unreadFor / resolveContact', () => {
  it('unreadFor lê o contador do viewer (0 default)', () => {
    expect(unreadFor(conv(), 'me')).toBe(2);
    expect(unreadFor(conv({ unreadBy: {} }), 'me')).toBe(0);
  });
  it('resolveContact pega o participante que não sou eu', () => {
    const r = resolveContact(conv(), 'me');
    expect(r.workerId).toBe('1');
    expect(r.name).toBe('Romulo Cardoso');
    expect(r.subtitle).toBe('Setor Leste');
  });
});

describe('chatReducers — applyMessage', () => {
  it('bump lastMessage, incrementa unread só de quem não enviou, re-ordena', () => {
    const a = conv({ id: 'me#1', lastMessageAt: '2026-06-23T09:00:00.000Z', unreadBy: { me: 0 } });
    const b = conv({ id: 'me#2', participants: ['me', '2'], lastMessageAt: '2026-06-23T10:00:00.000Z' });
    const out = applyMessage([a, b], msg({ conversationId: 'me#1', senderId: '1', body: 'oi', sentAt: '2026-06-23T11:00:00.000Z' }));
    expect(out[0].id).toBe('me#1');                 // re-ordenado pro topo
    expect(out[0].lastMessageBody).toBe('oi');
    expect(out[0].unreadBy.me).toBe(1);             // eu (não-sender) +1
    expect(out[0].unreadBy['1']).toBeUndefined();   // sender não ganha unread
  });
  it('mensagem só-imagem usa placeholder no preview', () => {
    const out = applyMessage([conv()], msg({ body: '', imageUri: 'x.png' }));
    expect(out[0].lastMessageBody).toContain('Imagem');
  });
  it('sender não incrementa o próprio unread', () => {
    const out = applyMessage([conv({ unreadBy: { me: 0 } })], msg({ senderId: 'me' }));
    expect(out[0].unreadBy.me).toBe(0);
  });
});

describe('chatReducers — markRead / sortByRecent', () => {
  it('markRead zera só o viewer', () => {
    const out = markRead([conv({ unreadBy: { me: 5, '1': 3 } })], 'me#1', 'me');
    expect(out[0].unreadBy.me).toBe(0);
    expect(out[0].unreadBy['1']).toBe(3);
  });
  it('sortByRecent ordena desc por lastMessageAt (null por último)', () => {
    const a = conv({ id: 'a', lastMessageAt: '2026-06-23T09:00:00.000Z' });
    const b = conv({ id: 'b', lastMessageAt: '2026-06-23T12:00:00.000Z' });
    const c = conv({ id: 'c', lastMessageAt: null });
    expect(sortByRecent([a, b, c]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});
```

**Step 2:** Run `cd mobile && npx jest services/chat/chatReducers.test.ts` → FAIL (módulo não existe).

**Step 3 — Implementar:**

```ts
// Lógica PURA da lista de conversas, compartilhada pelo mock backend e pelo
// ChatProvider. Sem efeitos/relógio: `sentAt` chega pronto na Message; ordenação
// por ISO string (lexicográfica = cronológica). Espelha o estilo puro de
// services/journey/progress.ts.
import type { Conversation, Message } from './types';

// Id determinístico de conversa 1:1 — a thread conhece o id sem a conversa
// existir ainda (criação lazy no 1º envio).
export function conversationKey(a: string, b: string): string {
  return [a, b].sort().join('#');
}

export function unreadFor(c: Conversation, myId: string): number {
  return c.unreadBy[myId] ?? 0;
}

export interface ResolvedContact {
  workerId: string;
  name: string;
  subtitle: string;
  avatarUri: string;
}

export function resolveContact(c: Conversation, myId: string): ResolvedContact {
  const found = c.participants.findIndex((p) => p !== myId);
  const i = found === -1 ? 0 : found;
  return {
    workerId: c.participants[i] ?? '',
    name: c.participantNames[i] ?? '',
    subtitle: c.participantSubtitles[i] ?? '',
    avatarUri: c.participantAvatars[i] ?? '',
  };
}

export function sortByRecent(cs: Conversation[]): Conversation[] {
  return [...cs].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

// Aplica uma mensagem à lista: bump lastMessage, incrementa unread de todo
// participante exceto o autor, re-ordena por recência. Pura (não muta a entrada).
export function applyMessage(cs: Conversation[], msg: Message): Conversation[] {
  const next = cs.map((c) => {
    if (c.id !== msg.conversationId) return c;
    const unreadBy = { ...c.unreadBy };
    for (const p of c.participants) {
      if (p !== msg.senderId) unreadBy[p] = (unreadBy[p] ?? 0) + 1;
    }
    return {
      ...c,
      lastMessageBody: msg.body || (msg.imageUri ? '📷 Imagem' : ''),
      lastMessageAt: msg.sentAt,
      unreadBy,
    };
  });
  return sortByRecent(next);
}

export function markRead(cs: Conversation[], conversationId: string, myId: string): Conversation[] {
  return cs.map((c) =>
    c.id === conversationId ? { ...c, unreadBy: { ...c.unreadBy, [myId]: 0 } } : c,
  );
}
```

**Step 4:** Run `cd mobile && npx jest services/chat/chatReducers.test.ts` → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/chat/{types.ts,chatReducers.ts,chatReducers.test.ts}`.

### Task 5: `mockChatBackend.ts` (impl, event-bus) + teste

**Files:**
- Create: `mobile/services/chat/mockChatBackend.ts`
- Test: `mobile/services/chat/mockChatBackend.test.ts`

> Store mutável module-level (conversations + messages + directory), servido com `tick()` async (igual mock da Jornada). Semeia: diretório de 15 contatos (migrado do array `USERS` do inbox) + ~8 conversas (`me`↔contatos 1..8) com histórico (a conversa do contato `1`/Romulo recebe o histórico de `MESSAGES` de `[userId].tsx`); `unreadBy.me` semeado pra bater com os badges do inbox (Romulo=10, etc.). **Event-bus** em memória: `subscribe(convId|null)`; `sendMessage` faz append + `applyMessage` na lista + **emite**. `sendMessage` **cria-ou-anexa** (lazy) derivando participantes do `conversationId`. `myId = 'me'`. `Date.now()`/`new Date().toISOString()` pro `sentAt` em runtime.

**Step 1 — Escrever o teste que falha:**

```ts
import { mockChatBackend } from './mockChatBackend';
import { conversationKey } from './chatReducers';

describe('mockChatBackend', () => {
  it('myId é "me"', () => {
    expect(mockChatBackend.myId).toBe('me');
  });
  it('listDirectory retorna o roster semeado', async () => {
    const dir = await mockChatBackend.listDirectory();
    expect(dir.length).toBeGreaterThanOrEqual(8);
    expect(dir[0]).toHaveProperty('name');
    expect(dir[0]).toHaveProperty('workerId');
  });
  it('listConversations vem ordenado por recência (desc)', async () => {
    const cs = await mockChatBackend.listConversations();
    expect(cs.length).toBeGreaterThan(0);
    for (let i = 1; i < cs.length; i++) {
      expect((cs[i - 1].lastMessageAt ?? '') >= (cs[i].lastMessageAt ?? '')).toBe(true);
    }
  });
  it('listMessages retorna o histórico de uma conversa conhecida', async () => {
    const [first] = await mockChatBackend.listConversations();
    const msgs = await mockChatBackend.listMessages(first.id);
    expect(Array.isArray(msgs)).toBe(true);
  });
  it('sendMessage anexa, emite ao subscriber e dá bump na conversa', async () => {
    const [first] = await mockChatBackend.listConversations();
    const received: string[] = [];
    const unsub = mockChatBackend.subscribe(first.id, (m) => received.push(m.body));
    const sent = await mockChatBackend.sendMessage(first.id, 'olá real-time');
    expect(sent.senderId).toBe('me');
    expect(received).toContain('olá real-time');
    const msgs = await mockChatBackend.listMessages(first.id);
    expect(msgs[msgs.length - 1].body).toBe('olá real-time');
    const cs = await mockChatBackend.listConversations();
    expect(cs.find((c) => c.id === first.id)?.lastMessageBody).toBe('olá real-time');
    unsub();
  });
  it('subscriber global (null) recebe mensagem de qualquer conversa', async () => {
    const [first] = await mockChatBackend.listConversations();
    const seen: string[] = [];
    const unsub = mockChatBackend.subscribe(null, (m) => seen.push(m.conversationId));
    await mockChatBackend.sendMessage(first.id, 'ping');
    expect(seen).toContain(first.id);
    unsub();
  });
  it('unsubscribe para de receber', async () => {
    const [first] = await mockChatBackend.listConversations();
    const seen: string[] = [];
    const unsub = mockChatBackend.subscribe(first.id, (m) => seen.push(m.body));
    unsub();
    await mockChatBackend.sendMessage(first.id, 'não deveria chegar');
    expect(seen).not.toContain('não deveria chegar');
  });
  it('markRead zera o unread do viewer', async () => {
    const cs = await mockChatBackend.listConversations();
    const withUnread = cs.find((c) => (c.unreadBy.me ?? 0) > 0);
    if (withUnread) {
      await mockChatBackend.markRead(withUnread.id);
      const after = (await mockChatBackend.listConversations()).find((c) => c.id === withUnread.id);
      expect(after?.unreadBy.me ?? 0).toBe(0);
    }
  });
  it('sendMessage cria a conversa lazy se não existir (id determinístico do diretório)', async () => {
    const dir = await mockChatBackend.listDirectory();
    const existing = await mockChatBackend.listConversations();
    const fresh = dir.find((c) => !existing.some((x) => x.participants.includes(c.workerId))) ?? dir[dir.length - 1];
    const key = conversationKey('me', fresh.workerId);
    await mockChatBackend.sendMessage(key, 'primeira mensagem');
    const conv = (await mockChatBackend.listConversations()).find((c) => c.id === key);
    expect(conv).toBeDefined();
    expect(conv?.participants).toEqual(expect.arrayContaining(['me', fresh.workerId]));
  });
});
```

**Step 2:** Run `cd mobile && npx jest services/chat/mockChatBackend.test.ts` → FAIL (módulo não existe).

**Step 3 — Implementar.** Estrutura (mirror do mock da Jornada + bus):
- Avatares via `Asset.fromModule(require('../../assets/avatars/worker-N.png')).uri` (igual inbox).
- `DIRECTORY: Contact[]` semeado dos 15 `USERS` (workerId = id `'1'..'15'`, name/sector/role/avatarUri). `ME_NAME='Você'`.
- `let conversations: Conversation[]` + `let messages: Message[]` semeados: pra contatos `1..8`, `id = conversationKey('me', contactId)`, `participants=['me', id]`, arrays paralelos (me + contato), `unreadBy` (ex.: `{ me: 10 }` Romulo), histórico (`1` recebe o `MESSAGES` migrado; demais 1-3 msgs com `sentAt` escalonados).
- **Event-bus:**
  ```ts
  type Listener = (m: Message) => void;
  const listeners = new Map<string, Set<Listener>>();   // key = convId | '*'
  function emit(m: Message) {
    listeners.get(m.conversationId)?.forEach((cb) => cb(m));
    listeners.get('*')?.forEach((cb) => cb(m));
  }
  ```
- `subscribe(convId, cb)`: `const key = convId ?? '*';` adiciona ao set, retorna unsubscribe (`set.delete(cb)`).
- `tick = () => new Promise<void>((r) => setTimeout(r, 0));`
- `myId: 'me'` (property).
- `listConversations`: `await tick(); return sortByRecent(conversations).map(clone);`
- `listMessages(convId)`: `await tick(); return messages.filter((m) => m.conversationId === convId).map(clone);`
- `listDirectory`: `await tick(); return DIRECTORY.map(clone);`
- `sendMessage(convId, body, imageUri?)`:
  ```ts
  await tick();
  let conv = conversations.find((c) => c.id === convId);
  if (!conv) conv = createLazy(convId);          // deriva participantes de convId.split('#') + DIRECTORY
  const m: Message = {
    id: `msg-${nextId++}`, conversationId: convId, participants: conv.participants,
    senderId: 'me', body, imageUri: imageUri ?? null, sentAt: new Date().toISOString(),
  };
  messages.push(m);
  conversations = applyMessage(conversations, m);  // bump + unread + re-sort (reducer puro)
  emit(m);
  return { ...m };
  ```
  `createLazy(convId)`: `const others = convId.split('#').filter((p) => p !== 'me'); const contact = DIRECTORY.find((d) => d.workerId === others[0]);` → monta `Conversation` (participants `['me', contact.workerId]`, arrays paralelos, `unreadBy: {}`, `lastMessage*` vazios), faz `conversations.push(conv)`, retorna.
- `markRead(convId)`: `await tick(); conversations = markReadReducer(conversations, convId, 'me');`

**Step 4:** Run o teste → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/chat/{mockChatBackend.ts,mockChatBackend.test.ts}`.

### Task 6: `amplifyChatBackend.ts` (typecheck-only, deploy-gated)

**Files:** Create `mobile/services/chat/amplifyChatBackend.ts`

> Espelha `amplifyJourneyBackend.ts`: client não-tipado, métodos lançam até o deploy. `subscribe` mapeia (comentado) pra `client.models.Message.onCreate({ filter })`; no stub retorna um no-op unsubscribe + lança nas chamadas de dados. Typecheca e o selector importa; o caminho mock nunca o chama.

```ts
import { generateClient } from 'aws-amplify/data';
import type { ChatBackend, Conversation, Message, Contact } from './types';

const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyChatBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyChatBackend: ChatBackend = {
  myId: '', // virá do auth session (Cognito sub) no deploy
  async listConversations(): Promise<Conversation[]> { void client; throw NOT_READY('listConversations'); },
  async listMessages(conversationId: string): Promise<Message[]> { void conversationId; throw NOT_READY('listMessages'); },
  async listDirectory(): Promise<Contact[]> { throw NOT_READY('listDirectory'); },
  async sendMessage(conversationId: string, body: string, imageUri?: string): Promise<Message> {
    void conversationId; void body; void imageUri; throw NOT_READY('sendMessage');
  },
  async markRead(conversationId: string): Promise<void> { void conversationId; throw NOT_READY('markRead'); },
  subscribe(conversationId: string | null, cb: (msg: Message) => void): () => void {
    // Deploy: client.models.Message.onCreate({ filter: { conversationId: { eq } } }).subscribe({ next: cb })
    void conversationId; void cb;
    return () => {};
  },
};
```

**Step 2:** Run `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 7: `getChatBackend.ts` (selector) + teste

**Files:**
- Create: `mobile/services/chat/getChatBackend.ts`
- Test: `mobile/services/chat/getChatBackend.test.ts`

**Step 1 — Teste** (espelha `getJourneyBackend.test.ts`):

```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getChatBackend } from './getChatBackend';
import { mockChatBackend } from './mockChatBackend';

describe('getChatBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getChatBackend()).toBe(mockChatBackend);
  });
});
```

**Step 2:** Run → FAIL.

**Step 3 — Implementar** (igual `getJourneyBackend.ts`):

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';
import { amplifyChatBackend } from './amplifyChatBackend';

export function getChatBackend(): ChatBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyChatBackend : mockChatBackend;
}
```

**Step 4:** Run → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/chat/{amplifyChatBackend.ts,getChatBackend.ts,getChatBackend.test.ts}`.

### Task 8: `ChatProvider.tsx` (carrega + subscreve)

**Files:** Create `mobile/services/chat/ChatProvider.tsx`

> Carrega `conversations` + `directory` no mount (máquina `loadStatus`); subscreve o canal **global** uma vez e mantém `messagesByConv`; expõe a API consumida pelas telas. A thread chama `openConversation(convId)` (carrega histórico + `markRead`). `send` delega ao backend — o **bus** (mock) / `onCreate` (amplify) reflete de volta via a subscription global (fonte única, sem echo duplo). `messagesFor(convId)` é reativo.

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { Conversation, Contact, Message } from './types';
import { getChatBackend } from './getChatBackend';
import { applyMessage, markRead as markReadReducer, conversationKey } from './chatReducers';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface ChatContextValue {
  myId: string;
  loadStatus: LoadStatus;
  conversations: Conversation[];
  directory: Contact[];
  load: () => Promise<void>;
  messagesFor: (conversationId: string) => Message[];
  openConversation: (conversationId: string) => Promise<void>;
  send: (conversationId: string, body: string, imageUri?: string) => Promise<void>;
  keyFor: (contactWorkerId: string) => string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getChatBackend(), []);
  const myId = backend.myId;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [directory, setDirectory] = useState<Contact[]>([]);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const openConvRef = useRef<string | null>(null); // conversa aberta (p/ auto-markRead live)

  const load = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const [cs, dir] = await Promise.all([backend.listConversations(), backend.listDirectory()]);
      setConversations(cs);
      setDirectory(dir);
      setLoadStatus(cs.length ? 'ready' : 'empty');
    } catch { setLoadStatus('error'); }
  }, [backend]);

  useEffect(() => { load(); }, [load]);

  // Subscription GLOBAL única: toda mensagem nova atualiza a lista (reducer puro)
  // e, se a conversa já está carregada, faz append ao histórico.
  useEffect(() => {
    const unsub = backend.subscribe(null, (msg) => {
      setConversations((prev) => applyMessage(prev, msg));
      setMessagesByConv((prev) =>
        prev[msg.conversationId]
          ? { ...prev, [msg.conversationId]: [...prev[msg.conversationId], msg] }
          : prev,
      );
      // se a conversa está aberta, marca lida na hora (não acumula badge)
      if (openConvRef.current === msg.conversationId && msg.senderId !== myId) {
        backend.markRead(msg.conversationId).catch(() => {});
        setConversations((prev) => markReadReducer(prev, msg.conversationId, myId));
      }
    });
    return unsub;
  }, [backend, myId]);

  const openConversation = useCallback(async (conversationId: string) => {
    openConvRef.current = conversationId;
    const msgs = await backend.listMessages(conversationId);
    setMessagesByConv((prev) => ({ ...prev, [conversationId]: msgs }));
    await backend.markRead(conversationId);
    setConversations((prev) => markReadReducer(prev, conversationId, myId));
  }, [backend, myId]);

  const send = useCallback(async (conversationId: string, body: string, imageUri?: string) => {
    await backend.sendMessage(conversationId, body, imageUri); // bus reflete via subscription
  }, [backend]);

  const messagesFor = useCallback(
    (conversationId: string) => messagesByConv[conversationId] ?? [],
    [messagesByConv],
  );
  const keyFor = useCallback((contactWorkerId: string) => conversationKey(myId, contactWorkerId), [myId]);

  const value = useMemo<ChatContextValue>(() => ({
    myId, loadStatus, conversations, directory,
    load, messagesFor, openConversation, send, keyFor,
  }), [myId, loadStatus, conversations, directory, load, messagesFor, openConversation, send, keyFor]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
```

**Step 2:** Run `cd mobile && npx tsc --noEmit` → sem erros novos (telas ainda não usam; Phase 3). `npx jest` dos services segue verde.

**Step 3 (commit — aguardar OK):** `git add mobile/services/chat/ChatProvider.tsx`.

---

## Phase 3 — Wiring das telas

### Task 9: Montar o `ChatProvider`

**Files:** Modify `mobile/app/(app)/chat/_layout.tsx`

> Envolve o `Stack` do chat com `<ChatProvider>` (auth- e chat-scoped — subscriptions desmontam ao sair do Chat). Mantém `screenOptions` atuais.

```tsx
import { Stack } from 'expo-router';
import { ChatProvider } from '../../../services/chat/ChatProvider';

export default function ChatLayout() {
  return (
    <ChatProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </ChatProvider>
  );
}
```

**Step:** `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 10: Estados loading/empty/error (compostos com DS)

**Files:** Create `mobile/components/chat/ChatState.tsx`

> Espelha `components/journey/JourneyState.tsx` (um `CenteredState` interno + wrappers). Compõe DS (`Title`/`Text`/`Button`) + `ActivityIndicator`. Tokens via `useTheme()`. **Sem inventar primitivo** (regra DS). Exporta `ChatInboxState` (lista) e `ChatThreadState` (thread). Copy: inbox → "Nenhuma conversa" / "Carregando conversas…"; thread → "Nenhuma mensagem ainda" / "Carregando mensagens…" / erro + retry. (Copiar o arquivo da Jornada e trocar a copy/nomes.)

**Step:** `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 11: `chat/inbox.tsx`

**Files:** Modify `mobile/app/(app)/chat/inbox.tsx`

- Remover o array `USERS` inline e os `avatarSrc`/`avatarUri` (a semente vive no `mockChatBackend`/diretório). Manter toda a geometria de scrollbar/topbar/layout (não-funcional, intocada).
- `const { loadStatus, conversations, directory, myId, load } = useChat();`
- Render por `loadStatus`: `loading`→`ChatInboxState kind="loading"`; `empty`→`kind="empty"`; `error`→`kind="error" onRetry={load}`; senão a lista.
- **Modo lista (default):** mapear `conversations` → `ChatUserCard` derivando via `resolveContact(c, myId)` (name/subtitle/avatarUri) + `unreadFor(c, myId)` (unreadCount). `onPress` → `router.push(\`/(app)/chat/${resolveContact(c, myId).workerId}\`)`.
- **"Novo Chat" → modo diretório:** um `useState<'inbox'|'directory'>('inbox')`. No modo `directory`, o `SearchInput` filtra `directory` (por `name`) e a lista renderiza os `Contact` como `ChatUserCard` (sem unread); `onPress` → navega pra thread daquele `workerId` (a conversa materializa no 1º envio — lazy). O botão de baixo vira "Voltar à conversas" (ou o back do topo) no modo diretório. Manter o `SearchInput` já existente (só muda a fonte filtrada).
- `filtered`/`useMemo` agora dependem do modo + fonte (`conversations` resolvidas vs `directory`).

**Step:** `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 12: `chat/[userId].tsx`

**Files:** Modify `mobile/app/(app)/chat/[userId].tsx`

- Remover o array `MESSAGES` inline e os avatares hardcoded (`MY_AVATAR`/`THEIR_AVATAR` passam a vir do contato resolvido).
- `const { userId } = useLocalSearchParams<{ userId: string }>();` é o **contactWorkerId**.
- `const { myId, keyFor, messagesFor, openConversation, send, conversations } = useChat();`
- `const convId = keyFor(userId);` (determinístico). `useEffect(() => { openConversation(convId); }, [convId, openConversation]);`
- Estado de carregamento local mínimo: a thread mostra `ChatThreadState kind="loading"` até `messagesFor(convId)` existir (1ª carga); `empty` quando carregou e está vazia ("Nenhuma mensagem ainda" — conversa nova lazy); a lista normal senão. (Erro de rede: try/catch no `openConversation` poderia setar um flag; manter simples — opcional.)
- Header: contato resolvido de `conversations.find(c => c.id === convId)` (via `resolveContact`) **ou** do `directory` quando a conversa ainda não existe (chat novo) — avatar/nome do contato. Avatar "deles" = `resolveContact().avatarUri`; "meu" = avatar do `myId` (pode usar um avatar fixo de `me`).
- `MESSAGES.map(...)` → `messagesFor(convId).map(...)`; `isMe = msg.senderId === myId` (em vez de `from === 'me'`); `time` = formata `msg.sentAt` (HH:mm) — usar um helper local `fmtTime(iso)`; `avatarUri` por lado.
- **Enviar:** o `TextInput` ganha `value`/`onChangeText` (estado local `text`); o botão `send` chama `send(convId, text)` + limpa. Mensagem entra ao vivo pela subscription (sem append manual).
- **Anexo S3:** o `pendingAttachment` existente passa a ser enviado: ao tocar "enviar" com anexo, `send(convId, text, pendingAttachment)` e limpa o preview. (Mock = uri local; amplify = upload S3 → key.)
- `markRead` já acontece no `openConversation`.

**Step:** `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 13 (opcional): header de `chat/user-info.tsx` do diretório

**Files:** Modify `mobile/app/(app)/chat/user-info.tsx`

> **Fora do escopo de dados-de-chat** (perfil/saúde/mapa = mock-até-smartband). Único toque, se houver tempo: nome/role/avatar do header lendo do `Contact` (via `useChat().directory` + o `userId` em rota). Fadiga/mini-map/dados clínicos **ficam mock**. Se a rota de `user-info` não carregar o `userId` do contato hoje, **pular esta task** (mantém mock) e registrar como pendência — não forçar.

---

## Phase 4 — Verificação (deploy-gated)

### Task 14: Suite verde
- `cd mobile && npx jest` → novos testes (`chatReducers`, `mockChatBackend`, `getChatBackend`) verdes, resto inalterado.
- `cd mobile && npx tsc --noEmit` → sem erros novos (8 baseline pré-existentes ok).
- `cd mobile && npx expo export --platform web` → exit 0 (todas as rotas bundlam).
- `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.

### Task 15: Review (igual Fatias 1/3/Relatórios/Jornada)
- Two-gate review (spec compliance + code quality) via subagents; corrigir achados.
- Review holística final da fatia. **Pontos de atenção pro reviewer:**
  - **Subscription cleanup:** o `useEffect` da subscription global retorna o `unsub`; o bus não pode vazar listener ao desmontar o Chat (testar entrar/sair várias vezes).
  - **Echo duplo:** `send` NÃO faz `setState` — confiar que o bus reflete; garantir que a própria mensagem aparece exatamente uma vez na thread.
  - **Unread por-viewer:** `applyMessage` não incrementa o unread do autor; `markRead`/auto-markRead (conversa aberta) zera só o viewer.
  - **Lazy create:** mandar a 1ª mensagem a um contato sem conversa cria a `Conversation` (id determinístico) e ela aparece no inbox.
  - **Ordenação:** ISO string compara cronologicamente; conversa que recebe msg sobe pro topo.

### Task 16: Docs + memória
- Atualizar `project_swi_aws_backend.md` (memória): fatia Chat implementada (mock-path), pendências de deploy.
- Marcar no roadmap doc a fatia 3 (Chat) como implementada.
- Anotar no design doc (`...-chat-design.md`) eventuais "Ajustes na implementação" (igual a Jornada fez).

---

## Pendências de deploy (quando existir conta AWS)
- Preencher `amplifyChatBackend`: `myId` do auth session (Cognito sub); list/get/create reais; `subscribe` → `client.models.Message.onCreate({ filter: { conversationId: { eq } } })`; upload S3 (`uploadData`) + `getUrl` pro `imageKey`; parse/serialize do `unreadByJson`.
- `ampx generate graphql-client-code` → substituir o mirror `types.ts` pelo Schema gerado.
- Confirmar `access`/`entity('identity')` do Storage (prefixo `chat/`) e `ownersDefinedIn('participants')` (plural) contra a versão instalada de `@aws-amplify/backend`.
- **Diretório real:** popular `Contact` (sync de Profile/Cognito ou seed admin) — sem isso o amplify path lista diretório vazio. Hardening.
- **Unread server-authoritative:** no mock o `unreadBy` é client-side via reducer; no deploy, decidir se o incremento é via subscription no cliente ou via mutation/resolver no servidor (evita divergência multi-device). Provável refino: model-join `ConversationParticipant`.

## Riscos / decisões herdadas
- **Caveat de auth** (`ownersDefinedIn('participants')` deixa um participante editar/apagar msg do outro — sem regra field-level por `senderId`) — hardening (fatia 7).
- **Estado por-viewer em `unreadByJson` + arrays paralelos** (3 models, sem join) — se a escala/multi-device pedir, migrar pra `ConversationParticipant` no hardening.
- **`myId` mock = `'me'`** — o real vem do Cognito sub no deploy; as telas não hardcodam `'me'`, usam `useChat().myId`.
- **Sem read-receipts por-mensagem / presença / grupo / push** — fora do escopo (ver Não-objetivos do design).
