# Fatia 0 — Fundação (schema + flag) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fundar a rodada não-saúde: schema Prisma completo dos domínios (migration única), flag `DATA_BACKEND` env-driven (`'mock'|'api'`) e rename do valor `'amplify'`→`'api'` com selectors pinados em mock até cada fatia ligar o seu.

**Architecture:** Ver `docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md`. Nada de módulo Nest novo nesta fatia — só schema/migration no backend e a mecânica de flag no mobile. Selectors não-saúde ficam `return mockXBackend` com comentário "fatia N liga"; vitals/telemetry ficam pinados PARA SEMPRE (carve-out smartband). `configureAmplify` morre (comparação `!== 'amplify'` viraria TS2367 após o rename).

**Tech Stack:** Prisma/Postgres (backend), Expo/React Native + Jest (mobile). Sem dependência nova.

**Branch:** `feat/backend-fundacao` a partir de `feat/backend-qa-auth-build` (stacked no PR #22; se o PR mergear antes, rebase trivial em `feat/mobile-login`).

**Baselines de verificação:** mobile jest **112**, tsc **8 erros baseline** (0 novos), expo export web exit 0; backend unit **20**, e2e **2**, build ok. Docker smoke obrigatório no fim (lição: tsc/jest verdes não provam o container).

---

### Task 1: Branch + teste falhando do `DATA_BACKEND` env-driven

**Files:**
- Test: `mobile/lib/featureFlags.test.ts` (novo)

**Step 1: Criar a branch**

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git checkout -b feat/backend-fundacao feat/backend-qa-auth-build
```

**Step 2: Escrever o teste falhando**

`mobile/lib/featureFlags.test.ts` (novo — espelha o padrão env+isolateModules; house style: sem `;` extra, aspas simples, nomes em pt-BR):

```ts
const ENV_KEY = 'EXPO_PUBLIC_DATA_BACKEND';

function loadFeatureFlags(envValue?: string) {
  jest.resetModules();
  if (envValue === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envValue;
  return require('./featureFlags') as typeof import('./featureFlags');
}

describe('DATA_BACKEND', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
    jest.resetModules();
  });

  it('default é mock quando o env não está setado', () => {
    expect(loadFeatureFlags(undefined).DATA_BACKEND).toBe('mock');
  });

  it('lê api do EXPO_PUBLIC_DATA_BACKEND', () => {
    expect(loadFeatureFlags('api').DATA_BACKEND).toBe('api');
  });
});
```

**Step 3: Rodar e ver falhar**

Run: `cd mobile && npx jest lib/featureFlags.test.ts`
Expected: FAIL — `expected 'api', received 'mock'` (DATA_BACKEND é const hardcoded).
Contingência: se o require do featureFlags real quebrar no jest (expo-constants), verificar que o preset jest-expo está ativo — os demais testes do repo rodam com ele; não mockar o módulo inteiro (o alvo do teste é o env-read real).

**Step 4: NÃO implementar ainda** — a implementação vem na Task 2 (o rename do tipo é atômico com os selectors; ver Architecture). Sem commit aqui.

---

### Task 2: Rename atômico `'amplify'`→`'api'` + pinning dos selectors (deixa tudo verde)

Uma unidade atômica (precedente: branch B renomeou o seam inteiro num commit) — o rename do tipo quebra compile de 9 selectors + configure; este task restaura o verde.

**Files:**
- Modify: `mobile/lib/featureFlags.ts:44-58` (bloco DATA_BACKEND)
- Delete: `mobile/services/amplify/configure.ts`
- Modify: `mobile/app/_layout.tsx:29,32` (remover import + chamada de `configureAmplify`)
- Modify (pin "até a fatia N ligar"): `mobile/services/{profile,reports,journey,chat,notifications,weather,evacuation}/get*Backend.ts`
- Modify (pin PERMANENTE, carve-out smartband): `mobile/services/vitals/getVitalsBackend.ts`, `mobile/services/telemetry/getTelemetrySink.ts`
- Modify: os `get*Backend.test.ts` correspondentes (asserção nova: pinado em mock)
- Intocados: `services/auth/*` (seam AUTH_BACKEND próprio), `amplify*Backend.ts` de cada domínio (morrem por fatia), `swi-backend/amplify/` (referência read-only)

**Step 1: featureFlags.ts — tipo + env-read**

Substituir o bloco `DataBackendKind`/`DATA_BACKEND` (linhas 44-50) por:

```ts
// Seleciona a fonte de dados dos domínios NÃO-SAÚDE (profile, reports, journey,
// chat, notifications, weather, evacuation). 'mock' = demo in-memory (default).
// 'api' = backend real conteinerizado (NestJS) — cada selector só honra 'api'
// quando a fatia do seu domínio migra (até lá fica pinado em mock). Saúde
// (vitals/telemetry) IGNORA esta flag até a smartband existir.
// Setada no build/dev via EXPO_PUBLIC_DATA_BACKEND.
export type DataBackendKind = 'mock' | 'api';
export const DATA_BACKEND: DataBackendKind =
  (process.env.EXPO_PUBLIC_DATA_BACKEND as DataBackendKind) ?? 'mock';
```

**Step 2: matar `configureAmplify`**

- Deletar `mobile/services/amplify/configure.ts`.
- Em `mobile/app/_layout.tsx`: remover a linha 29 (`import { configureAmplify } ...`) e a linha 32 (`configureAmplify();`).

**Step 3: pinar os 7 selectors não-saúde**

Padrão (exemplo `mobile/services/reports/getReportsBackend.ts`; replicar em profile, journey, chat, notifications, weather, evacuation — ajustando nomes):

```ts
import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';

// Pinado em mock até a fatia Relatórios ligar o apiReportsBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getReportsBackend(): ReportsBackend {
  return mockReportsBackend;
}
```

**Step 4: pinar os 2 selectors de saúde (permanente)**

`getVitalsBackend.ts` e `getTelemetrySink.ts` — mesmo shape, comentário diferente:

```ts
// SAÚDE: pinado em mock ATÉ A SMARTBAND EXISTIR (decisão 2026-06-22/2026-07-02);
// ignora DATA_BACKEND de propósito — não ligar na rodada não-saúde.
```

**Step 5: atualizar os testes dos selectors**

Cada `get*Backend.test.ts` que hoje faz doMock com `DATA_BACKEND: 'amplify'` passa a assertar o pin (exemplo reports; replicar):

```ts
function loadWith(dataBackend: string) {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, AUTH_BACKEND: 'mock' }));
  const { getReportsBackend } = require('./getReportsBackend');
  const { mockReportsBackend } = require('./mockReportsBackend');
  return { getReportsBackend, mockReportsBackend };
}

it('retorna mock com a flag em mock', () => {
  const { getReportsBackend, mockReportsBackend } = loadWith('mock');
  expect(getReportsBackend()).toBe(mockReportsBackend);
});

it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
  const { getReportsBackend, mockReportsBackend } = loadWith('api');
  expect(getReportsBackend()).toBe(mockReportsBackend);
});
```

Nos de saúde, o segundo teste ganha o nome `'ignora a flag pra sempre (carve-out smartband)'`.

**Step 6: rodar tudo e ver verde**

```bash
cd mobile && npx tsc --noEmit ; npx jest
```
Expected: tsc **8 erros baseline (0 novos)**; jest **123** (112 baseline + 2 do featureFlags.test + 9 casos novos — cada selector test vai de 1 pra 2 casos). Se falhar TS2367 em algum arquivo, tem comparação `'amplify'` esquecida — ver Step 7.

**Step 7: grep definitivo (lição da branch B — jest/tsc NÃO pegam chave velha em factory `jest.mock`)**

```bash
git grep -n "'amplify'" -- mobile/
```
Expected: **vazio** (nomes de arquivo `amplify*Backend.ts` não são valor de string; comentários renomeados junto).

**Step 8: Commit (com luz verde do usuário)**

```bash
git add mobile/lib/featureFlags.ts mobile/lib/featureFlags.test.ts "mobile/app/_layout.tsx" mobile/services/
git rm mobile/services/amplify/configure.ts
git commit -m "feat(mobile): DATA_BACKEND env-driven ('mock'|'api') + selectors pinados em mock ate cada fatia migrar"
```

---

### Task 3: Schema Prisma dos domínios não-saúde (migration única)

**Files:**
- Modify: `swi-backend/prisma/schema.prisma` (User ganha back-relations; enums + 6 models novos)

**Step 1: adicionar enums + models**

Acrescentar ao `schema.prisma` (shape-fonte: `swi-backend/amplify/data/resource.ts`, adaptado a SQL relacional — FKs pra `User` no lugar de Cognito subs; `Contact` do Amplify morre, diretório = query sobre Users; saúde NÃO entra):

```prisma
enum ReportStatus { accept pending canceled info }
enum JourneyState { idle ongoing paused }
enum TaskStatus { pending in_progress paused done }
enum NotificationDomain { weather chat reports journey faq }

model Profile {
  id           String    @id @default(uuid())
  userId       String    @unique
  user         User      @relation(fields: [userId], references: [id])
  fullName     String?
  phone        String?
  cpf          String?
  birthDate    DateTime? @db.Date
  cep          String?
  street       String?
  number       String?
  complement   String?
  neighborhood String?
  city         String?
  uf           String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Report {
  id              String       @id @default(uuid())
  authorId        String
  author          User         @relation(fields: [authorId], references: [id])
  title           String
  summary         String?
  status          ReportStatus @default(pending)
  statusLabel     String?
  authorName      String?      // snapshot denorm — card do inbox sem join (paridade com o mock)
  authorAvatarKey String?
  creationDate    DateTime     @default(now())
  sector          String?
  responsibles    String[]
  details         String?
  imageKeys       String[]
  activities      Json?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}

model Journey {
  id                 String       @id @default(uuid())
  workerId           String
  worker             User         @relation(fields: [workerId], references: [id])
  date               DateTime     @db.Date
  state              JourneyState @default(idle)
  activeTaskId       String?
  startedAt          DateTime?
  accumulatedSeconds Int          @default(0)
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  @@unique([workerId, date]) // turno por worker/dia
}

model Task {
  id                   String     @id @default(uuid())
  assignedTo           String
  assignee             User       @relation(fields: [assignedTo], references: [id])
  title                String
  description          String?
  objective            String?
  estimatedMinutes     Int?
  status               TaskStatus @default(pending)
  startedAt            DateTime?
  accumulatedSeconds   Int        @default(0)
  progressPct          Float?
  scheduledDate        DateTime?  @db.Date
  imageKeys            String[]
  interestedCount      Int?
  interestedAvatarKeys String[]
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt
}

model Conversation {
  id                    String    @id // determinístico: [a,b].sort().join('#') — contrato do client (fatia Chat)
  participants          String[]  // 2 user ids
  participantNames      String[]  // snapshots denorm paralelos (paridade com o mock; fatia Chat pode simplificar)
  participantSubtitles  String[]
  participantAvatarKeys String[]
  lastMessageBody       String?
  lastMessageAt         DateTime?
  unreadByJson          Json?     // { [userId]: count } — unread por-viewer
  messages              Message[]
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  senderId       String
  sender         User         @relation(fields: [senderId], references: [id])
  body           String?
  imageKey       String?
  sentAt         DateTime
  createdAt      DateTime     @default(now())

  @@index([conversationId, sentAt])
}

model Notification {
  id        String             @id @default(uuid())
  workerId  String
  worker    User               @relation(fields: [workerId], references: [id])
  title     String
  body      String?
  domain    NotificationDomain
  targetId  String?
  read      Boolean            @default(false)
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  @@index([workerId, createdAt])
}
```

Nota de decisão: `Message.participants` do Amplify morre — num DB relacional o servidor checa membership via `conversation.participants` (era denorm exigida pelo `ownersDefinedIn` do AppSync).

Nota da execução (quality review): o schema real ganhou além do snippet acima — `Profile.sector/jobTitle/avatarKey` (casa dos campos de exibição do Contact morto; fonte canônica dos snapshots denorm e do diretório do chat) e `@@index([assignedTo, scheduledDate])` no `Task` (tela "Hoje" da fatia Jornada). O `schema.prisma` é a fonte de verdade.

**Step 2: User ganha as back-relations**

No model `User` existente, acrescentar (Prisma exige os dois lados):

```prisma
  profile       Profile?
  reports       Report[]
  journeys      Journey[]
  tasks         Task[]
  messages      Message[]
  notifications Notification[]
```

**Step 3: validar + migrar (db do compose de pé)**

```bash
cd swi-backend
npx prisma validate
docker compose up -d db
npx prisma migrate dev --name non_health_domains_foundation
npx prisma generate
```
Expected: validate OK; migration criada em `prisma/migrations/*_non_health_domains_foundation/` e aplicada; generate OK.

**Step 4: regressão backend**

```bash
npm run build ; npm test ; npm run test:e2e
```
Expected: build exit 0 · unit **20** · e2e **2** (schema é aditivo; nada consome os models novos ainda).

**Step 5: Commit (com luz verde)**

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git add swi-backend/prisma/
git commit -m "feat(backend): schema fundacional dos dominios nao-saude (migration unica)"
```

---

### Task 4: Docker smoke + verificação final do tripé

**Step 1: smoke do container (migrate deploy roda no boot da api)**

```bash
cd swi-backend && docker compose up --build -d
curl -s localhost:3000/health
docker compose exec db psql -U swi -d swi -c '\dt'
```
Expected: health `{"status":"ok"}`; `\dt` lista `Profile, Report, Journey, Task, Conversation, Message, Notification` (+ User e `_prisma_migrations`).

**Step 2: login smoke (nada regrediu no auth)**

```bash
curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}'
```
Expected: `200`.

**Step 3: tripé mobile**

```bash
cd mobile && npx tsc --noEmit ; npx jest ; npx expo export --platform web
```
Expected: 8 erros baseline (0 novos) · jest 123 · export exit 0.

**Step 4: Push + PR (com luz verde)**

```bash
git push -u origin feat/backend-fundacao
```
PR base: `feat/backend-qa-auth-build` (stacked) ou `feat/mobile-login` se o PR #22 já tiver mergeado.

---

## Fora do escopo desta fatia (YAGNI)

- Módulos Nest dos domínios (fatias 1-7) · MinIO (fatia 2) · WebSocket (fatia 4).
- `EXPO_PUBLIC_DATA_BACKEND=api` no perfil `qa` do eas.json — só na última fatia (QA final).
- Deletar `amplify*Backend.ts`/`swi-backend/amplify/` — morrem por fatia / no fim da rodada.
- Seeds de dados de domínio (tasks, conversas) — cada fatia seeda o seu.
