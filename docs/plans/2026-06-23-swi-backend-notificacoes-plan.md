# Notificações Slice — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.
>
> **Commit rule (SWI):** per-unit commits land on the isolated branch `feat/backend-notifications`; the FF-merge to `feat/mobile-login` happens **only with explicit user OK**. Confirm the user authorizes the per-unit commits before executing.

**Goal:** Replace the static 12-item notifications array with a real `Notification` backend (mock/amplify behind the `AUTH_BACKEND` flag), with per-recipient read/unread, a live in-app feed via an event-bus seam, and a deploy-gated SNS push seam — keeping everything jest+tsc green without deploying.

**Architecture:** Mirrors the Chat slice exactly. Backend model in `swi-backend/amplify/data/resource.ts`; a `mobile/services/notifications/` layer (`types` + pure `notificationReducers` + `mockNotificationBackend` event-bus + deploy-gated `amplifyNotificationBackend` stub + `getNotificationBackend` flag selector + `NotificationProvider`); wiring in `notifications.tsx` + a DS-composed `NotificationState`. Design doc: `docs/plans/2026-06-23-swi-backend-notificacoes-design.md`.

**Tech Stack:** Expo Router + React Native, `@kavicki/swi-design-system` (DS, tokens via `useTheme()`), AWS Amplify Gen 2 (`@aws-amplify/backend`, deploy-gated), Jest, TypeScript.

---

## Pre-flight

**Step 0.1 — Branch from the clean merge tip.**

Run (from repo root, already on `feat/mobile-login` @ `0f4a2f4`, tree clean):
```bash
git switch -c feat/backend-notifications
```
Expected: `Switched to a new branch 'feat/backend-notifications'`.

Reference commands used throughout:
- mobile: `cd mobile && npx jest <pattern>`, `npx tsc --noEmit`, `npx expo export --platform web`
- backend: `cd swi-backend && npx tsc --noEmit -p amplify` (tsconfig lives under `amplify/`, NOT root)
- mobile `tsc` baseline = **8 pre-existing errors** (three.js, maplibre, unused `@ts-expect-error`, my-stats tuple). Target = **0 new**.

---

## Unit 1 — Backend model

### Task 1: Add the `Notification` model

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts` (add a model inside `a.schema({ ... })`, after `Contact`)

**Step 1: Add the model.** Insert after the `Contact` model (line ~180), before the schema's closing `})`:

```ts
  Notification: a
    .model({
      workerId: a.string().required(),               // Cognito sub do destinatário
      title: a.string().required(),
      body: a.string(),
      domain: a.enum(['weather', 'chat', 'reports', 'journey', 'faq']), // → rota no cliente
      targetId: a.string(),                          // id de recurso específico (deep-link futuro)
      read: a.boolean(),                             // por-destinatário (1 destinatário → boolean)
      // ordenação por recência usa o timestamp de sistema `createdAt` do Amplify;
      // o mirror do mobile carrega um createdAt ISO próprio (sem campo redundante).
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['read', 'update']), // worker lê + marca lida
      allow.group('admin'),                                    // backend/admin cria
    ]),
```

**Step 2: Typecheck the backend.**

Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0 (no output).

**Step 3: Commit.**
```bash
git add swi-backend/amplify/data/resource.ts
git commit -m "feat(notifications): add Notification model (participant-scoped, SNS-ready)"
```

> **Two-gate review (Unit 1):** spec reviewer (model matches design: fields, enum, `ownerDefinedIn('workerId')` read+update, admin create) + code-quality reviewer. Fix findings, re-run `tsc -p amplify`, then proceed.

---

## Unit 2 — Service layer (`mobile/services/notifications/`)

### Task 2: Domain types

**Files:**
- Create: `mobile/services/notifications/types.ts`

**Step 1: Write the file** (no test — pure types, verified by `tsc` + downstream usage):

```ts
// Local mirror do model Notification do swi-backend. Siblings isolados → NÃO
// importamos o Schema; após deploy, `ampx generate graphql-client-code` pode
// substituir por tipos gerados. Mirrors services/chat/types.ts. Datas ISO;
// ordenação por comparação lexicográfica (= cronológica).

export type NotificationDomain = 'weather' | 'chat' | 'reports' | 'journey' | 'faq';

// 'AppNotification' (não 'Notification') pra não colidir com o global do DOM/RN.
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  domain: NotificationDomain;        // → rota canônica no cliente
  targetId: string | null;           // deep-link a um recurso específico (futuro)
  read: boolean;                     // por-destinatário (1 destinatário)
  createdAt: string;                 // ISO datetime — ordenação recente-primeiro
}

export interface NotificationBackend {
  readonly myId: string;                              // sub do worker logado (mock = 'me')
  listNotifications(): Promise<AppNotification[]>;    // ordenado recente-primeiro
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  registerPushToken(token: string): Promise<void>;   // seam deploy-gated (SNS)
  subscribe(cb: (n: AppNotification) => void): () => void; // feed ao vivo (event bus no mock)
}
```

**Step 2: Typecheck.** Run `cd mobile && npx tsc --noEmit` → 0 new errors (8 baseline).
(No commit yet — commit with the reducers in Task 3 so the tree never has an orphan type file.)

### Task 3: Pure reducers (TDD)

**Files:**
- Create: `mobile/services/notifications/notificationReducers.ts`
- Test: `mobile/services/notifications/notificationReducers.test.ts`

**Step 1: Write the failing test** (`notificationReducers.test.ts`):

```ts
import {
  sortByRecent, applyNotification, markRead, markAllRead, unreadCount,
} from './notificationReducers';
import type { AppNotification } from './types';

const n = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'a', title: 'T', body: 'B', domain: 'chat', targetId: null,
  read: false, createdAt: '2026-06-23T10:00:00.000Z', ...over,
});

describe('notificationReducers — sortByRecent', () => {
  it('ordena desc por createdAt (recente primeiro)', () => {
    const a = n({ id: 'a', createdAt: '2026-06-23T09:00:00.000Z' });
    const b = n({ id: 'b', createdAt: '2026-06-23T12:00:00.000Z' });
    const c = n({ id: 'c', createdAt: '2026-06-23T10:00:00.000Z' });
    expect(sortByRecent([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('notificationReducers — applyNotification', () => {
  it('insere uma notificação nova e mantém ordenado', () => {
    const a = n({ id: 'a', createdAt: '2026-06-23T09:00:00.000Z' });
    const fresh = n({ id: 'z', createdAt: '2026-06-23T13:00:00.000Z' });
    const out = applyNotification([a], fresh);
    expect(out.map((x) => x.id)).toEqual(['z', 'a']);
  });
  it('faz update-or-insert (dedupe por id, sem duplicar)', () => {
    const a = n({ id: 'a', read: false });
    const out = applyNotification([a], n({ id: 'a', read: true, createdAt: '2026-06-23T14:00:00.000Z' }));
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe(true);
  });
});

describe('notificationReducers — markRead / markAllRead / unreadCount', () => {
  it('markRead marca só o id alvo', () => {
    const out = markRead([n({ id: 'a', read: false }), n({ id: 'b', read: false })], 'a');
    expect(out.find((x) => x.id === 'a')!.read).toBe(true);
    expect(out.find((x) => x.id === 'b')!.read).toBe(false);
  });
  it('markAllRead marca todas', () => {
    const out = markAllRead([n({ id: 'a', read: false }), n({ id: 'b', read: true })]);
    expect(out.every((x) => x.read)).toBe(true);
  });
  it('unreadCount conta só as não-lidas', () => {
    expect(unreadCount([n({ read: false }), n({ read: false }), n({ read: true })])).toBe(2);
  });
});
```

**Step 2: Run, verify it fails.** Run `cd mobile && npx jest notificationReducers` → FAIL (module not found).

**Step 3: Implement** (`notificationReducers.ts`):

```ts
// Lógica PURA da lista de notificações, compartilhada pelo mock e pelo provider.
// Sem efeitos/relógio: createdAt chega pronto. Ordenação por ISO string
// (lexicográfica = cronológica, recente-primeiro). Espelha chatReducers.ts.
import type { AppNotification } from './types';

export function sortByRecent(ns: AppNotification[]): AppNotification[] {
  return [...ns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function applyNotification(ns: AppNotification[], n: AppNotification): AppNotification[] {
  // update-or-insert por id (dedupe), depois re-ordena recente-primeiro.
  const without = ns.filter((x) => x.id !== n.id);
  return sortByRecent([...without, n]);
}

export function markRead(ns: AppNotification[], id: string): AppNotification[] {
  return ns.map((n) => (n.id === id ? { ...n, read: true } : n));
}

export function markAllRead(ns: AppNotification[]): AppNotification[] {
  return ns.map((n) => (n.read ? n : { ...n, read: true }));
}

export function unreadCount(ns: AppNotification[]): number {
  return ns.reduce((acc, n) => (n.read ? acc : acc + 1), 0);
}
```

**Step 4: Run, verify it passes.** Run `cd mobile && npx jest notificationReducers` → PASS.

**Step 5: Commit.**
```bash
git add mobile/services/notifications/types.ts mobile/services/notifications/notificationReducers.ts mobile/services/notifications/notificationReducers.test.ts
git commit -m "feat(notifications): domain types + pure list reducers (TDD)"
```

### Task 4: Mock backend with event bus (TDD)

**Files:**
- Create: `mobile/services/notifications/mockNotificationBackend.ts`
- Test: `mobile/services/notifications/mockNotificationBackend.test.ts`

**Step 1: Write the failing test:**

```ts
import { mockNotificationBackend, __pushForTest, __lastTokenForTest } from './mockNotificationBackend';
import type { AppNotification } from './types';

describe('mockNotificationBackend — seed + list', () => {
  it('lista as 12 notificações semeadas, ordenadas recente-primeiro', async () => {
    const list = await mockNotificationBackend.listNotifications();
    expect(list).toHaveLength(12);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt >= list[i].createdAt).toBe(true);
    }
  });
  it('o item mais recente é o alerta meteorológico (domain weather, não-lido)', async () => {
    const [first] = await mockNotificationBackend.listNotifications();
    expect(first.id).toBe('alerta-meteorologico');
    expect(first.domain).toBe('weather');
    expect(first.read).toBe(false);
  });
});

describe('mockNotificationBackend — markRead / markAllRead persistem', () => {
  it('markRead persiste no store', async () => {
    await mockNotificationBackend.markRead('alerta-meteorologico');
    const list = await mockNotificationBackend.listNotifications();
    expect(list.find((n) => n.id === 'alerta-meteorologico')!.read).toBe(true);
  });
  it('markAllRead zera todas', async () => {
    await mockNotificationBackend.markAllRead();
    const list = await mockNotificationBackend.listNotifications();
    expect(list.every((n) => n.read)).toBe(true);
  });
});

describe('mockNotificationBackend — subscribe (event bus) + push token', () => {
  it('subscribe recebe um push simulado e unsubscribe para de receber', () => {
    const received: AppNotification[] = [];
    const unsub = mockNotificationBackend.subscribe((n) => received.push(n));
    const fresh: AppNotification = {
      id: 'srv-1', title: 'Nova', body: 'do servidor', domain: 'reports',
      targetId: null, read: false, createdAt: '2026-06-23T23:00:00.000Z',
    };
    __pushForTest(fresh);
    expect(received.map((n) => n.id)).toEqual(['srv-1']);
    unsub();
    __pushForTest({ ...fresh, id: 'srv-2' });
    expect(received.map((n) => n.id)).toEqual(['srv-1']); // não recebeu o 2º
  });
  it('registerPushToken é no-op (armazena, não lança)', async () => {
    await expect(mockNotificationBackend.registerPushToken('tok-123')).resolves.toBeUndefined();
    expect(__lastTokenForTest()).toBe('tok-123');
  });
});
```

> NOTE: tests share the module-level store (markRead/markAllRead mutate it). They are written so later tests tolerate earlier mutations; the subscribe test uses fresh server ids unaffected by read-state. Keep the order as written.

**Step 2: Run, verify it fails.** Run `cd mobile && npx jest mockNotificationBackend` → FAIL (module not found).

**Step 3: Implement** (`mockNotificationBackend.ts`):

```ts
import type { AppNotification, NotificationBackend, NotificationDomain } from './types';
import {
  sortByRecent, applyNotification,
  markRead as markReadReducer, markAllRead as markAllReadReducer,
} from './notificationReducers';

// Backend demo in-memory pra slice Notificações. Mirrors mockChatBackend.ts: store
// mutável module-level semeado no import, servido com um tiny async hop (`tick`) e
// clone defensivo nas leituras. Um EVENT BUS de canal único (`subscribe(cb)`)
// simula `client.models.Notification.onCreate` do AppSync. NÃO há gerador de push
// sintético no app rodando — chegadas reais vêm do servidor (SNS/AppSync) no
// deploy; o bus é exercitado nos testes via `__pushForTest`. `myId = 'me'`.
//
// Seed migrado do array estático de app/(app)/notifications.tsx (12 itens): cada
// item recebe um `domain` derivado do href original + um createdAt ISO sintético
// decrescente (1º = mais recente). Mix de read/unread realista (3 não-lidas).

const MY_ID = 'me';
const BASE = '2026-06-23T15:00:00.000Z'; // relógio base fixo → seed determinístico
function isoMinusMinutes(minutes: number): string {
  return new Date(new Date(BASE).getTime() - minutes * 60_000).toISOString();
}

type Seed = {
  id: string; title: string; body: string;
  domain: NotificationDomain; targetId?: string; read: boolean; minutesAgo: number;
};

const SEED: Seed[] = [
  { id: 'alerta-meteorologico', title: 'Alerta Meteorológico', body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', domain: 'weather', read: false, minutesAgo: 5 },
  { id: 'atividade-colaborador', title: 'Atividade de Colaborador', body: 'Ana atualizou o status da manutenção preventiva no setor de produção.', domain: 'chat', read: false, minutesAgo: 30 },
  { id: 'feedback-recebido', title: 'Feedback Recebido', body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.', domain: 'chat', read: false, minutesAgo: 90 },
  { id: 'novo-relatorio', title: 'Novo Relatório Atribuído', body: 'Relatório de segurança do setor 5 foi designado para sua análise.', domain: 'reports', read: true, minutesAgo: 180 },
  { id: 'relatorio-qualidade', title: 'Relatório de Qualidade', body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.', domain: 'reports', read: true, minutesAgo: 240 },
  { id: 'treinamento', title: 'Notificação de Treinamento', body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.', domain: 'journey', read: true, minutesAgo: 300 },
  { id: 'nova-tarefa', title: 'Nova Tarefa Atribuída', body: 'Realizar auditoria dos processos de armazenamento até o final da semana.', domain: 'journey', read: true, minutesAgo: 360 },
  { id: 'nova-inspecao', title: 'Nova Inspeção Programada', body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.', domain: 'journey', read: true, minutesAgo: 420 },
  { id: 'cronograma', title: 'Mudança no Cronograma', body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.', domain: 'journey', read: true, minutesAgo: 480 },
  { id: 'comentario-relatorio', title: 'Comentário em Relatório', body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`, domain: 'chat', read: true, minutesAgo: 540 },
  { id: 'atualizacao-procedimento', title: 'Atualização de Procedimento', body: 'Procedimento de emergência revisado e disponível para consulta.', domain: 'faq', read: true, minutesAgo: 600 },
  { id: 'novo-comentario', title: 'Novo Comentário', body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`, domain: 'chat', read: true, minutesAgo: 660 },
];

function buildSeed(): AppNotification[] {
  return SEED.map((s) => ({
    id: s.id, title: s.title, body: s.body, domain: s.domain,
    targetId: s.targetId ?? null, read: s.read, createdAt: isoMinusMinutes(s.minutesAgo),
  }));
}

// ---- Store mutável module-level ----
let notifications: AppNotification[] = sortByRecent(buildSeed());
let lastToken: string | null = null;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- Event bus in-memory (simula AppSync onCreate, canal único por-usuário) ----
type Listener = (n: AppNotification) => void;
const listeners = new Set<Listener>();
function emit(n: AppNotification) { listeners.forEach((cb) => cb(n)); }

export const mockNotificationBackend: NotificationBackend = {
  myId: MY_ID,

  async listNotifications() {
    await tick();
    return sortByRecent(notifications).map((n) => ({ ...n }));
  },

  async markRead(id) {
    await tick();
    notifications = markReadReducer(notifications, id);
  },

  async markAllRead() {
    await tick();
    notifications = markAllReadReducer(notifications);
  },

  async registerPushToken(token) {
    await tick();
    lastToken = token; // no-op de entrega; no deploy → SNS createPlatformEndpoint
  },

  subscribe(cb) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

// Test-only: simula um push do servidor (o app NUNCA chama isto — chegadas reais
// vêm do AppSync/SNS no deploy). Empurra pro store + emite no bus.
export function __pushForTest(n: AppNotification): void {
  notifications = applyNotification(notifications, n);
  emit(n);
}
export function __lastTokenForTest(): string | null {
  return lastToken;
}
```

**Step 4: Run, verify it passes.** Run `cd mobile && npx jest mockNotificationBackend` → PASS.

**Step 5: Commit.**
```bash
git add mobile/services/notifications/mockNotificationBackend.ts mobile/services/notifications/mockNotificationBackend.test.ts
git commit -m "feat(notifications): mock backend (seed migrado + event-bus + push-token no-op)"
```

### Task 5: Amplify stub (deploy-gated)

**Files:**
- Create: `mobile/services/notifications/amplifyNotificationBackend.ts`

**Step 1: Write the file** (mirrors `amplifyChatBackend.ts`):

```ts
import { generateClient } from 'aws-amplify/data';
import type { AppNotification, NotificationBackend } from './types';

const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyNotificationBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyNotificationBackend: NotificationBackend = {
  myId: '', // virá do auth session (Cognito sub) no deploy
  async listNotifications(): Promise<AppNotification[]> { void client; throw NOT_READY('listNotifications'); },
  async markRead(id: string): Promise<void> { void id; throw NOT_READY('markRead'); },
  async markAllRead(): Promise<void> { throw NOT_READY('markAllRead'); },
  async registerPushToken(token: string): Promise<void> { void token; throw NOT_READY('registerPushToken'); },
  subscribe(cb: (n: AppNotification) => void): () => void {
    // Deploy: client.models.Notification.onCreate({ filter: { workerId: { eq: myId } } }).subscribe({ next: cb })
    void cb;
    return () => {};
  },
};
```

**Step 2: Typecheck.** Run `cd mobile && npx tsc --noEmit` → 0 new errors.
(Commit with Task 6.)

### Task 6: Flag selector (TDD)

**Files:**
- Create: `mobile/services/notifications/getNotificationBackend.ts`
- Test: `mobile/services/notifications/getNotificationBackend.test.ts`

**Step 1: Write the failing test** (mirrors `getChatBackend.test.ts`):

```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getNotificationBackend } from './getNotificationBackend';
import { mockNotificationBackend } from './mockNotificationBackend';

describe('getNotificationBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });
});
```

**Step 2: Run, verify it fails.** Run `cd mobile && npx jest getNotificationBackend` → FAIL (module not found).

**Step 3: Implement** (`getNotificationBackend.ts`):

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { NotificationBackend } from './types';
import { mockNotificationBackend } from './mockNotificationBackend';
import { amplifyNotificationBackend } from './amplifyNotificationBackend';

export function getNotificationBackend(): NotificationBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyNotificationBackend : mockNotificationBackend;
}
```

**Step 4: Run, verify it passes.** Run `cd mobile && npx jest getNotificationBackend` → PASS.

**Step 5: Commit.**
```bash
git add mobile/services/notifications/amplifyNotificationBackend.ts mobile/services/notifications/getNotificationBackend.ts mobile/services/notifications/getNotificationBackend.test.ts
git commit -m "feat(notifications): amplify stub (deploy-gated) + flag selector (TDD)"
```

### Task 7: Provider

**Files:**
- Create: `mobile/services/notifications/NotificationProvider.tsx`

**Step 1: Write the file** (mirrors `ChatProvider.tsx`; uses `.then(ok, err)` — NOT `.finally` — so the error state is reachable, the Chat lesson):

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { AppNotification } from './types';
import { getNotificationBackend } from './getNotificationBackend';
import {
  applyNotification,
  markRead as markReadReducer,
  markAllRead as markAllReadReducer,
  unreadCount as unreadCountReducer,
} from './notificationReducers';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface NotificationContextValue {
  myId: string;
  loadStatus: LoadStatus;
  notifications: AppNotification[];
  unreadCount: number;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getNotificationBackend(), []);
  const myId = backend.myId;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const load = useCallback(() => {
    setLoadStatus('loading');
    return backend.listNotifications().then(
      (ns) => { setNotifications(ns); setLoadStatus(ns.length ? 'ready' : 'empty'); },
      () => { setLoadStatus('error'); },
    );
  }, [backend]);

  useEffect(() => { load(); }, [load]);

  // Feed ao vivo: o servidor (mock event-bus / AppSync no deploy) empurra novas
  // notificações; o reducer faz update-or-insert e re-ordena.
  useEffect(() => {
    const unsub = backend.subscribe((n) => {
      setNotifications((prev) => applyNotification(prev, n));
    });
    return unsub;
  }, [backend]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => markReadReducer(prev, id)); // otimista
    try { await backend.markRead(id); } catch { /* swallow; reconcilia no próximo load */ }
  }, [backend]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => markAllReadReducer(prev)); // otimista
    try { await backend.markAllRead(); } catch { /* swallow */ }
  }, [backend]);

  const unreadCount = useMemo(() => unreadCountReducer(notifications), [notifications]);

  const value = useMemo<NotificationContextValue>(() => ({
    myId, loadStatus, notifications, unreadCount, load, markRead, markAllRead,
  }), [myId, loadStatus, notifications, unreadCount, load, markRead, markAllRead]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
```

**Step 2: Typecheck.** Run `cd mobile && npx tsc --noEmit` → 0 new errors.

**Step 3: Commit.**
```bash
git add mobile/services/notifications/NotificationProvider.tsx
git commit -m "feat(notifications): NotificationProvider (load/subscribe/markRead/markAllRead, reachable error)"
```

> **Two-gate review (Unit 2):** spec reviewer (interface ↔ design parity; mock seed maps the 12 items to correct domains; reducers pure; provider uses `.then(ok,err)`) + code-quality reviewer (DRY vs chat, no hardcoded values, test quality). Fix + re-run `npx jest services/notifications` and `tsc`.

---

## Unit 3 — Wiring

### Task 8: `NotificationState` component

**Files:**
- Create: `mobile/components/notifications/NotificationState.tsx`

**Step 1: Write the file** (DS-composed loading/empty/error; single screen, simpler than `ChatState`; transparent bg so the screen's `JourneyTheme` gradient shows through):

```tsx
import { ActivityIndicator, View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

// State view da tela de Notificações (loading/empty/error). Espelha
// components/chat/ChatState.tsx: compõe primitivos do DS (Title + Text + Button)
// + o ActivityIndicator do RN (não há spinner no DS). Tokens via useTheme(); bg
// transparente pra deixar o gradiente JourneyTheme da tela aparecer atrás.
type StateKind = 'loading' | 'empty' | 'error';

interface NotificationStateProps {
  kind: StateKind;
  onRetry?: () => void; // obrigatório p/ kind==='error'
}

export function NotificationState({ kind, onRetry }: NotificationStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        gap: theme.gap.l,
        padding: theme.padding.l,
      }}
    >
      {kind === 'loading' ? (
        <ActivityIndicator size="large" color={theme.content.primary} />
      ) : (
        <Title variant="title.s" color={theme.content.dark} style={{ textAlign: 'center' }}>
          {kind === 'empty' ? 'Nenhuma notificação' : 'Não foi possível carregar'}
        </Title>
      )}
      <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
        {kind === 'loading'
          ? 'Carregando notificações…'
          : kind === 'empty'
            ? 'Você está em dia. Nenhuma notificação por aqui.'
            : 'Houve um problema ao buscar as notificações. Tente novamente.'}
      </Text>
      {kind === 'error' && onRetry && (
        <Button
          variant="contained"
          label="Tentar novamente"
          elevation="lg"
          accessibilityLabel="Tentar carregar as notificações de novo"
          onPress={onRetry}
        />
      )}
    </View>
  );
}
```

**Step 2: Typecheck.** Run `cd mobile && npx tsc --noEmit` → 0 new errors. (Commit with Task 9.)

### Task 9: Rewire `notifications.tsx`

**Files:**
- Modify: `mobile/app/(app)/notifications.tsx` (rewrite the data source + handlers; KEEP the gate, `JourneyTheme`, `NavFABs`, and BOTH modais unchanged)

**Step 0 (REQUIRED — Figma check before coding the unread treatment):** The "Minimal unread treatment" was approved *pending a Figma check*. Before writing the card styling, inspect Figma node **401:30469** (notifications list) for an existing unread/read distinction:
- Use `mcp__claude_ai_Figma__get_screenshot` + `get_design_context` for node `401:30469`.
- If Figma shows an unread treatment (dot, bold title, bg tint, accent bar) → match it with `useTheme()` tokens.
- If Figma has NO unread state (likely — the static demo had none) → apply the documented fallback below (an unread dot + emphasized title) and **flag it in the holistic review** for the user's visual sign-off. Do NOT invent elaborate styling.

The "marcar todas como lidas" action is a NEW affordance not in Figma (the user approved it); keep it minimal (DS `Button variant="ghost"`), shown only when `unreadCount > 0`, and flag it for visual sign-off too.

**Step 1: Rewrite the screen.** Replace the static `NOTIFICATIONS` array, the `Href`/`NotificationItem` types tied to it, and the `handleNotificationPress` body with the live backend. Concretely:

- **Default export** wraps the screen in the provider (inside the feature gate so the subscription only mounts when the feature is on):

```tsx
export default function Notifications() {
  if (!isFeatureEnabled('notifications')) {
    return <ProdOnlyPlaceholder />;
  }
  return (
    <NotificationProvider>
      <NotificationsScreen />
    </NotificationProvider>
  );
}
```

- **Imports** — add:
```tsx
import { NotificationProvider, useNotifications } from '../../services/notifications/NotificationProvider';
import type { AppNotification, NotificationDomain } from '../../services/notifications/types';
import { NotificationState } from '../../components/notifications/NotificationState';
```

- **Domain → route map** (preserves the existing routing table; `weather` is the in-place-modal special case, handled in the press handler, so it's excluded here):
```tsx
type Href =
  | '/(app)/chat/inbox'
  | '/(app)/reports'
  | '/(app)/journey'
  | '/(app)/settings/faq';

const DOMAIN_ROUTE: Record<Exclude<NotificationDomain, 'weather'>, Href> = {
  chat: '/(app)/chat/inbox',
  reports: '/(app)/reports',
  journey: '/(app)/journey',
  faq: '/(app)/settings/faq',
};
```

- **`NotificationCard`** — change props to carry an `AppNotification` (with `read`) instead of the old inline shape; add the unread treatment from Step 0. Fallback treatment (if Figma has none): an unread dot before the title using `theme.surface.secondary` (the blue cross-section accent — notifications are cross-domain, per the CTA-color-per-screen rule) and `Title` at full emphasis; read cards drop the dot and use `theme.content.medium` for the title. Keep the `memo` + the stable `onPress` `useCallback`. `more_vert` stays decorative.

- **`NotificationsScreen`** — consume the provider and render states:
```tsx
function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, loadStatus, unreadCount, load, markRead, markAllRead } = useNotifications();
  const [weatherAlertVisible, setWeatherAlertVisible] = useState(false);
  const [activeAlertVisible, setActiveAlertVisible] = useState(false);

  const handleNotificationPress = useCallback(
    (id: string) => {
      const n = notifications.find((x) => x.id === id);
      if (!n) return;
      markRead(id); // otimista; navega/abre em seguida
      if (n.domain === 'weather') { setWeatherAlertVisible(true); return; }
      router.push(DOMAIN_ROUTE[n.domain]);
    },
    [notifications, markRead, router],
  );

  // ... JourneyTheme gradient wraps everything (unchanged) ...
  // loadStatus 'loading' | 'empty' | 'error' → render <NotificationState .../>
  //   over the gradient (error → onRetry={load}); 'ready'|'idle' → the list.
  // List header row: <Title>Notificações</Title> + (unreadCount > 0 ?
  //   <Button variant="ghost" label="Marcar todas como lidas" onPress={markAllRead}/> : null)
  // {notifications.map((n) => <NotificationCard key={n.id} notif={n} onPress={handleNotificationPress} theme={theme} />)}
  // <NavFABs /> + the two Modais EXACTLY as today.
}
```

Keep the `JourneyTheme` gradient, the `ScrollView` layout, `NavFABs`, `WeatherAlertModal`, and `ActiveAlertModal` **byte-for-byte as they are today** — only the data source, the header row (mark-all action), the card props (unread), and the press handler change. The `weather` card still opens `WeatherAlertModal` in-place; its `onPrimaryAction` still opens `ActiveAlertModal` (unchanged).

**Step 2: Typecheck.** Run `cd mobile && npx tsc --noEmit` → 0 new errors.

**Step 3: Bundle check.** Run `cd mobile && npx expo export --platform web` → exit 0 (the `notifications` route bundles).

**Step 4: Commit.**
```bash
git add mobile/components/notifications/NotificationState.tsx "mobile/app/(app)/notifications.tsx"
git commit -m "feat(notifications): wire screen to NotificationProvider (live feed, read/unread, states)"
```

> **Two-gate review (Unit 3):** spec reviewer (routing table preserved incl. weather→modal; modais untouched; states wired; mark-all gated on unreadCount; Figma unread check performed) + code-quality reviewer (DS-only, tokens via `useTheme()`, no hardcoded values, memoization intact).

---

## Full-branch verification (at the branch tip)

**Step V.1:** `cd mobile && npx jest` → all green (existing 74 + the new notifications suites).
**Step V.2:** `cd mobile && npx tsc --noEmit` → **8 baseline errors, 0 new**.
**Step V.3:** `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.
**Step V.4:** `cd mobile && npx expo export --platform web` → exit 0.

Record the exact numbers in the holistic review.

> **Holistic review:** dispatch `superpowers:code-reviewer` over the whole branch diff vs `feat/mobile-login` — design parity, the Chat-lesson checks (reachable error state, no `.finally`-masked failures, optimistic updates reconciled), no DS violations, no hardcoded tokens. Fix findings + re-verify.

---

## Finishing the branch

Use `superpowers:finishing-a-development-branch`. **Merge to `feat/mobile-login` only with explicit user OK** (project rule). On OK: FF-merge `feat/backend-notifications` → `feat/mobile-login`, delete the slice branch, re-run `npx jest` on the merged result, update `docs/plans/2026-06-22-swi-backend-roadmap-design.md` (mark fatia 4 implemented) + the `project_swi_aws_backend` memory.

## Deploy-time pendências (carry forward, documented in the design)

Real cross-domain emit (report/task/chat/weather → Notification); SNS platform app + endpoint-per-token + publish-on-create; `expo-notifications` client token; push-token persistence model; `domain` ↔ route map contract sync; `targetId` deep-links to `reports/[id]`/chat threads; map the system `createdAt` at the amplify boundary; add a sort index if needed.
