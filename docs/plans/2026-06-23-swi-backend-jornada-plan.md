# Jornada/Tarefas (SWI Backend) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Design: `2026-06-23-swi-backend-jornada-design.md`. Roadmap: `2026-06-22-swi-backend-roadmap-design.md`.
> **Commit rule (SWI):** os steps de commit abaixo são estrutura — NÃO commitar sem luz verde explícita do usuário (igual Fatias 1/3/Relatórios, aprovação por lote).

**Goal:** Ligar a jornada/tarefas do app worker (ver tarefas do dia, iniciar/pausar/retomar/finalizar com status + progresso reais, anexar fotos, cronômetro do turno) a um backend real `Journey`+`Task` (Amplify Gen 2 + S3), via Abordagem A (mock+amplify atrás de flag), deploy-gated.

**Architecture:** Dois models (`Journey` leve por worker/dia + `Task` atribuída ao worker) em `swi-backend`. No mobile, `services/journey/` espelha `services/reports/`: um módulo **puro** `progress.ts` centraliza a matemática de âncoras de tempo (elapsed/progress/transições), reusado pelo mock backend e pelo tick do cliente; `JourneyBackend` (interface) + impl `mock`/`amplify` + selector por flag `AUTH_BACKEND`; o `JourneyProvider` existente é refatorado pra backar a sessão no backend mantendo sua API. As 2 telas (`index`/`task/[id]`) trocam mock inline pelo provider, com estados loading/empty/error. Só `progress.ts` + `mock` são unit-testados; `amplify` é typechecado (sem conta AWS).

**Tech Stack:** Expo Router / React Native, `@kavicki/swi-design-system`, `aws-amplify` (Data + Storage), `@aws-amplify/backend`, jest-expo.

---

## Phase 0 — Branch

### Task 0: Criar a branch stacked

**Step 1:** `git checkout feat/mobile-login` (confirmar tree limpo: `git status`).
**Step 2:** `git checkout -b feat/backend-jornada`.
Expected: nova branch a partir de `feat/mobile-login` (tip `f3b46f9`).

---

## Phase 1 — Backend (`swi-backend`)

### Task 1: Adicionar os models `Journey` + `Task`

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts` (dentro do `a.schema({ ... })`, após `Report`)

**Step 1:** Adicionar ao schema:

```ts
  Journey: a
    .model({
      workerId: a.string().required(),     // Cognito sub
      date: a.date(),                       // o dia ("Hoje")
      state: a.enum(['idle', 'ongoing', 'paused']),
      activeTaskId: a.string(),
      startedAt: a.datetime(),              // 1ª task iniciada
      accumulatedSeconds: a.integer(),      // tempo do turno antes da pausa atual
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['read', 'create', 'update']),
      allow.group('admin'),
    ]),

  Task: a
    .model({
      assignedTo: a.string().required(),    // Cognito sub do worker
      title: a.string().required(),
      description: a.string(),
      objective: a.string(),
      estimatedMinutes: a.integer(),
      status: a.enum(['pending', 'in_progress', 'paused', 'done']),
      startedAt: a.datetime(),              // âncora p/ progresso real
      accumulatedSeconds: a.integer(),      // tempo trabalhado antes da pausa
      progressPct: a.float(),               // snapshot gravado nas transições
      scheduledDate: a.date(),              // "Hoje" — escopo da lista
      imageKeys: a.string().array(),        // S3 keys (uris no mock)
      interestedCount: a.integer(),
      interestedAvatarKeys: a.string().array(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('assignedTo').to(['read', 'update']),
      allow.group('admin'),
    ]),
```

**Step 2:** Verificar tipos do backend.
Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0 (sem erros).

### Task 2: Storage S3 — prefixo `journey/`

**Files:**
- Modify: `swi-backend/amplify/storage/resource.ts`

**Step 1:** Renomear `swiReportsMedia` → `swiMedia` e adicionar o prefixo `journey/{entity_id}/*` (um bucket, dois prefixos). `backend.ts` já importa o export `storage` — **não precisa mudar** (só o `name` interno muda, e nada foi deployado).

```ts
import { defineStorage } from '@aws-amplify/backend';

// Anexos de relatórios + fotos de tarefas. Worker autenticado lê; o dono
// escreve no próprio prefixo. Um bucket, prefixo por domínio.
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
  }),
});
```

**Step 2:** Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0. Se `access`/`entity` divergir da versão instalada de `@aws-amplify/backend`, ajustar conforme os tipos instalados (não inventar API).

---

## Phase 2 — Service layer mobile (TDD)

Diretório existente: `mobile/services/journey/` (só tem `JourneyProvider.tsx` hoje). Espelha `mobile/services/reports/`.

### Task 3: `progress.ts` (módulo PURO) + teste — TDD

> O coração da fatia: matemática de âncoras de tempo, determinística e injetável (`nowMs` por parâmetro). Espelha o estilo de `services/vitals/deriveStatus.ts`/`phase.ts` (funções puras unit-testadas). Reusado pelo mock backend (grava nas transições) e pelo tick do cliente (display).

**Files:**
- Create: `mobile/services/journey/progress.ts`
- Test: `mobile/services/journey/progress.test.ts`

**Step 1 — Escrever o teste que falha:**

```ts
import {
  elapsedSeconds, progressPct, formatDuration,
  startAnchors, pauseAnchors, resumeAnchors, endAnchors,
  type Anchors,
} from './progress';

const T0 = 1_000_000_000_000; // epoch ms fixo (determinístico)

describe('progress — elapsedSeconds', () => {
  it('parado retorna accumulatedSeconds', () => {
    const a: Anchors = { startedAt: null, accumulatedSeconds: 120, running: false };
    expect(elapsedSeconds(a, T0)).toBe(120);
  });
  it('rodando soma o segmento atual', () => {
    const a: Anchors = { startedAt: T0, accumulatedSeconds: 100, running: true };
    expect(elapsedSeconds(a, T0 + 30_000)).toBe(130); // +30s
  });
  it('nunca negativo se now < startedAt (clock skew)', () => {
    const a: Anchors = { startedAt: T0, accumulatedSeconds: 50, running: true };
    expect(elapsedSeconds(a, T0 - 5_000)).toBe(50);
  });
});

describe('progress — progressPct', () => {
  it('proporcional ao estimado, cap 100', () => {
    expect(progressPct(90 * 60, 180)).toBe(50);   // 90min de 180min
    expect(progressPct(999 * 60, 180)).toBe(100); // cap
  });
  it('estimado 0 → 0 (sem divisão por zero)', () => {
    expect(progressPct(100, 0)).toBe(0);
  });
});

describe('progress — formatDuration', () => {
  it('formata h:mm:ss', () => {
    expect(formatDuration(7 * 3600 + 55 * 60 + 12)).toBe('7:55:12');
    expect(formatDuration(0)).toBe('0:00:00');
  });
});

describe('progress — transições (reducers puros)', () => {
  it('start começa um segmento rodando', () => {
    const a = startAnchors({ startedAt: null, accumulatedSeconds: 0, running: false }, T0);
    expect(a).toEqual({ startedAt: T0, accumulatedSeconds: 0, running: true });
  });
  it('pause banca o elapsed e para', () => {
    const a = pauseAnchors({ startedAt: T0, accumulatedSeconds: 10, running: true }, T0 + 20_000);
    expect(a).toEqual({ startedAt: null, accumulatedSeconds: 30, running: false });
  });
  it('resume reabre um segmento sem perder o banco', () => {
    const a = resumeAnchors({ startedAt: null, accumulatedSeconds: 30, running: false }, T0 + 50_000);
    expect(a).toEqual({ startedAt: T0 + 50_000, accumulatedSeconds: 30, running: true });
  });
  it('end banca o segmento final e para', () => {
    const a = endAnchors({ startedAt: T0, accumulatedSeconds: 5, running: true }, T0 + 15_000);
    expect(a).toEqual({ startedAt: null, accumulatedSeconds: 20, running: false });
  });
});
```

**Step 2:** Run `cd mobile && npx jest services/journey/progress.test.ts` → FAIL (módulo não existe).

**Step 3 — Implementar:**

```ts
// Matemática PURA de âncoras de tempo, compartilhada por Task + Journey, pelo
// mock backend (grava nas transições) e pelo tick do cliente (display). Tempos
// em segundos; `startedAt`/`nowMs` em epoch ms pra ser determinístico e
// injetável em teste. Espelha o estilo puro de services/vitals/deriveStatus.ts.

export interface Anchors {
  startedAt: number | null;   // epoch ms; null quando parado
  accumulatedSeconds: number; // segundos bancados antes do segmento atual
  running: boolean;           // true enquanto o segmento atual roda
}

export function elapsedSeconds(a: Anchors, nowMs: number): number {
  if (!a.running || a.startedAt == null) return a.accumulatedSeconds;
  return a.accumulatedSeconds + Math.max(0, Math.floor((nowMs - a.startedAt) / 1000));
}

export function progressPct(elapsedSec: number, estimatedMinutes: number): number {
  if (estimatedMinutes <= 0) return 0;
  return Math.min(100, (elapsedSec / (estimatedMinutes * 60)) * 100);
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

export function startAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true };
}
export function pauseAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false };
}
export function resumeAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true };
}
export function endAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false };
}
```

**Step 4:** Run `cd mobile && npx jest services/journey/progress.test.ts` → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/journey/{progress.ts,progress.test.ts}`.

### Task 4: `types.ts`

**Files:** Create `mobile/services/journey/types.ts`

> Espelho local dos models `Journey`/`Task` (siblings isolados; NÃO importar o Schema — após deploy, `ampx generate` pode substituir). `startedAt` é ISO string no tipo de domínio; o `progress.ts` trabalha em epoch ms (converte na borda). `images`/`interestedAvatars` são uris resolvidas (de S3 keys no amplify).

```ts
export type TaskStatus = 'pending' | 'in_progress' | 'paused' | 'done';
export type JourneyState = 'idle' | 'ongoing' | 'paused';

export interface Task {
  id: string;
  assignedTo: string;
  title: string;
  description: string;
  objective: string;
  estimatedMinutes: number;
  status: TaskStatus;
  startedAt: string | null;       // ISO datetime
  accumulatedSeconds: number;
  progressPct: number;            // último snapshot persistido
  scheduledDate: string;          // ISO date
  images: string[];               // uris (resolvidas de keys no amplify)
  interestedCount: number;
  interestedAvatars: string[];    // uris
}

export interface JourneySession {
  state: JourneyState;
  activeTaskId: string | null;
  startedAt: string | null;       // ISO datetime
  accumulatedSeconds: number;
}

export interface JourneyBackend {
  getJourney(): Promise<JourneySession>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  startTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
  pauseJourney(): Promise<JourneySession>;
  resumeJourney(): Promise<JourneySession>;
  endJourney(): Promise<JourneySession>;
  addTaskPhoto(taskId: string, uri: string): Promise<Task>;
}
```

### Task 5: `mockJourneyBackend.ts` (impl) + teste

**Files:**
- Create: `mobile/services/journey/mockJourneyBackend.ts`
- Test: `mobile/services/journey/mockJourneyBackend.test.ts`

> Semeia as 4 tasks de hoje (migradas de `lib/journeyMockData.ts`, agora com `objective`/`estimatedMinutes`/`interested*`), todas `assignedTo` um worker demo, `scheduledDate` hoje, `status:'pending'`. Journey começa `idle`. As transições usam os reducers de `progress.ts` (status↔running: `in_progress`/`ongoing` ⇒ running). Estima 4×120min = 480min = **8h** (bate com o "8h" do donut idle). Avatares via `Asset.fromModule(require('../../assets/avatars/worker-N.png')).uri` (já usados em `task/[id].tsx`).

**Step 1 — Escrever o teste que falha:**

```ts
import { mockJourneyBackend } from './mockJourneyBackend';

describe('mockJourneyBackend', () => {
  it('listTasks retorna as tarefas semeadas (pending)', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]).toHaveProperty('title');
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });
  it('getTask retorna a tarefa com objetivo/estimado para id conhecido', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const found = await mockJourneyBackend.getTask(first.id);
    expect(found).not.toBeNull();
    expect((found?.objective ?? '').length).toBeGreaterThan(0);
    expect(found?.estimatedMinutes).toBeGreaterThan(0);
  });
  it('getTask retorna null para id desconhecido', async () => {
    expect(await mockJourneyBackend.getTask('inexistente')).toBeNull();
  });
  it('getJourney começa idle', async () => {
    const j = await mockJourneyBackend.getJourney();
    expect(j.state).toBe('idle');
    expect(j.activeTaskId).toBeNull();
  });
  it('startTask liga a jornada e marca a task in_progress', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const { journey, task } = await mockJourneyBackend.startTask(first.id);
    expect(journey.state).toBe('ongoing');
    expect(journey.activeTaskId).toBe(first.id);
    expect(task.status).toBe('in_progress');
  });
  it('pause→resume→end transita a jornada e zera no fim', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    await mockJourneyBackend.startTask(first.id);
    expect((await mockJourneyBackend.pauseJourney()).state).toBe('paused');
    expect((await mockJourneyBackend.resumeJourney()).state).toBe('ongoing');
    const ended = await mockJourneyBackend.endJourney();
    expect(ended.state).toBe('idle');
    expect(ended.activeTaskId).toBeNull();
  });
  it('addTaskPhoto anexa a uri à task', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const updated = await mockJourneyBackend.addTaskPhoto(first.id, 'file:///foto.jpg');
    expect(updated.images).toContain('file:///foto.jpg');
  });
});
```

**Step 2:** Run `cd mobile && npx jest services/journey/mockJourneyBackend.test.ts` → FAIL (módulo não existe).

**Step 3 — Implementar:** store mutável em memória (tasks + journey), servido com um `tick()` async (igual `mockReportsBackend`). Helpers de conversão `Anchors`↔modelo (`startedAt` ISO ↔ epoch ms; `running` derivado do status/state). As transições:
- `startTask(id)`: marca a task `in_progress` com `startAnchors`; seta journey `ongoing` + `activeTaskId`=id + `startAnchors` no turno; volta `{journey, task}`.
- `pauseJourney()`: task ativa e journey → `paused` com `pauseAnchors` (banca elapsed); grava `progressPct` snapshot na task.
- `resumeJourney()`: → `ongoing`/`in_progress` com `resumeAnchors`.
- `endJourney()`: task ativa → `done` (`endAnchors`, `progressPct` final); journey → `idle`, `activeTaskId`=null, `accumulatedSeconds` bancado.
- `addTaskPhoto(id, uri)`: `images = [...images, uri]`.
- `getJourney`/`listTasks`/`getTask`: retornam cópias (`{ ...x }`).
Usar `Date.now()` pro `nowMs` em runtime (os testes acima não asseguram segundos exatos — só estrutura/estado).

**Step 4:** Run o teste → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/journey/{types.ts,mockJourneyBackend.ts,mockJourneyBackend.test.ts}`.

### Task 6: `getJourneyBackend.ts` (selector) + teste

**Files:**
- Create: `mobile/services/journey/getJourneyBackend.ts`
- Test: `mobile/services/journey/getJourneyBackend.test.ts`

**Step 1 — Teste** (espelha `getReportsBackend.test.ts`, incl. os mocks de `featureFlags` + `aws-amplify/data`):

```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getJourneyBackend } from './getJourneyBackend';
import { mockJourneyBackend } from './mockJourneyBackend';

describe('getJourneyBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });
});
```

**Step 2:** Run → FAIL.

**Step 3 — Implementar** (igual `getReportsBackend.ts`):

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { JourneyBackend } from './types';
import { mockJourneyBackend } from './mockJourneyBackend';
import { amplifyJourneyBackend } from './amplifyJourneyBackend';

export function getJourneyBackend(): JourneyBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyJourneyBackend : mockJourneyBackend;
}
```

**Step 4:** Run → PASS (precisa do stub da Task 7 existir pra compilar — criar Task 7 antes ou stub mínimo primeiro).

### Task 7: `amplifyJourneyBackend.ts` (typecheck-only)

**Files:** Create `mobile/services/journey/amplifyJourneyBackend.ts`

> Espelha `amplifyReportsBackend.ts`: client não-tipado (isola do Schema), chamadas reais guardadas/comentadas, métodos lançam até o deploy (Fase 6). Typecheca e o selector importa; o caminho mock nunca o chama.

```ts
import { generateClient } from 'aws-amplify/data';
import type { JourneyBackend, JourneySession, Task } from './types';

const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyJourneyBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyJourneyBackend: JourneyBackend = {
  async getJourney(): Promise<JourneySession> { void client; throw NOT_READY('getJourney'); },
  async listTasks(): Promise<Task[]> { throw NOT_READY('listTasks'); },
  async getTask(id: string): Promise<Task | null> { void id; throw NOT_READY('getTask'); },
  async startTask(taskId: string) { void taskId; throw NOT_READY('startTask'); },
  async pauseJourney() { throw NOT_READY('pauseJourney'); },
  async resumeJourney() { throw NOT_READY('resumeJourney'); },
  async endJourney() { throw NOT_READY('endJourney'); },
  async addTaskPhoto(taskId: string, uri: string) { void taskId; void uri; throw NOT_READY('addTaskPhoto'); },
};
```

**Step 2:** Run `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 8: Refatorar `JourneyProvider.tsx` (backa a sessão no backend)

**Files:** Modify `mobile/services/journey/JourneyProvider.tsx`

> Mantém a API pública (`state`, `activeTaskId`, `startTask`, `pauseJourney`, `resumeJourney`, `endJourney`) que as telas já consomem, mas agora persistindo via backend; adiciona `tasks`, `getTask`, `addTaskPhoto` e a máquina `loadStatus`. **Dois eixos de estado:** `loadStatus` (carregamento) vs `state` (sessão). As mutations passam a ser `async` (as telas fazem fire-and-forget no `onPress`).

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { JourneyState, JourneySession, Task } from './types';
import { getJourneyBackend } from './getJourneyBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface JourneyContextValue {
  loadStatus: LoadStatus;
  tasks: Task[];
  state: JourneyState;
  activeTaskId: string | null;
  load: () => Promise<void>;
  getTask: (id: string) => Promise<Task | null>;
  startTask: (taskId: string) => Promise<void>;
  pauseJourney: () => Promise<void>;
  resumeJourney: () => Promise<void>;
  endJourney: () => Promise<void>;
  addTaskPhoto: (taskId: string, uri: string) => Promise<Task>;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getJourneyBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [session, setSession] = useState<JourneySession>({
    state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0,
  });

  const load = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const [j, t] = await Promise.all([backend.getJourney(), backend.listTasks()]);
      setSession(j);
      setTasks(t);
      setLoadStatus(t.length ? 'ready' : 'empty');
    } catch { setLoadStatus('error'); }
  }, [backend]);

  useEffect(() => { load(); }, [load]);

  const getTask = useCallback((id: string) => backend.getTask(id), [backend]);

  const startTask = useCallback(async (taskId: string) => {
    const { journey, task } = await backend.startTask(taskId);
    setSession(journey);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
  }, [backend]);

  const pauseJourney = useCallback(async () => setSession(await backend.pauseJourney()), [backend]);
  const resumeJourney = useCallback(async () => setSession(await backend.resumeJourney()), [backend]);
  const endJourney = useCallback(async () => {
    setSession(await backend.endJourney());
    // refrescar tasks (a ativa virou 'done')
    setTasks(await backend.listTasks());
  }, [backend]);

  const addTaskPhoto = useCallback(async (taskId: string, uri: string) => {
    const updated = await backend.addTaskPhoto(taskId, uri);
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    return updated;
  }, [backend]);

  const value = useMemo<JourneyContextValue>(() => ({
    loadStatus, tasks,
    state: session.state, activeTaskId: session.activeTaskId,
    load, getTask, startTask, pauseJourney, resumeJourney, endJourney, addTaskPhoto,
  }), [loadStatus, tasks, session, load, getTask, startTask, pauseJourney, resumeJourney, endJourney, addTaskPhoto]);

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error('useJourney must be used inside JourneyProvider');
  return ctx;
}
```

**Step 2:** Run `cd mobile && npx tsc --noEmit` → vai falhar nas telas (ainda usam a API antiga síncrona) — esperado; corrige no Phase 3. `npx jest` dos services segue verde.

---

## Phase 3 — Wiring das telas

### Task 9: Estados loading/empty/error (compostos com DS)

**Files:** Create `mobile/components/journey/JourneyState.tsx`

> Espelha `components/reports/ReportsListState.tsx` (um `CenteredState` interno + wrappers `JourneyListState`/`TaskDetailState`). Compõe DS (`Title`/`Text`/`Button`) + `ActivityIndicator`. Tokens via `useTheme()`. **Sem inventar primitivo** (regra DS). Copy: lista → "Nenhuma tarefa hoje" / "Carregando tarefas…"; detalhe → "Tarefa não encontrada" / "Carregando tarefa…".

### Task 10: `journey/index.tsx`

**Files:** Modify `mobile/app/(app)/journey/index.tsx`
- Remover o import de `TASKS` (`lib/journeyMockData`); usar `const { loadStatus, tasks, state, activeTaskId, startTask, pauseJourney, resumeJourney, endJourney } = useJourney();`.
- Render por `loadStatus`: `loading`→`JourneyListState loading`; `empty`→`JourneyListState empty`; `error`→`JourneyListState error` + retry(`load`); senão a tela.
- `activeTask`/`upcomingTasks` derivam de `tasks` (não mais de `TASKS`).
- Donut: idle → `formatHours(sum estimatedMinutes das pending)` (= "8h"); ongoing/paused → `formatDuration(elapsedSeconds(sessionAnchors, nowMs))` via um tick local (`useEffect` setInterval 1s → `setNow(Date.now())`, só quando `state!=='idle'`). Converter `session.startedAt` ISO→ms + `running = state==='ongoing'`.
- CTAs chamam as mutations async (fire-and-forget no `onPress`, igual hoje).

### Task 11: `journey/task/[id].tsx`

**Files:** Modify `mobile/app/(app)/journey/task/[id].tsx`
- Remover `findTaskById`/`FALLBACK_TASK` e os blocos hardcoded de Objetivo/Tempo/Interessados; carregar a task via `useJourney().getTask(id)` em estado local (`useState<Task|null>` + status loading/empty/error). (Alternativa: achar em `tasks` do provider; mas `getTask` mantém paridade com o `loadOne` dos Relatórios.)
- `objective`, `estimatedMinutes` ("Xh até a conclusão"), `interestedCount`/`interestedAvatars` saem da `Task`.
- `TaskProgress`: deixa de usar o crawl fixo 1pt/s; passa a derivar das âncoras reais (`elapsedSeconds`+`progressPct` de `progress.ts`) com tick 1s **só quando** a task está `in_progress`. `paused`/`done`/`pending` mostram o snapshot `progressPct` estático.
- Fotos: inicializam de `task.images` (slots preenchidos); `showPicker(i)` chama `addTaskPhoto(id, uri)` (persiste no provider) em vez do `setState` local.
- Estado da tarefa (`taskState`) deriva de `isActiveTask` (activeTaskId===id) + `state`/`task.status`. CTAs chamam as mutations async.

### Task 12: Limpar `lib/journeyMockData.ts`

**Step 1:** `grep -rn "journeyMockData\|FALLBACK_TASK\|findTaskById" mobile` (via Grep) — confirmar que só `index.tsx`/`task/[id].tsx` importavam e já foram migrados.
**Step 2:** Se nenhum outro importer, **deletar** `mobile/lib/journeyMockData.ts` (a semente vive no `mockJourneyBackend`). Se houver importer inesperado, parar e reportar.
**Step 3:** Run `cd mobile && npx tsc --noEmit` → sem erros novos.

---

## Phase 4 — Verificação (deploy-gated)

### Task 13: Suite verde
- `cd mobile && npx jest` → novos testes (`progress`, `mockJourneyBackend`, `getJourneyBackend`) verdes, resto inalterado.
- `cd mobile && npx tsc --noEmit` → sem erros novos (8 baseline pré-existentes ok).
- `cd mobile && npx expo export --platform web` → exit 0 (todas as rotas bundlam).
- `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.

### Task 14: Review (igual Fatias 1/3/Relatórios)
- Two-gate review (spec compliance + code quality) via subagents; corrigir achados.
- Review holística final da fatia. Pontos de atenção pro reviewer: a matemática de `progress.ts` (clock skew, cap, divisão por zero), os dois eixos `loadStatus`×`state`, e o tick não vazar (`clearInterval` no cleanup; `freezeOnBlur` já pausa cached screens).

### Task 15: Docs + memória
- Atualizar `project_swi_aws_backend.md` (memória): fatia Jornada/Tarefas implementada (mock-path), pendências de deploy.
- Marcar no roadmap doc a fatia 2 (Jornada/Tarefas) como implementada.

---

## Pendências de deploy (quando existir conta AWS)
- Preencher `amplifyJourneyBackend` (get/list/transições reais + upload S3 + getUrl; mapear model↔tipos; converter `startedAt` ISO↔ms).
- `ampx generate graphql-client-code` → substituir o mirror `types.ts` pelo Schema gerado.
- Confirmar `access`/`entity('identity')` do Storage (prefixo `journey/`) contra a versão instalada.
- Validar `ownerDefinedIn('assignedTo')`/`ownerDefinedIn('workerId')` no console.
- **Atribuição real:** sem UI de criar/atribuir no worker — o admin (swi-admin, hardening) ou um seed cria as `Task` com `assignedTo`. Sem isso, o amplify path lista vazio (estado `empty`, correto).

## Riscos / decisões herdadas
- **Caveat de auth** (`update` amplo pelo worker) — field-level no hardening (fatia 7).
- **Progresso "real" = âncoras + tick de display**, não write por segundo. Se um dia precisar de timesheet/auditoria de tempo, aí sim persistir segmentos — fora do escopo.
- **Sem `hasMany`** Journey↔Task: lista por `assignedTo`+`scheduledDate`. Se a escala pedir, migrar pra relação/secondary index no hardening.
