# SWI Backend — Fatia Jornada/Tarefas

> Doc **temporário** (deletar quando o backend inteiro estiver pronto).
> Segunda fatia do roadmap pós-pivô — ver `2026-06-22-swi-backend-roadmap-design.md`.
> Branch: `feat/backend-jornada` (stacked em `feat/mobile-login`).

## Escopo

Backend real da **jornada/tarefas** no app do worker (mobile): ver as tarefas do
dia, iniciar/pausar/retomar/finalizar (com **status + progresso reais**), anexar
fotos, e um cronômetro de **jornada** do turno. Dois models no `swi-backend`,
Abordagem A (mock+amplify atrás da flag `AUTH_BACKEND`, `tsc`+`jest` verdes,
deploy-gated). Wiring do swi-admin fica pro hardening.

## Decisões (travadas com o usuário 2026-06-23)

1. **Atribuição/visibilidade = atribuída ao worker.** Admin/supervisor cria e
   atribui a um worker; cada worker lê/atualiza **só as suas** tarefas; admin
   gerencia tudo. Combina com o planner pessoal "Hoje" e o `JourneyProvider`
   atual. (Lido da tela: não existe UI de criar tarefa no mobile — o worker só
   executa; "Fotos da solicitação"/"Objetivo principal"/"Interessados" descrevem
   uma ordem de serviço atribuída.)
2. **Status + progresso reais** (não só conteúdo). `Task` carrega `status` +
   âncoras de tempo; iniciar/pausar/retomar/finalizar **persistem** no backend.
3. **Cronômetro da jornada = entidade `Journey` leve** (um por worker/dia). É
   exatamente o que o `JourneyProvider` já modela, persistido. Donut = tempo real
   do turno; "8h não iniciadas" (idle) = soma do `estimatedMinutes` das tasks
   pending.
4. **Fotos = evidência de conclusão que o worker sobe** (a UI é um picker de
   upload) → persistem em **S3** como nos Relatórios; mock usa uris locais. Label
   "Fotos da solicitação" mantido.
5. **Objetivo / Tempo estimado / Interessados = campos reais do `Task`** semeados
   no mock (não models separados — YAGNI, igual `activities`=json dos Relatórios).
   "Interessados" é snapshot denormalizado (count + avatar keys), sem presença
   real-time.

## Progresso real (mecânica)

Gravo **só nas transições**; o cliente tica 1×/s a partir das âncoras só pra
renderizar (sem write por segundo; sobrevive a reload; supervisor vê estado real).

- `elapsed = status==='in_progress' ? accumulatedSeconds + (now - startedAt) : accumulatedSeconds`
- `progressPct = min(100, elapsed / (estimatedMinutes*60) * 100)`
- iniciar → `status='in_progress', startedAt=now` (se 1º start)
- pausar → `accumulatedSeconds += now - startedAt; status='paused'` (snapshot `progressPct`)
- retomar → `startedAt=now; status='in_progress'`
- finalizar → `status='done'` (acumula o segmento final; `progressPct`=final)

Mesma mecânica no timer da `Journey` (`startedAt`/`accumulatedSeconds` no nível do
turno).

## Modelos (`swi-backend/amplify/data/resource.ts`)

```
Journey  (um por worker/dia — o JourneyProvider persistido)
  workerId            string (required)        // Cognito sub
  date                date                     // o dia ("Hoje")
  state               enum ['idle','ongoing','paused']
  activeTaskId        string                   // task ativa (null se idle)
  startedAt           datetime                 // 1ª task iniciada
  accumulatedSeconds  integer                  // tempo do turno antes da pausa atual

  auth:
    allow.ownerDefinedIn('workerId').to(['read','create','update'])
    allow.group('admin')

Task
  assignedTo          string (required)        // Cognito sub do worker
  title               string (required)
  description         string                   // texto do card
  objective           string                   // "Objetivo principal"
  estimatedMinutes    integer                  // "3h até conclusão" = 180
  status              enum ['pending','in_progress','paused','done']
  startedAt           datetime                 // âncora p/ progresso real
  accumulatedSeconds  integer                  // tempo trabalhado antes da pausa
  progressPct         float                    // snapshot gravado nas transições
  scheduledDate       date                     // "Hoje" — escopo da lista
  imageKeys           string[]                 // S3 keys das fotos (uris no mock)
  interestedCount     integer                  // "+17 acompanhando"
  interestedAvatarKeys string[]                // avatares do AvatarGroup (keys/uris)

  auth:
    allow.ownerDefinedIn('assignedTo').to(['read','update'])  // worker: lê/atualiza as suas
    allow.group('admin')                                      // admin: cria + atribui + gerencia
```

Notas:
- **Sem `hasMany`** Journey↔Task: tasks listadas por `assignedTo` + `scheduledDate`
  = hoje; `Journey.activeTaskId` aponta a ativa. Evita join (igual `activities`).
- **Caveat de auth:** `ownerDefinedIn('assignedTo').to(['update'])` deixa o worker
  atualizar qualquer campo da própria task (inclusive reatribuir). Pro demo
  deploy-gated é aceitável; **regra field-level entra no hardening** (fatia 7).
- Precedente no schema: `HealthData` já usa `ownerDefinedIn('workerId')`.

## Storage S3 (`swi-backend/amplify/storage/resource.ts`)

- Adiciono o prefixo `journey/{entity_id}/*` (authenticated read; owner write) ao
  `defineStorage` existente — **um bucket, dois prefixos**.
- Como nada foi deployado, **renomeio `swiReportsMedia` → `swiMedia`** (agora serve
  2 domínios; custo de migração zero por estar deploy-gated). Atualizar a
  referência em `amplify/backend.ts`.
- Amplify path: `uploadData` → guarda key em `imageKeys`; leitura resolve url via
  `getUrl`. Mock path: ignora S3, usa uris locais do `expo-image-picker`.

## Service mobile (`mobile/services/journey/`) — espelha `reports/`

`JourneyProvider.tsx` já existe (máquina de sessão em memória). Adiciono e refatoro:

- `types.ts` → `Task`, `TaskStatus`, `JourneySession` (state/activeTaskId/timer
  anchors), e
  `JourneyBackend { getJourney(): Promise<JourneySession>; listTasks(): Promise<Task[]>; getTask(id): Promise<Task|null>; startTask(id): Promise<...>; pauseJourney(): Promise<...>; resumeJourney(): Promise<...>; endJourney(): Promise<...>; addTaskPhoto(id, uri): Promise<Task> }`
- `mockJourneyBackend.ts` — semeia as 4 tasks de hoje (migradas de
  `lib/journeyMockData.ts`) atribuídas ao worker + journey em memória; transições
  atualizam status/âncoras; fotos = uris locais.
- `amplifyJourneyBackend.ts` — `generateClient<Schema>()` (Data) + Storage
  (`uploadData`/`getUrl`); mapeia model ↔ tipos.
- `getJourneyBackend.ts` — selector pela flag `AUTH_BACKEND` (mock|amplify), igual
  `getReportsBackend`.
- `JourneyProvider.tsx` (refator) — backa a sessão com o backend: carrega
  journey + tasks no mount com máquina `loadStatus` (idle/loading/ready/empty/
  error); mantém a API `state/activeTaskId/startTask/pauseJourney/resumeJourney/
  endJourney` (agora persistindo via backend) + expõe `tasks` e `addTaskPhoto`.
  **Atenção:** dois eixos de estado distintos — `loadStatus` (carregamento da
  lista) vs `state` (sessão idle/ongoing/paused). Nomes separados pra não colidir.
- Testes: `getJourneyBackend.test.ts`, `mockJourneyBackend.test.ts`.
- `lib/journeyMockData.ts` deixa de ser consumido pelas telas (a semente migra
  pro mock backend).
- Provider segue montado em `mobile/app/(app)/_layout.tsx` (auth-scoped).

## Wiring das telas

- `journey/index.tsx` — troca `TASKS` por `useJourney().tasks`; donut deriva do
  timer real da `Journey` ("8h" = soma estimada das pending; "7:55:12h" = elapsed
  real); layout idle/ongoing/paused agora dirigido pelo `state` persistido; CTAs
  (iniciar/finalizar/pausar/retomar) chamam as mutations do provider; render
  loading/empty/error.
- `journey/task/[id].tsx` — troca `findTaskById`/`FALLBACK_TASK`/objetivo/tempo/
  interessados hardcoded por `useJourney().getTask(id)`; `TaskProgress` deriva das
  âncoras reais (tica a partir do persistido em vez do crawl fixo 1pt/s); fotos
  carregam de `imageKeys` e `addTaskPhoto` persiste (S3 amplify / local mock);
  render loading/empty/error.
- Estados compostos com o DS via novo `components/journey/JourneyState.tsx`
  (espelha `components/reports/ReportsListState.tsx`). **Sem inventar componente**
  (regra DS).

## Estados production-ready (igual Relatórios)

- **loading** — placeholder enquanto busca.
- **empty** — "nenhuma tarefa hoje" (lista vazia).
- **error** — mensagem + retry (falha de rede/backend).
- Compostos com o DS; sem inventar componente.

## Flag

Reuso `AUTH_BACKEND` (`mock`|`amplify`) como switch global mock/amplify (já liga
auth+profile+reports). Generalizar o nome → switch único no hardening (fatia 7).

## Não-objetivos da fatia

- Worker **criar/atribuir** tarefa (admin faz; worker só lê/atualiza as suas).
- Wiring do swi-admin (mockApi → Amplify) — hardening.
- Presença real-time dos "Interessados" (fica snapshot count + avatares).
- Push de atribuição de tarefa (fatia Notificações, SNS).
- Time-tracking refinado (acúmulo multi-segmento já cobre; sem timesheet/relatório).
- Deploy de produção (sem conta AWS).

## Verificação (deploy-gated)

- `swi-backend`: `npx tsc --noEmit -p amplify` exit 0.
- `mobile`: `npx jest` (novos testes verdes), `npx tsc --noEmit` sem erros novos
  (8 pré-existentes são baseline), `npx expo export --platform web` exit 0.
- Smoke visual dos estados (loading/empty/error) + progresso/timer via flag —
  eyeball pendente até rodar `expo start` (igual Relatórios/Fatia 3).

## Ajustes na implementação (2026-06-23)

Decisões refinadas durante a execução subagent-driven (registradas pra o doc não
divergir do código):

- **`endJourney` zera o relógio do turno** (`accumulatedSeconds: 0`). O plano dizia
  "bancado", mas banked vazava o tempo do turno anterior pro próximo (donut
  começaria em ~8:00:00 em vez de 0). Banking é **por-task** (cada task banca o
  seu); o turno reseta no fim. (Achado no spec review da Unit 2, corrigido.)
- **Detalhe lê a task viva do provider** (`tasks.find(id)`), não o snapshot
  carregado uma vez. Sem isso, iniciar a task na própria tela de detalhe não
  reativava a barra (ficava 0% estática) — a feature-título "progresso real"
  quebrava. (C1, achado na review holística, corrigido.)
- **`pauseJourney`/`resumeJourney` no provider re-buscam `listTasks()`** (igual
  `endJourney`), pra a barra **congelar** no snapshot ao pausar e **retomar** do
  ponto banked ao retomar. Sem isso a barra seguia tiquetaqueando pausada.
- **Fotos cheias (5):** picker guardado (`photosFull`) + label a11y honesto (não
  promete "substituir" já que o backend faz append).

## Próximo passo

`writing-plans` → `2026-06-23-swi-backend-jornada-plan.md` (fases + verificação),
depois implementação subagent-driven com two-gate review (igual Fatias 1/3/
Relatórios). Merge só com OK explícito do usuário.
