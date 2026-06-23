# SWI Backend — Fatia Relatórios

> Doc **temporário** (deletar quando o backend inteiro estiver pronto).
> Primeira fatia do roadmap pós-pivô — ver `2026-06-22-swi-backend-roadmap-design.md`.
> Branch: `feat/backend-reports` (stacked em `feat/mobile-login`).

## Escopo

Backend real dos **relatórios** no app do worker (mobile): listar, ver detalhe e
criar (com fotos). Modelo no `swi-backend`, Abordagem A (mock+amplify atrás de
flag, `tsc`+`jest` verdes, deploy-gated). Wiring do swi-admin fica pro hardening.

## Decisões (travadas com o usuário 2026-06-22)

1. **Visibilidade = leitura compartilhada.** Todo worker autenticado lê todos os
   relatórios; cria os próprios; admin gerencia. Bate com o Figma do mobile
   (lista multi-autor).
2. **Mídia via S3 nesta fatia** (Amplify Storage). Caminho amplify sobe fotos e
   guarda keys; caminho mock segue com URIs locais.
3. **Activities = campo `json`** embutido no `Report` (não model separado) — fiel
   ao demo, custo mínimo, sem join.
4. **Responsibles = `string[]`** de nomes (como o dado de hoje).
5. **Comentários** do `[id]` (input hoje é no-op) e **revisão/mudança de status
   pelo worker** ficam **fora** desta fatia (entram com Chat/colaboração e com a
   ferramenta de admin, respectivamente).

## Modelo (`swi-backend/amplify/data/resource.ts`)

Fonte de verdade do shape = o `Report` do swi-admin (`src/services/mockApi/reports.ts`).

```
Report
  title         string (required)
  summary       string
  status        enum ['accept','pending','canceled','info']
  statusLabel   string            // estágio textual; independente do enum de cor
  authorName    string
  authorAvatarKey string           // S3 key (ou uri no mock)
  creationDate  datetime
  sector        string
  responsibles  string[]           // nomes
  details       string
  imageKeys     string[]           // S3 keys das fotos (uris no mock)
  activities    json               // [{ id,title,sector,progress(0-100),tone:'success'|'warning'|'error',avatars:string[],overflowCount? }]

  auth:
    allow.authenticated().to(['read'])
    allow.owner().to(['create','read'])     // 'owner' = author (Cognito sub)
    allow.group('admin')                    // CRUD
```

Notas:
- `status` (enum de cor: accept=verde, pending=amarelo, canceled=vermelho, info)
  e `statusLabel` ("Concluído"/"Em Revisão"/...) são **eixos independentes** no
  dado atual — por isso ambos são guardados.
- `activities` como `a.json()` evita um segundo model + join (YAGNI pro demo).

## Storage S3 (`swi-backend/amplify/storage/resource.ts` — novo)

- `defineStorage` com prefixo `reports/{entity_id}/*` (ou `reports/*` guarded por
  auth) pra anexos. Acesso: authenticated read; owner write. Registrar em
  `amplify/backend.ts`.
- Amplify path: `uploadData` → guarda a key em `imageKeys`; na leitura resolve
  url via `getUrl`. Mock path: ignora S3, usa URIs locais do `expo-image-picker`.

## Service mobile (`mobile/services/reports/`) — espelha `profile/`

- `types.ts` → `Report`, `ReportActivity`, `ReportInput`, e
  `ReportsBackend { list(): Promise<Report[]>; get(id): Promise<Report|null>; create(input: ReportInput): Promise<Report> }`
- `mockReportsBackend.ts` — arrays de hoje (migrados de `reports/index.tsx` +
  `[id].tsx`) + `create` em memória; mídia = URIs locais.
- `amplifyReportsBackend.ts` — `generateClient<Schema>()` (Data) + Storage
  (`uploadData`/`getUrl`); mapeia model ↔ `Report`.
- `getReportsBackend.ts` — selector pela flag `AUTH_BACKEND` (mock|amplify),
  igual `getProfileBackend`.
- `ReportsProvider.tsx` + `useReports()` — estado `{ reports, status, load(),
  loadOne(id), create(input) }` com máquina loading/ready/empty/error.
- Testes: `getReportsBackend.test.ts`, `mockReportsBackend.test.ts`.
- Provider montado em `mobile/app/_layout.tsx` junto aos outros.

## Wiring das telas

- `reports/index.tsx` — troca o array `REPORTS` por `useReports().load()`; render
  loading/empty/error; mantém search + pagination locais.
- `reports/new.tsx` — `create(input)`: sobe anexos (amplify→S3 / mock→local),
  cria o Report, limpa `responsiblesSelection`, volta e dá refresh na lista.
- `reports/[id].tsx` — troca `REPORTS`/`DETAIL_TEXT`/`ACTIVITIES` por
  `useReports().loadOne(id)`; render loading/empty/error.

## Estados production-ready (igual Fatia 3)

- **loading** — placeholder enquanto busca.
- **empty** — "nenhum relatório ainda" (lista vazia).
- **error** — mensagem + retry (falha de rede/backend).
- Compostos com o DS; sem inventar componente (regra DS).

## Flag

Reuso `AUTH_BACKEND` (`mock`|`amplify`) como switch global mock/amplify (já liga
auth+profile). Generalizar o nome → switch único no hardening (roadmap, fatia 7).

## Não-objetivos da fatia

- Wiring do swi-admin (mockApi → Amplify) — hardening.
- Comentários, revisão/aprovação de relatório pelo worker.
- Deploy de produção (sem conta AWS).
- Edição/exclusão de relatório pelo worker (só create+read no worker).

## Verificação (deploy-gated)

- `swi-backend`: `npx tsc --noEmit -p amplify` exit 0.
- `mobile`: `npx jest` (novos testes verdes), `npx tsc --noEmit` sem erros novos
  (8 pré-existentes são baseline), `npx expo export --platform web` exit 0.
- Smoke visual dos estados (loading/empty/error) via flag — eyeball pendente até
  rodar `expo start` (igual Fatia 3).

## Próximo passo

`writing-plans` → `2026-06-22-swi-backend-reports-plan.md` (fases + verificação),
depois implementação subagent-driven com two-gate review (igual Fatias 1/3).
