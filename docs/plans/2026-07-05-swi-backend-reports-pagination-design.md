# Design — Relatórios com paginação numerada real

**Data:** 2026-07-05
**Branch alvo:** `feat/backend-reports-pagination` (backend + mobile, coordenada)
**Origem:** `main`@`8d7de89` (pós PR #37 fan-out)
**Tipo:** último "diferido pós-H3" — substitui o safety-cap cego `take:200` de Relatórios
por paginação de verdade, guiada pela fidelidade ao Figma.

---

## 1. Contexto e motivação

Na fase de hardening (H3b) toda lista do backend ganhou um corte cego `take:200`
(safety-cap) pra evitar payload ilimitado. Acima de 200 itens o resto some sem aviso.
No piloto (10–50 workers) nenhuma lista chega perto disso — então não quebra nada
hoje. Este é o **último item de backend "pela metade"**: trocar o corte cego de
Relatórios por paginação real.

O item tinha sido anotado meses atrás como "cursor pagination / scroll infinito com
envelope `{items,nextCursor}`". **Essa ideia foi descartada** — ver §2.

## 2. Descoberta do Figma (fonte da verdade)

Regra do projeto: o objetivo é ser o mais fiel ao Figma possível. A confirmação no
arquivo `SWI - UI` (`fileKey bzDUuPdSiKgl5xucBH0IYE`) decidiu a mecânica:

| Tela | Figma | Mecânica exigida |
|---|---|---|
| **Relatórios** (`364:18596`) | Pager **numerado** real: OutlineButtons `1 2 3 …` + chevron "próxima" (nó `461:10196`, variante `property1="begin"`) | **Páginas numeradas** → backend com `offset + total` |
| Notificações (`401:30469`) | Só lista rolável, **sem pager** | Nada visível — scroll simples |
| Chat (inbox/thread) | Só lista rolável, **sem pager** | Nada visível — scroll simples |

Dois achados que simplificam tudo:

1. **A DS `Pagination` já está pronta.** `PaginationProps` expõe `currentPage`,
   `pageCount`, `onPageChange`, `onOverflowPress`. Hoje a tela de Relatórios renderiza
   o componente mas **decorativo** — não passa `pageCount` (default 4) e o
   `onPageChange` só mexe num `useState` local ligado a nada. **Zero DS bump.**
2. **Cursor/scroll-infinito não bate com pager numerado.** Cursor é forward-only
   (`nextCursor`), não sabe "página N de M" nem total. O Figma manda numerado →
   **offset-based**. A fidelidade ao Figma mudou a abordagem técnica antes de escrever
   qualquer código.

## 3. Escopo (decisão do usuário)

- **Só Relatórios.** É a única tela onde o app hoje **diverge visivelmente** do Figma
  (pager morto). Notificações e Chat não têm pager no Figma → ficam como estão; o
  cap de 200 é invisível e seguro no piloto.
- **4 relatórios por página.** No modo demo (mock, 10 relatórios) isso dá 3 páginas
  (`1 2 3`), batendo com o pager multi-número do Figma. Constante de uma linha,
  tunável.
- **Busca fora de escopo.** O `SearchInput` continua como está (já é decorativo hoje;
  busca server-side é outra fatia). Não misturar.
- **Notificações e Chat intocados.**

Estado das duas fontes de dados de Relatórios (importa pro visual):
- **API path** (backend real): a lista **começa vazia** — não há seed de relatórios; eles
  nascem quando um worker cria. Pager só aparece quando passar de 4 relatórios reais.
- **Mock/demo path** (fidelidade Figma): **10 relatórios** fixos (`SEED_BASE`) → 3 páginas.

## 4. Contrato do backend (a mudança "quebrante")

```
hoje:  GET /reports                    → Report[]
novo:  GET /reports?page=1&limit=4     → { items: Report[]; total: number }
```

- Só o `apiReportsBackend` do mobile consome `/reports` (o admin ainda usa mockApi,
  integração é deploy futuro). Logo os dois lados mudam **na mesma branch**
  `feat/backend-reports-pagination` — permitido pela regra de branch (`feat/backend-*`
  pode tocar mobile).
- `page` default `1`, `limit` default `4`. Ambos validados (inteiro ≥ 1; `limit`
  com teto — ver §5). `total` = contagem total (não da página), pra o cliente
  computar `pageCount = ceil(total / limit)`.
- Envelope minimalista **`{ items, total }`**: o cliente já conhece `page`/`limit`
  (ele enviou), então não precisam voltar.

## 5. Design do backend (`swi-backend/src/reports/`)

**`ReportsService.list(page, limit)`** substitui `list()`:
```ts
async list(page = 1, limit = DEFAULT_LIMIT): Promise<{ items: ReportDto[]; total: number }> {
  const take = Math.min(Math.max(limit, 1), MAX_LIMIT)   // clamp defensivo
  const skip = Math.max(page - 1, 0) * take
  const [rows, total] = await this.prisma.$transaction([
    this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
    this.prisma.report.count(),
  ])
  return { items: await Promise.all(rows.map((r) => this.toDto(r))), total }
}
```
- `findMany` + `count` num **`$transaction`** (leitura consistente: itens e total do
  mesmo snapshot — evita "total 9, mas página 3 vazia" sob create concorrente).
- `MAX_LIMIT` (ex.: 50) preserva o espírito do safety-cap (nunca serve payload
  gigante mesmo se o cliente pedir `limit=99999`). O `LIST_CAP=200` cego sai.
- `toDto`/ordenação/`create` **inalterados**.

**`ReportsController`** — query params tipados + validados:
```ts
@Get()
list(@Query() q: ListReportsQueryDto) {
  return this.reports.list(q.page, q.limit)
}
```
`ListReportsQueryDto`: `@Type(() => Number) @IsInt() @IsPositive() @IsOptional() page/limit`
(o `APP_PIPE` global com `transform: true` já converte string→number). Sem params →
defaults do service.

## 6. Design do mobile (`mobile/services/reports/` + tela)

**Interface `ReportsBackend`** (types.ts) — `list` muda de shape:
```ts
export interface ReportsPage { items: Report[]; total: number }
export interface ReportsBackend {
  list(page: number, limit: number): Promise<ReportsPage>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
}
```

- **`apiReportsBackend.list`** → `apiRequest<ReportsPage>('/reports?page=${page}&limit=${limit}')`.
- **`mockReportsBackend.list`** → fatia o `store` em memória: `{ items: store.slice(skip, skip+limit), total: store.length }`. `create` continua `unshift` no `store` (novo no topo).
- **`ReportsProvider`** ganha estado de paginação:
  - `reports: Report[]` (itens da **página atual**), `page`, `total`, `status`.
  - `load(page = 1)` busca `backend.list(page, LIMIT)`, seta `reports`/`page`/`total`;
    `status` = `empty` se `total === 0`, senão `ready`.
  - `pageCount` derivado = `Math.max(1, Math.ceil(total / LIMIT))`.
  - `create(input)`: cria → **volta pra página 1** (`load(1)`) pra o novo relatório
    (ordem desc) aparecer no topo. (Alternativa `unshift` local quebra a contagem da
    página; recarregar a p.1 é simples e correto.)

**Tela `app/(app)/reports/index.tsx`** — layout do Figma **intocado**; só a fonte muda:
- `<Pagination currentPage={page} pageCount={pageCount} onPageChange={(p) => load(p)} />`
  (substitui o `useState` local decorativo).
- **Pager escondido quando `pageCount <= 1`** (API com poucos relatórios → sem pager;
  demo com 3 páginas → pager visível). Decisão de UX: um pager de 1 página é ruído.
- Trocar de página mostra o estado de loading da própria área (ou mantém os cards e
  troca — decisão de refino na implementação; sem flash desnecessário).
- `useEffect` inicial: `if (status === 'idle') load(1)`.

## 7. Bordas e erros

- **Página fora do range** (ex.: estava na p.3, relatórios sumiram): o service devolve
  `items: []` com `total` menor; o provider re-clampa `page` a `pageCount` e recarrega
  se necessário. Nunca 5xx.
- **Lista vazia** (`total === 0`): estado `empty` existente (`ReportsListState kind="empty"`).
- **Erro de rede**: estado `error` existente com retry (`load(page)`).
- Mantém os estados loading/empty/error atuais — **zero regressão de UX**.

## 8. Testes (TDD — escritos antes do código)

**Backend:**
- `reports.service.spec.ts`: `list(page,limit)` fatia certo (skip/take), `total` = count,
  clamp de `limit` a `MAX_LIMIT`, `page<1`→página 1, `$transaction` chamada.
- `reports.e2e`: criar N > limit relatórios → `GET /reports?page=1&limit=4` devolve 4 itens
  + `total=N`; página 2 devolve os próximos; página além do fim → `items:[]`, `total=N`;
  sem params → defaults.

**Mobile:**
- `mockReportsBackend.test.ts`: fatiamento + `total`; `create` volta no slice da p.1.
- `apiReportsBackend.test.ts`: monta a query `?page=&limit=`, parseia o envelope.
- `ReportsProvider` (novo/estendido): `pageCount` derivado, `load(p)` troca a página,
  `create` recarrega p.1.

## 9. Execução (mesmo esquema das 12 fatias)

Subagent-driven: implementer + **two-gate spec+quality** por task, **docker smoke real**
(criar >4 relatórios via API → paginar → conferir `total`/itens/página vazia), **review
holística**, branch pushada. O usuário abre/mergeia o PR pela URL (API de PR bloqueada
por auth). **Sem rastros de IA.** Commit local por task autorizado no modo
subagent-driven; push/PR só com luz verde.

Verde esperado: backend build 0 / unit (novos casos de paginação) / e2e (+casos);
mobile tsc 8 baseline (0 novos) / jest (specs atualizados) / expo export web 0.

## 10. Decisões travadas

1. **Só Relatórios** (única divergência visível do Figma).
2. **Numerado/offset**, não cursor (Figma manda pager numerado).
3. **4 por página** (demo 10 → 3 páginas, bate com o Figma).
4. **Envelope `{items, total}`** substitui `Report[]` (quebrante, backend+mobile juntos).
5. **`$transaction`** pra itens+total consistentes.
6. **`MAX_LIMIT`** preserva o espírito do safety-cap; `LIST_CAP=200` cego sai.
7. **Pager escondido com 1 página**; **`create` → volta pra p.1**.
8. **Busca continua decorativa** (fora de escopo).

## 11. Fora de escopo / follow-ups

- **Busca server-side** de relatórios (o `SearchInput` de verdade) — fatia própria.
- **Paginação de Notificações/Chat** — sem pager no Figma; cap de 200 cobre o piloto;
  se um dia crescer, scroll-infinito invisível (backend-only).
- **Windowing do pager** (páginas 5,6,7 quando há muitas) — a DS renderiza `1..pageCount`
  linear; pro piloto (poucas páginas) é suficiente. Janela deslizante = bump de DS futuro.
