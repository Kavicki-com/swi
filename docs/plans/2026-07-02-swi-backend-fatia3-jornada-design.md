# SWI Backend — Fatia 3: Jornada / Tarefas (design)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Fatia 3 da rodada dos domínios não-saúde
> (`2026-07-02-swi-backend-dominios-nao-saude-design.md`). Sucede as fatias 0
> (Fundação, PR #23), 1 (Perfil, PR #25) e 2 (Relatórios + MinIO, PR #26).
> O **seam mobile** consumido aqui nasceu do design Amplify-era
> `2026-06-23-swi-backend-jornada-design.md` (mock+amplify atrás de flag); esta
> fatia é o **contraponto backend real** (NestJS/Prisma/MinIO REST), trocando o
> stub amplify por `apiJourneyBackend` — mesma relação que a Fatia 2 teve com o
> design de Relatórios da era mobile-seam.

## Contexto

Os models `Journey` e `Task` já existem (Fatia 0). O seam mobile de Jornada já
está pronto da era Amplify: `JourneyBackend` (8 métodos), `JourneyProvider`,
telas da jornada/tarefas, matemática pura de tempo em `progress.ts`, e
`getJourneyBackend` **pinado em mock** (ignora `DATA_BACKEND`). A infra de mídia
(MinIO + `MediaService` presign + `uploadMedia`) já existe da Fatia 2. Esta fatia
constrói o lado servidor NestJS e troca o stub pinado por um cliente REST
`apiJourneyBackend`, destravando o selector para `'api'`. **Sem infra nova.**

Contrato mobile (intocado):

```
getJourney(): JourneySession
listTasks(): Task[]
getTask(id): Task | null
startTask(taskId): { journey, task }
pauseJourney(): JourneySession
resumeJourney(): JourneySession
endJourney(): JourneySession
addTaskPhoto(taskId, uri): Task
```

**Sem CRUD de task** (tarefas são atribuídas externamente/seedadas — a UI só
lista, abre, inicia/pausa e anexa foto).

## Semântica de tempo (o miolo da fatia)

O `progress.ts` do cliente já computa o progresso **ao vivo** a partir de um
`startedAt` absoluto (ISO) + `accumulatedSeconds` bancados. O servidor só precisa
**persistir as âncoras** nas transições — não roda relógio. É a mesma filosofia
do Reports (servidor dono dos timestamps); como `startedAt` é absoluto, o tick do
device exibe certo mesmo com pequena dessincronia de relógio.

As 4 funções puras de âncora (`startAnchors`/`pauseAnchors`/`resumeAnchors`/
`endAnchors` + `elapsedSeconds`/`progressPct`) são **portadas** do `progress.ts`
mobile para `src/journey/time-anchors.ts` no backend (DRY dentro do backend,
testável isolado). O servidor usa o próprio `Date.now()` como `nowMs`.

## Decisões (2026-07-02)

Herdam as decisões travadas no design Amplify-era (2026-06-23); aqui traduzidas
pro backend real.

| Tema | Decisão |
| --- | --- |
| **Âncoras no servidor** | `start`/`resume`: `startedAt = now`, running. `pause`/`end`: `accumulatedSeconds = elapsed(now)`, grava `progressPct` snapshot. Cliente segue tickando pro display ao vivo (contrato devolve as âncoras, não valores derivados). |
| **`endJourney` zera o turno** | Espelha o mock (refino travado em 2026-06-23): journey volta a `idle` com `accumulatedSeconds:0` (tempo bancado do turno é limpo; o banking **por-task** é preservado — cada task é seu próprio objeto). |
| **Single-active-task** | Espelha o mock: `startTask` **não** auto-pausa a task anterior (caveat aceito — só uma ativa por vez na prática). |
| **`getJourney` = get-or-create** | Turno de hoje por `(workerId, date)` — o `@@unique([workerId, date])` garante 1 turno/worker/dia. Cria `idle` na 1ª leitura do dia. |
| **`listTasks` = hoje/minhas** | `assignedTo = req.user.userId AND scheduledDate = hoje` (bate com o índice `@@index([assignedTo, scheduledDate])` e a tela "Hoje"). |
| **Ownership** | Journey/Task escopados ao JWT: worker não lê nem inicia task de outro → **404** (não 403, pra não vazar existência). |
| **Fotos** | Reusa a fundação de mídia da Fatia 2: `uploadImage(uri)` com prefixo **`task/`** → `POST /journey/tasks/:id/photo { imageKey }` → append em `imageKeys`. |
| **Interessados** | **Opção A (fidelidade Figma)**: seed grava `interestedCount` estático + sobe os 5 PNGs demo (`worker-1..5.png`) pro bucket `swi-media` como `interestedAvatarKeys`; `toDto` presigna. Sem feature real de "demonstrar interesse". |

## Arquitetura

Espelha as Fatias 1/2: módulo Nest `controller → guard JWT → service → Prisma`,
reusando `MediaModule` (presign) da Fatia 2. **Sem schema change, sem infra nova.**

### Backend — `src/journey/`
- `time-anchors.ts` (+`time-anchors.spec.ts`): porta pura do `progress.ts`
  mobile (start/pause/resume/end + elapsed/progressPct). Zero deps Nest.
- `JourneyController` (`@UseGuards(JwtAuthGuard)`), rotas resource-style:

  | Contrato | Rota | Retorno |
  | --- | --- | --- |
  | `getJourney` | `GET /journey` | turno de hoje (get-or-create) |
  | `listTasks` | `GET /journey/tasks` | tasks minhas/hoje |
  | `getTask` | `GET /journey/tasks/:id` | task ou 404 |
  | `startTask` | `POST /journey/tasks/:id/start` | `{ journey, task }` |
  | `pauseJourney` | `POST /journey/pause` | journey |
  | `resumeJourney` | `POST /journey/resume` | journey |
  | `endJourney` | `POST /journey/end` | journey (idle) |
  | `addTaskPhoto` | `POST /journey/tasks/:id/photo` | task |

- `JourneyService`: os 8 métodos + `getOrCreateToday(workerId)`. Dois `toDto`
  **async**: `taskToDto` (`imageKeys`/`interestedAvatarKeys → presignGetMany`,
  `startedAt → ISO`, `scheduledDate → ISO date`, `null→''`/`[]` coalescido,
  `status` pass-through) e `journeyToDto` (`state`/`activeTaskId`/`startedAt` ISO/
  `accumulatedSeconds`). Transições usam `time-anchors` com `Date.now()`.
- `AddTaskPhotoDto` (class-validator; whitelist global já ativo): `imageKey`
  obrigatório, `@Matches(/^task\/[0-9a-f-]{36}\.(jpg|png)$/)` — impede referenciar
  objeto de outro prefixo (ex. `reports/`, `chat/`), anti-abuso. Igual Reports.
- Registrar `JourneyModule` (imports `MediaModule`) em `app.module.ts`.

### Backend — `prisma/seed.ts`
- Semeia, pro worker aprovado (`worker@swi.local`), **4 tasks de hoje**
  (`inspecao`/`manutencao`/`diagnostico`/`reparo`, mesmo texto+`objective` do
  mock), `scheduledDate = hoje`, `estimatedMinutes:120`, `interestedCount:18`.
- Sobe os 5 avatares demo (`mobile/assets/avatars/worker-{1..5}.png`) pro bucket
  `swi-media` sob `interested/worker-N.png` via o client S3, e grava as keys em
  cada task (`interestedAvatarKeys`). Re-seed sobrescreve (idempotente). O turno
  **não** é semeado — nasce `idle` no `getJourney`.
- Guard: se as credenciais MinIO/o bucket não estiverem acessíveis, o seed dos
  avatares loga e segue (tasks entram com `interestedAvatarKeys:[]`) — não quebra
  o seed inteiro por causa de asset decorativo.

### Mobile — `services/journey/`
- `apiJourneyBackend.ts` (+test): espelha `apiReportsBackend`. `getJourney`/
  `listTasks`/`getTask` (get com 404→null) via `apiRequest({auth:true})`; as
  transições são `POST` sem corpo; `addTaskPhoto(taskId, uri)` faz
  `uploadImage(uri)` (prefixo `task/`) → `POST /journey/tasks/:id/photo {imageKey}`.
  Server já devolve o shape `Task`/`JourneySession` pronto (URLs presigned, ISO),
  então sem `fromApi`.
- `getJourneyBackend.ts`: passa a honrar `DATA_BACKEND` (igual `getReportsBackend`).
  `getJourneyBackend.test.ts` atualizado (espera api quando `flag=api`).
- **Deletar `amplifyJourneyBackend.ts`** (aposentado, igual `amplifyReportsBackend`
  na Fatia 2 — o comentário stale em `amplifyJourneyBackend.ts:5` morre junto).

## Fluxo de dados

```
# lifecycle
app -- GET /journey -------------------------> backend (get-or-create hoje) --> {state:'idle',...}
app -- POST /journey/tasks/:id/start --------> backend (startedAt=now)       --> {journey, task}
app -- POST /journey/pause ------------------> backend (banca elapsed)       --> {state:'paused'}
app -- POST /journey/resume -----------------> backend (startedAt=now)       --> {state:'ongoing'}
app -- POST /journey/end --------------------> backend (task done, journey idle)
  cliente: progress.ts ticka o display ao vivo a partir de startedAt+accumulatedSeconds

# foto (reusa fundação Fatia 2)
app -- POST /media/presign {contentType} ----> backend --> {url, key: task/<uuid>.jpg}
app -- PUT bytes ----------------------------> MinIO (via url presigned)
app -- POST /journey/tasks/:id/photo {imageKey} -> backend (append imageKeys) --> task
app -- (task.images) ------------------------> [presignedGetUrl] -> <Image> renderiza
```

## Tratamento de erros

Corpo consistente `{statusCode, message}` (padrão auth/profile/reports).
`apiRequest` já anexa `.status` (404 esperado vs 500/rede → `get` coalesce
404→null, transições propagam). `start`/`get`/`photo` de task inexistente ou de
outro worker → **404**. `pause`/`resume`/`end` sem turno ativo são no-op seguros
(mesma tolerância do mock). `imageKey` inválido → 400 (regex do DTO).

## Testes + verificação (disciplina da rodada)

- **Backend**:
  - unit `time-anchors.spec` (start→pause→resume→end determinístico com `nowMs`
    injetado; `progressPct` clamp/estimated≤0) + `journey.service.spec` (Prisma
    mockado: get-or-create, escopo minhas/hoje, denorm/presign no `toDto`,
    single-active-task não auto-pausa).
  - e2e `journey.e2e-spec` (supertest vs Postgres real, worker throwaway):
    401 sem token; `getJourney` cria idle e é idempotente no dia; lifecycle
    `start → pause → resume → end` com as âncoras/estados certos; `getTask` 404
    p/ inexistente e p/ task de outro worker; `photo` com `imageKey` bom (append)
    e ruim (400). Presign reusa o endpoint da Fatia 2 (URL computada, **não**
    precisa MinIO up pro e2e).
  - **docker smoke** (MinIO real): seed → `getJourney` → `start` → `photo`
    (presign → PUT bytes → append) → a URL da imagem responde 200; lifecycle
    completo termina `done`/`idle`.
- **Mobile**: jest (`apiJourneyBackend` com fetch mockado: transições, sequência
  presign+upload+photo, selector `getJourneyBackend`), tsc 0 novos (8 baseline),
  expo export web exit 0.
- **Two-gate** (spec-compliance + quality subagents) + review holística; commit
  **só com luz verde explícita** do usuário.
- Teste manual no dev build (`EXPO_PUBLIC_DATA_BACKEND=api` no `.env` do Metro):
  iniciar tarefa, ver donut correr, pausar/retomar, anexar foto, encerrar turno.

## Não-objetivos / notas

- **Sem CRUD de task** (atribuição é externa; seedada nesta fase).
- **Sem feature real de "interesse"** — `interestedCount`/avatares são seed
  decorativo (Opção A) pra paridade com o cluster "Interessados" do Figma.
- **Sem paginação** (`listTasks` devolve o dia inteiro) e **sem auto-pause**.
- **Saúde/vitals intocado** (mock permanente até a smartband).
- **Custo de QA herdado da Fatia 2**: device físico sobre ngrok exige túnel
  próprio do MinIO + `MINIO_PUBLIC_URL`; emulador/web na mesma máquina usam
  `localhost:9000` (Android emu `10.0.2.2:9000`).
- **Deploy** (herança da rodada): MinIO → S3, bucket/policy via IaC, secrets SSM;
  o upload de avatares "interested" pelo seed vira um passo de fixture/IaC.
