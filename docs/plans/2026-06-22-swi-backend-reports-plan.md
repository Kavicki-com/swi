# Relatórios (SWI Backend) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Design: `2026-06-22-swi-backend-reports-design.md`. Roadmap: `2026-06-22-swi-backend-roadmap-design.md`.
> **Commit rule (SWI):** os steps de commit abaixo são estrutura — NÃO commitar sem luz verde explícita do usuário (igual Fatias 1/3, aprovação por lote).

**Goal:** Ligar os relatórios do app worker (listar/detalhar/criar com fotos) a um backend real `Report` (Amplify Gen 2 + S3), via Abordagem A (mock+amplify atrás de flag), deploy-gated.

**Architecture:** Modelo `Report` (+ Storage S3) em `swi-backend`. No mobile, um `services/reports/` espelha o padrão do `services/profile/` (interface `ReportsBackend` + impl `mock`/`amplify` + selector por flag `AUTH_BACKEND` + `ReportsProvider`/`useReports`). As 3 telas (`index`/`new`/`[id]`) trocam arrays inline pelo provider, com estados loading/empty/error. Só o caminho `mock` é unit-testado; o `amplify` é typechecado (sem conta AWS).

**Tech Stack:** Expo Router / React Native, `@kavicki/swi-design-system`, `aws-amplify` (Data + Storage), `@aws-amplify/backend`, jest-expo.

---

## Phase 0 — Branch

### Task 0: Criar a branch stacked

**Step 1:** `git checkout feat/mobile-login` (confirmar tree limpo: `git status`).
**Step 2:** `git checkout -b feat/backend-reports`.
Expected: nova branch a partir de `feat/mobile-login`.

---

## Phase 1 — Backend (`swi-backend`)

### Task 1: Adicionar o model `Report`

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts` (dentro do `a.schema({ ... })`, após `LocationSample`)

**Step 1:** Adicionar ao schema:

```ts
  Report: a
    .model({
      title: a.string().required(),
      summary: a.string(),
      status: a.enum(['accept', 'pending', 'canceled', 'info']),
      statusLabel: a.string(),
      authorName: a.string(),
      authorAvatarKey: a.string(),
      creationDate: a.datetime(),
      sector: a.string(),
      responsibles: a.string().array(),
      details: a.string(),
      imageKeys: a.string().array(),
      // [{ id,title,sector,progress(0-100),tone:'success'|'warning'|'error',avatars:string[],overflowCount? }]
      activities: a.json(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.owner().to(['create', 'read']),
      allow.group('admin'),
    ]),
```

**Step 2:** Verificar tipos do backend.
Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0 (sem erros).

### Task 2: Storage S3 para anexos

**Files:**
- Create: `swi-backend/amplify/storage/resource.ts`
- Modify: `swi-backend/amplify/backend.ts`

**Step 1:** Criar `storage/resource.ts`:

```ts
import { defineStorage } from '@aws-amplify/backend';

// Anexos de relatórios. Worker autenticado lê; o dono escreve no próprio prefixo.
export const storage = defineStorage({
  name: 'swiReportsMedia',
  access: (allow) => ({
    'reports/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
```

**Step 2:** Registrar no `backend.ts` (importar `storage` e incluir no `defineBackend({ ... })`).

**Step 3:** Run: `cd swi-backend && npx tsc --noEmit -p amplify`
Expected: exit 0. Se a forma de `access`/`entity` divergir da versão instalada de `@aws-amplify/backend`, ajustar conforme os tipos instalados (não inventar API).

---

## Phase 2 — Service layer mobile (TDD)

Diretório novo: `mobile/services/reports/`. Espelha `mobile/services/profile/`.

### Task 3: `types.ts`

**Files:** Create `mobile/services/reports/types.ts`

```ts
// Espelho local do model Report do swi-backend (siblings isolados; NÃO importar
// o Schema — após deploy, `ampx generate` pode substituir por tipos gerados).
export type ReportStatus = 'accept' | 'pending' | 'canceled' | 'info';
export type ActivityTone = 'success' | 'warning' | 'error';

export interface ReportActivity {
  id: string;
  title: string;
  sector: string;
  progress: number; // 0-100
  tone: ActivityTone;
  avatars: string[]; // uris (resolvidas de S3 keys no amplify)
  overflowCount?: number;
}

export interface Report {
  id: string;
  title: string;
  summary: string;
  status: ReportStatus;
  statusLabel: string;
  authorName: string;
  authorAvatarUri: string;
  creationDate: string;
  sector: string;
  responsibles: string[];
  details: string;
  images: string[];
  activities: ReportActivity[];
}

export interface ReportInput {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageUris: string[]; // uris locais (sobem no amplify; ficam locais no mock)
}

export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
}
```

### Task 4: `mockReportsBackend.ts` (impl) + teste

**Files:**
- Create: `mobile/services/reports/mockReportsBackend.ts`
- Test: `mobile/services/reports/mockReportsBackend.test.ts`

**Step 1 — Escrever o teste que falha:**

```ts
import { mockReportsBackend } from './mockReportsBackend';

describe('mockReportsBackend', () => {
  it('list retorna relatórios semeados', async () => {
    const reports = await mockReportsBackend.list();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]).toHaveProperty('title');
  });
  it('get retorna relatório com detalhes/atividades para id conhecido', async () => {
    const [first] = await mockReportsBackend.list();
    const found = await mockReportsBackend.get(first.id);
    expect(found).not.toBeNull();
    expect((found?.details ?? '').length).toBeGreaterThan(0);
    expect(Array.isArray(found?.activities)).toBe(true);
  });
  it('get retorna null para id desconhecido', async () => {
    expect(await mockReportsBackend.get('inexistente')).toBeNull();
  });
  it('create prepende um relatório recuperável por list/get', async () => {
    const created = await mockReportsBackend.create({
      title: 'Teste', summary: 'Resumo', details: 'Detalhe',
      responsibles: ['Fulano'], imageUris: [],
    });
    expect(created.id).toBeTruthy();
    const list = await mockReportsBackend.list();
    expect(list.find((r) => r.id === created.id)).toBeTruthy();
    expect((await mockReportsBackend.get(created.id))?.title).toBe('Teste');
  });
});
```

**Step 2:** Run `cd mobile && npx jest services/reports/mockReportsBackend.test.ts` → FAIL (módulo não existe).

**Step 3 — Implementar:** migrar os dados dos arrays inline (`reports/index.tsx` REPORTS, `reports/[id].tsx` DETAIL_TEXT/ACTIVITIES) pra um seed; usar `Asset.fromModule(require('../../assets/avatar-construction.png')).uri` pros avatares e `require` das imagens existentes (`assets/report-image-1.png`, `report-image-2.png`). `create` gera id (`local-${Date.now()}`), prepende a um array em memória, defaults: `status:'pending'`, `statusLabel:'Em Revisão'`, `authorName` placeholder, `sector` placeholder, `creationDate` `new Date()` formatada, `images: input.imageUris`, `activities: []`.

**Step 4:** Run o teste → PASS.

**Step 5 (commit — aguardar OK):** `git add mobile/services/reports/{types.ts,mockReportsBackend.ts,mockReportsBackend.test.ts}`.

### Task 5: `getReportsBackend.ts` (selector) + teste

**Files:**
- Create: `mobile/services/reports/getReportsBackend.ts`
- Test: `mobile/services/reports/getReportsBackend.test.ts`

**Step 1 — Teste:**

```ts
import { getReportsBackend } from './getReportsBackend';
import { mockReportsBackend } from './mockReportsBackend';

describe('getReportsBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getReportsBackend()).toBe(mockReportsBackend);
  });
});
```

**Step 2:** Run → FAIL.

**Step 3 — Implementar** (igual `getProfileBackend.ts`):

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';
import { amplifyReportsBackend } from './amplifyReportsBackend';

export function getReportsBackend(): ReportsBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyReportsBackend : mockReportsBackend;
}
```

**Step 4:** Run → PASS (precisa do `amplifyReportsBackend` da Task 6 existir pra compilar; criar stub primeiro se necessário, depois preencher).

### Task 6: `amplifyReportsBackend.ts` (typecheck-only)

**Files:** Create `mobile/services/reports/amplifyReportsBackend.ts`

**Step 1 — Implementar** (mapeia model ↔ `Report`; usa Data + Storage):

```ts
import { generateClient } from 'aws-amplify/data';
import { uploadData, getUrl } from 'aws-amplify/storage';
import type { Report, ReportInput, ReportsBackend } from './types';
// import type { Schema } from '...'; // só após `ampx generate` (Fase 6 do deploy)

// const client = generateClient<Schema>();

export const amplifyReportsBackend: ReportsBackend = {
  async list() { /* client.models.Report.list() → map → Report[] */ return []; },
  async get(_id) { /* client.models.Report.get({id}) → map */ return null; },
  async create(input: ReportInput) {
    // 1) uploadData de cada imageUri → keys; 2) client.models.Report.create(...)
    // 3) resolver getUrl pras keys → Report
    throw new Error('amplifyReportsBackend.create: deploy-gated (sem conta AWS)');
  },
};
```

Nota: como não há `amplify_outputs.json`/Schema gerado, manter as chamadas comentadas/typesafe o suficiente pra `tsc` passar; preencher de verdade na Fase de deploy. (Mesmo padrão do `amplifyProfileBackend.ts`.)

**Step 2:** Run `cd mobile && npx tsc --noEmit` → sem erros novos.

### Task 7: `ReportsProvider.tsx` + `useReports`

**Files:**
- Create: `mobile/services/reports/ReportsProvider.tsx`
- Modify: `mobile/app/_layout.tsx` (montar `<ReportsProvider>` junto aos outros providers)

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Report, ReportInput } from './types';
import { getReportsBackend } from './getReportsBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface ReportsState {
  reports: Report[];
  status: LoadStatus;
  load: () => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  create: (input: ReportInput) => Promise<Report>;
}
const ReportsContext = createContext<ReportsState | null>(null);

export function ReportsProvider({ children }: PropsWithChildren) {
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const backend = useMemo(() => getReportsBackend(), []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await backend.list();
      setReports(r);
      setStatus(r.length ? 'ready' : 'empty');
    } catch { setStatus('error'); }
  }, [backend]);

  const loadOne = useCallback((id: string) => backend.get(id), [backend]);
  const create = useCallback(async (input: ReportInput) => {
    const created = await backend.create(input);
    setReports((prev) => [created, ...prev]);
    return created;
  }, [backend]);

  const value = useMemo<ReportsState>(
    () => ({ reports, status, load, loadOne, create }),
    [reports, status, load, loadOne, create],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
```

---

## Phase 3 — Wiring das telas

### Task 8: Estados loading/empty/error (compostos com DS)

**Files:** Create `mobile/components/reports/ReportsListState.tsx` (e/ou `ReportDetailState.tsx`) — compõem DS (`Text`, `Button`, etc.). Sem inventar primitivo (regra DS). Espelhar `components/vitals/Vitals{Loading,Empty,Error}State.tsx`.

### Task 9: `reports/index.tsx`

**Files:** Modify `mobile/app/(app)/reports/index.tsx`
- Remover o array `REPORTS` e os tipos locais; `const { reports, status, load } = useReports();`
- `useEffect(() => { load(); }, [load])`.
- Render: `loading` → ListState loading; `empty` → ListState empty; `error` → ListState error+retry; `ready` → mapear `reports` em `ReportCard` (manter search/pagination locais).
- `ReportCard` recebe `creationDate`, `author`, `location`(sector), `responsibles`(join ', ') do `Report`.

### Task 10: `reports/[id].tsx`

**Files:** Modify `mobile/app/(app)/reports/[id].tsx`
- Remover `REPORTS`/`FALLBACK`/`DETAIL_TEXT`/`ACTIVITIES`; usar `loadOne(id)` em estado local (`useState<Report|null>` + status).
- Mapear `activities` (progress 0-100, tone→cor) e `images` do `Report`.
- Estados loading/empty(null)/error.

### Task 11: `reports/new.tsx`

**Files:** Modify `mobile/app/(app)/reports/new.tsx`
- `save()` chama `create({ title, summary, details, responsibles: responsiblesSelection.get() (resolver nomes), imageUris: [...attachments filtrados, uploadedFile] })`; limpa seleção; `router.back()`.
- Manter validação (`useField`) e media picker como estão.

---

## Phase 4 — Verificação (deploy-gated)

### Task 12: Suite verde
- `cd mobile && npx jest` → novos testes verdes, resto inalterado.
- `cd mobile && npx tsc --noEmit` → sem erros novos (8 baseline pré-existentes ok).
- `cd mobile && npx expo export --platform web` → exit 0 (todas as rotas bundlam).
- `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.

### Task 13: Review (igual Fatias 1/3)
- Two-gate review (spec compliance + code quality) via subagents; corrigir achados.
- Review holística final da fatia.

### Task 14: Docs + memória
- Atualizar `project_swi_aws_backend.md` (memória): fatia Relatórios implementada (mock-path), pendências de deploy (amplify list/get/create reais, Storage access shape, `ampx generate` Schema).
- Marcar no roadmap doc a fatia 1 como implementada.

---

## Pendências de deploy (quando existir conta AWS)
- Preencher `amplifyReportsBackend` (list/get/create reais + upload S3 + getUrl).
- `ampx generate graphql-client-code` → substituir o mirror `types.ts` pelo Schema gerado.
- Confirmar `access`/`entity('identity')` do Storage contra a versão instalada.
- Validar a regra `authenticated read` + `owner create` no console.

## Follow-ups dos reviews (não-bloqueantes, registrados 2026-06-23)
- **Auth — sem edit/delete pelo autor:** worker só `create`+`read` dos próprios; só
  admin edita. Se algum dia precisar "editar rascunho", mudar a regra `owner`.
- **`owner().to(['read'])` é redundante** com `authenticated().to(['read'])` (todo
  owner já é authenticated). Inofensivo; pode virar `['create']` no deploy pra clareza.
- **`authorName`/`authorAvatarKey` são display não-confiável** (o cliente seta). A
  identidade confiável é o campo `owner` implícito do Amplify — nenhuma lógica de
  authz deve usar `authorName`.
- **Naming `overflowCount` → `totalCount`:** o DS `AvatarGroup` trata `totalCount`
  como headcount total e rende `total - visíveis`. Hoje (seed 18, 2 visíveis) mostra
  `+16` — **idêntico ao demo anterior, sem regressão**, mas o nome do campo do mirror
  engana; renomear quando mexer no shape.
- **Gaps conhecidos do demo (não-bugs, pré-existentes):** `SearchInput` não filtra a
  lista, `Pagination` é estática, e os CTAs de comentário do `[id]` são no-op. Entram
  com a fatia de colaboração/Chat, não nesta.
