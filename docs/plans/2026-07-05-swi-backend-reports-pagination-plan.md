# Relatórios — Paginação Numerada Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) para implementar task a task.

**Goal:** Trocar o safety-cap cego `take:200` de `GET /reports` por paginação numerada real (offset+total), ligando o componente `Pagination` da DS que hoje é decorativo na tela de Relatórios — fiel ao Figma.

**Architecture:** Backend Nest devolve envelope `{ items, total }` com `skip/take` num `$transaction` (itens+count consistentes). Mobile: interface `ReportsBackend.list(page,limit)` (api + mock), `ReportsProvider` com `page/total/pageCount`, e a tela liga `<Pagination>` da DS (zero bump). Escopo: **só Relatórios**, 4 por página. Notificações/Chat intocados.

**Tech Stack:** NestJS + Prisma (Postgres), class-validator/class-transformer, Jest + supertest (backend); React Native + Expo Router, Jest (mobile); `@kavicki/swi-design-system` (`Pagination`).

**Design doc:** `docs/plans/2026-07-05-swi-backend-reports-pagination-design.md`

**Branch:** `feat/backend-reports-pagination` (já criada de `main`@`8d7de89`; design doc já commitado em `64f92c2`).

**Regras do projeto:** sem rastros de IA nos commits/PR. Commit local por task autorizado (modo subagent-driven); push/PR só com luz verde. Rodar de dentro de `swi-backend/` ou `mobile/` conforme a task.

---

## Task 1: Backend — `/reports` paginado (service + DTO + controller + e2e)

**Files:**
- Modify: `swi-backend/src/reports/reports.service.ts` (método `list`)
- Modify: `swi-backend/src/reports/dto.ts` (novo `ListReportsQueryDto`)
- Modify: `swi-backend/src/reports/reports.controller.ts` (`@Query`)
- Test: `swi-backend/src/reports/reports.service.spec.ts` (reescreve o teste de `list`)
- Test: `swi-backend/test/reports.e2e-spec.ts` (envelope + casos de página)

### Step 1: Atualizar o unit spec do service (falha primeiro)

Em `reports.service.spec.ts`, o mock `prisma()` não tem `$transaction`/`count`. Substituir o helper e o teste de `list`:

```ts
const prisma = () =>
  ({
    report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    // $transaction([p1,p2]) resolve o array de PrismaPromises (forma usada em list()).
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  }) as any
```

Trocar o `it('list ordena por createdAt desc ...')` existente por estes três:

```ts
it('list pagina (skip/take), total = count, envelope {items,total} + mapeia dto', async () => {
  const db = prisma()
  db.report.findMany.mockResolvedValue([row()])
  db.report.count.mockResolvedValue(10)
  const out = await new ReportsService(db, media(), notifications()).list(2, 4)
  expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, skip: 4, take: 4 })
  expect(out.total).toBe(10)
  expect(out.items[0].images).toEqual(['signed:reports/x.jpg'])
  expect(out.items[0].creationDate).toBe('01/01/2026') // BRT (UTC-3)
  expect(out.items[0].summary).toBe('') // null → ''
})

it('list clampa limit a MAX_LIMIT e page<1 → página 1', async () => {
  const db = prisma()
  db.report.findMany.mockResolvedValue([])
  db.report.count.mockResolvedValue(0)
  await new ReportsService(db, media(), notifications()).list(0, 9999)
  expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, skip: 0, take: 50 })
})

it('list sem args → page 1, limit 4, envelope vazio', async () => {
  const db = prisma()
  db.report.findMany.mockResolvedValue([])
  db.report.count.mockResolvedValue(0)
  const out = await new ReportsService(db, media(), notifications()).list()
  expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, skip: 0, take: 4 })
  expect(out).toEqual({ items: [], total: 0 })
})
```

### Step 2: Rodar o spec e confirmar que falha

Run: `cd swi-backend && npm test -- reports.service`
Expected: FAIL (`list` ainda devolve array; `$transaction`/`count` não chamados).

### Step 3: Implementar o service

Em `reports.service.ts`, trocar a constante `LIST_CAP` e o método `list`:

```ts
const DEFAULT_LIMIT = 4
const MAX_LIMIT = 50

// ...dentro da classe:
async list(page = 1, limit = DEFAULT_LIMIT) {
  const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const currentPage = Math.max(Math.trunc(page) || 1, 1)
  const skip = (currentPage - 1) * take
  // $transaction: itens e total do MESMO snapshot (evita "total 9 mas página vazia"
  // sob create concorrente). Substitui o safety-cap cego take:200.
  const [rows, total] = await this.prisma.$transaction([
    this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
    this.prisma.report.count(),
  ])
  const items = await Promise.all(rows.map((r) => this.toDto(r)))
  return { items, total }
}
```

Remover a constante antiga `const LIST_CAP = 200`.

### Step 4: DTO de query

Em `dto.ts`, adicionar (topo: incluir imports):

```ts
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Matches } from 'class-validator'
import { Type } from 'class-transformer'

// ...após CreateReportDto:
export class ListReportsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() page?: number
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() limit?: number
}
```

(O `APP_PIPE` global tem `transform: true` → converte a query string `?page=2` em number. `whitelist: true` descarta params extras.)

### Step 5: Controller

Em `reports.controller.ts`: adicionar `Query` no import do `@nestjs/common`, importar o DTO e trocar o handler:

```ts
import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CreateReportDto, ListReportsQueryDto } from './dto'
// ...
@Get()
list(@Query() q: ListReportsQueryDto) {
  return this.reports.list(q.page, q.limit)
}
```

### Step 6: Rodar o unit spec (passa)

Run: `cd swi-backend && npm test -- reports.service`
Expected: PASS (todos os `it` de ReportsService verdes).

### Step 7: Atualizar o e2e

Em `test/reports.e2e-spec.ts`, trocar o teste `create → list newest-first` pelo bloco abaixo (o `GET /reports` agora devolve `{items,total}`) e adicionar o teste de paginação:

```ts
it('create → list paginado (envelope items+total) + get by id', async () => {
  const auth = await login()
  const { body: r1 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R1' }).expect(201)
  const { body: r2 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R2', responsibles: ['Ana'] }).expect(201)
  const { body: page1 } = await request(app.getHttpServer()).get('/reports?page=1&limit=4').set(auth).expect(200)
  expect(Array.isArray(page1.items)).toBe(true)
  expect(typeof page1.total).toBe('number')
  const i1 = page1.items.findIndex((r: any) => r.id === r1.id)
  const i2 = page1.items.findIndex((r: any) => r.id === r2.id)
  expect(i2).toBeGreaterThanOrEqual(0)
  expect(i2).toBeLessThan(i1) // R2 (mais recente) antes de R1
  const { body: one } = await request(app.getHttpServer()).get(`/reports/${r2.id}`).set(auth).expect(200)
  expect(one.title).toBe('R2')
  expect(one.responsibles).toEqual(['Ana'])
})

it('paginação: page/limit fatiam, total conta tudo, página além do fim → vazia', async () => {
  const auth = await login()
  const ids: string[] = []
  for (let i = 0; i < 5; i++) {
    const { body } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: `P${i}` }).expect(201)
    ids.push(body.id)
  }
  // Só este suite cria relatórios (inbox org-wide, mas nenhum outro suite cria Report).
  // Ordem desc por createdAt → os 5 recém-criados (P4..P0) no topo, P4 o mais novo.
  const { body: p1 } = await request(app.getHttpServer()).get('/reports?page=1&limit=4').set(auth).expect(200)
  expect(p1.items.length).toBe(4)
  expect(p1.total).toBeGreaterThanOrEqual(5)
  expect(p1.items.map((r: any) => r.title)).toEqual(['P4', 'P3', 'P2', 'P1'])
  const { body: p2 } = await request(app.getHttpServer()).get('/reports?page=2&limit=4').set(auth).expect(200)
  expect(p2.items[0].title).toBe('P0') // o 5º cai na página 2
  const { body: far } = await request(app.getHttpServer()).get('/reports?page=999&limit=4').set(auth).expect(200)
  expect(far.items).toEqual([])
  expect(far.total).toBe(p1.total)
})
```

### Step 8: Rodar o e2e (precisa do Postgres up)

Run (de `swi-backend/`, com a stack docker up + `prisma migrate deploy` já rodado 1x):
`$env:DATABASE_URL='postgresql://swi:swi@localhost:5432/swi'; npm run test:e2e -- reports`
Expected: PASS (suite reports.e2e verde, incluindo os 2 casos novos/alterados).

### Step 9: Build limpo

Run: `cd swi-backend && npm run build`
Expected: exit 0, 0 erros.

### Step 10: Commit

```bash
git add swi-backend/src/reports swi-backend/test/reports.e2e-spec.ts
git commit -m "feat(backend): /reports paginado (page/limit, envelope {items,total}, \$transaction)"
```
(Sem rodapé/coautoria de IA.)

---

## Task 2: Mobile — `ReportsBackend` paginado (types + api + mock)

**Files:**
- Modify: `mobile/services/reports/types.ts` (interface `ReportsBackend` + `ReportsPage`)
- Modify: `mobile/services/reports/apiReportsBackend.ts` (`list(page,limit)`)
- Modify: `mobile/services/reports/mockReportsBackend.ts` (`list(page,limit)` fatia)
- Test: `mobile/services/reports/apiReportsBackend.test.ts`
- Test: `mobile/services/reports/mockReportsBackend.test.ts`

### Step 1: Atualizar os testes (falham primeiro)

`apiReportsBackend.test.ts` — trocar o teste de `list`:

```ts
it('list → GET /reports?page&limit (envelope {items,total})', async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ items: [{ id: 'r1', title: 'T' }], total: 9 });
  const out = await apiReportsBackend.list(2, 4);
  expect(apiRequest).toHaveBeenCalledWith('/reports?page=2&limit=4', { auth: true });
  expect(out.total).toBe(9);
  expect(out.items[0].id).toBe('r1');
});
```

`mockReportsBackend.test.ts` — trocar `list`/`get`/`create` pelos que respeitam o envelope:

```ts
it('list pagina o store e devolve total', async () => {
  const p1 = await mockReportsBackend.list(1, 4);
  expect(p1.items.length).toBe(4);
  expect(p1.total).toBeGreaterThanOrEqual(10); // SEED_BASE tem 10
  const p2 = await mockReportsBackend.list(2, 4);
  expect(p2.items[0].id).not.toBe(p1.items[0].id); // página diferente
});
it('get retorna relatório com detalhes para id conhecido', async () => {
  const { items } = await mockReportsBackend.list(1, 4);
  const found = await mockReportsBackend.get(items[0].id);
  expect(found).not.toBeNull();
  expect((found?.details ?? '').length).toBeGreaterThan(0);
});
it('get null para id desconhecido', async () => {
  expect(await mockReportsBackend.get('inexistente')).toBeNull();
});
it('create prepende (aparece na página 1)', async () => {
  const created = await mockReportsBackend.create({ title: 'Teste', summary: 'R', details: 'D', responsibles: ['F'], imageUris: [] });
  const { items } = await mockReportsBackend.list(1, 4);
  expect(items.find((r) => r.id === created.id)).toBeTruthy();
  expect((await mockReportsBackend.get(created.id))?.title).toBe('Teste');
});
```

### Step 2: Rodar e confirmar falha

Run: `cd mobile && npm test -- reports`
Expected: FAIL (`list` ainda devolve array, sem `page`/`limit`).

### Step 3: Implementar types

Em `types.ts`, trocar a interface:

```ts
export interface ReportsPage {
  items: Report[];
  total: number;
}

export interface ReportsBackend {
  list(page: number, limit: number): Promise<ReportsPage>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
}
```

### Step 4: Implementar api backend

Em `apiReportsBackend.ts`, trocar `list` (importar `ReportsPage`):

```ts
import type { Report, ReportInput, ReportsBackend, ReportsPage } from './types';
// ...
list(page, limit) {
  return apiRequest<ReportsPage>(`/reports?page=${page}&limit=${limit}`, { auth: true });
},
```

### Step 5: Implementar mock backend

Em `mockReportsBackend.ts`, trocar `list`:

```ts
async list(page, limit) {
  await tick();
  const start = Math.max(page - 1, 0) * limit;
  const items = store.slice(start, start + limit).map((r) => ({ ...r }));
  return { items, total: store.length };
},
```

(`create` continua `store = [report, ...store]` — novo no topo → página 1.)

### Step 6: Rodar os testes (passam)

Run: `cd mobile && npm test -- reports`
Expected: PASS.

### Step 7: Commit

```bash
git add mobile/services/reports/types.ts mobile/services/reports/apiReportsBackend.ts mobile/services/reports/mockReportsBackend.ts mobile/services/reports/apiReportsBackend.test.ts mobile/services/reports/mockReportsBackend.test.ts
git commit -m "feat(mobile): ReportsBackend paginado (api query + mock slice, envelope {items,total})"
```

---

## Task 3: Mobile — Provider + tela ligam o pager numerado da DS

**Files:**
- Modify: `mobile/services/reports/ReportsProvider.tsx`
- Modify: `mobile/app/(app)/reports/index.tsx`

> Sem harness de teste de provider/tela no repo (`@testing-library/react-native` não instalado). Verificação = `tsc` + `expo export web` + os testes de backend/mock da Task 2. **Não introduzir novo harness (YAGNI).**

### Step 1: Provider com estado de paginação

Reescrever `ReportsProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Report, ReportInput } from './types';
import { getReportsBackend } from './getReportsBackend';

const LIMIT = 4; // Relatórios por página. Demo (10 mock) → 3 páginas, bate com o Figma.

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface ReportsState {
  reports: Report[];
  page: number;
  pageCount: number;
  total: number;
  status: LoadStatus;
  load: (page?: number) => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  create: (input: ReportInput) => Promise<Report>;
}
const ReportsContext = createContext<ReportsState | null>(null);

export function ReportsProvider({ children }: PropsWithChildren) {
  const [reports, setReports] = useState<Report[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const backend = useMemo(() => getReportsBackend(), []);

  const load = useCallback(async (p = 1) => {
    // Troca de página NÃO pisca a tela inteira: só a 1ª carga (idle) vira 'loading'.
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const { items, total } = await backend.list(p, LIMIT);
      setReports(items);
      setTotal(total);
      setPage(p);
      setStatus(total === 0 ? 'empty' : 'ready');
    } catch {
      setStatus('error');
    }
  }, [backend]);

  const loadOne = useCallback((id: string) => backend.get(id), [backend]);
  const create = useCallback(async (input: ReportInput) => {
    const created = await backend.create(input);
    await load(1); // novo é o mais recente (ordem desc) → volta pra página 1
    return created;
  }, [backend, load]);

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const value = useMemo<ReportsState>(
    () => ({ reports, page, pageCount, total, status, load, loadOne, create }),
    [reports, page, pageCount, total, status, load, loadOne, create],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
```

### Step 2: Tela liga o `<Pagination>` real

Em `app/(app)/reports/index.tsx`:

1. Remover o estado decorativo: apagar `const [currentPage, setCurrentPage] = useState(1);`.
2. Puxar do provider: `const { reports, status, load, page, pageCount } = useReports();`.
3. `useEffect` inicial (troca `load` sem arg por `load(1)`):
   ```tsx
   useEffect(() => {
     if (status === 'idle') load(1);
   }, [status, load]);
   ```
4. `onRetry` do estado de erro → `onRetry={() => load(page)}` (retenta a página atual).
5. Trocar o `<Pagination>` decorativo por (dentro do `<ScrollView>`, no lugar do atual):
   ```tsx
   {/* Pager numerado — Figma 461:10196. currentPage/pageCount reais do provider;
       onPageChange recarrega a página. Escondido quando só há 1 página (um pager
       de 1 página é ruído). Clamp Math.min(...,pageCount) neutraliza o overflow do
       chevron "→" na última página. */}
   {pageCount > 1 && (
     <Pagination
       currentPage={page}
       pageCount={pageCount}
       onPageChange={(p) => load(Math.min(Math.max(p, 1), pageCount))}
     />
   )}
   ```
   (O `import { Pagination }` da DS já está no arquivo.)

### Step 3: Typecheck

Run: `cd mobile && npx tsc --noEmit`
Expected: 8 erros de baseline (pré-existentes, não relacionados), **0 novos**.

### Step 4: Export web (smoke de bundling)

Run: `cd mobile && npx expo export --platform web`
Expected: exit 0.

### Step 5: Suite de reports do jest (regressão)

Run: `cd mobile && npm test -- reports`
Expected: PASS (nada quebrou).

### Step 6: Commit

```bash
git add mobile/services/reports/ReportsProvider.tsx "mobile/app/(app)/reports/index.tsx"
git commit -m "feat(mobile): ReportsProvider + tela ligam o pager numerado da DS"
```

---

## Verificação de integração (controller — após as 3 tasks)

Feita por mim (controller), não por implementer:

1. **Docker smoke real** (stack up, imagem rebuildada — roda o branch checado out):
   - `cd swi-backend && docker compose up --build -d api` (rebuild obrigatório).
   - Login do worker seedado; criar **6 relatórios** via `POST /reports`.
   - `GET /reports?page=1&limit=4` → `items.length === 4`, `total >= 6`, newest-first.
   - `GET /reports?page=2&limit=4` → os 2 restantes.
   - `GET /reports?page=99&limit=4` → `items: []`, `total` estável.
   - `GET /reports?limit=9999` → `items.length <= 50` (MAX_LIMIT segura).
   - Smoke throwaway em `<scratchpad>/smoke-reports-pagination.mjs` (node .mjs, fetch global).
2. **Suite completa**: backend `npm test` (unit) + `npm run test:e2e` (e2e) verdes; mobile `npm test` + `tsc` (8 baseline) + `expo export web`.
3. **Review holística** (superpowers:code-reviewer ou typescript/database reviewer) sobre o diff acumulado; fechar Minors por commit focado.
4. **PR**: push da branch + corpo em `<scratchpad>/pr-body-reports-pagination.md`; o usuário abre/mergeia pela URL `pull/new/feat/backend-reports-pagination`. **Sem rastros de IA.**

**Verde esperado final:** backend build 0 / unit (+3 casos reports.service) / e2e (+1 caso paginação, 1 alterado); mobile tsc 8 baseline (0 novos) / jest (specs reports atualizados) / expo export web 0; docker smoke real das 4 bordas de página.

---

## Notas de execução

- **Ordem:** Task 1 → 2 → 3 (2 depende do contrato do 1; 3 depende dos backends do 2). Sequencial.
- **Rodar comandos do diretório certo:** backend de `swi-backend/`, mobile de `mobile/`. `git` de fora: `git -C <repo-root>`.
- **e2e precisa do Postgres up** + `prisma migrate deploy` (1x). Sem schema novo nesta fatia → nenhuma migration nova.
- **Fora de escopo (não tocar):** `SearchInput` (continua decorativo), Notificações, Chat, DS.
