# SWI Backend (container) — Fan-out de notificações via fila (pg-boss) — design

> Doc **temporário** (`docs/plans/*backend*`): deletar quando o backend inteiro estiver
> implementado. **2º dos "diferidos pós-H3"** (a fase de hardening H1–H3 fechou #32–#35; o
> media presigned-POST fechou #36). Tira o fan-out de notificações do request path.

## Contexto

`NotificationService.createForMany` (`notification.service.ts:55`) faz o fan-out cross-domain:
por worker → `notification.create` + `realtime.emitToUsers` (best-effort). É chamado **síncrono
no request path** por:

- `reports.service.ts:48-59` — relatório novo faz **broadcast org-wide** a TODOS os workers
  aprovados (`await createForMany(others, ...)` dentro de try/catch best-effort). **É o gargalo
  real**: N cresce com a org → o `POST /reports` espera N inserts + N emits.
- `chat.service.ts:99-113` — notifica o(s) destinatário(s); numa conversa 2-party N=1 (trivial).
- `weather-alert.service.ts:32` — cron broadcast a todos os workers (não é request path, mas
  broadcast org-wide igual).

Todos já **best-effort** (try/catch — falha do fan-out nunca quebra o write-fonte). O problema é
**latência no request path** (reports) conforme a org cresce. **Decisão do usuário:** mover pra
**fila durável pg-boss** (Postgres) — zero infra nova, paridade local↔RDS.

## Decisões

### Fila = pg-boss (Postgres, durável)

Fila de jobs na **própria Postgres** (não Redis/SQS). `pg-boss` cria seu schema `pgboss` (coexiste
com o Prisma), conecta via `DATABASE_URL`, roda um worker **in-process** (mesmo processo NestJS —
single ECS task; splitável depois). Durável: o job sobrevive a restart. Descartados: BullMQ+Redis
(infra nova), SQS (twin local fraco); in-process EventEmitter (não-durável, não é "fila").

### Escopo: todos os `createForMany` por 1 caminho

Roteio **todos** os fan-outs (reports, chat, weather) pela fila — 1 caminho único. O **emit
real-time da MENSAGEM** do chat (`chat.service.ts:98` `emitToUsers 'message'`) **fica inline**
(é a entrega da msg ao vivo, não uma notificação); só o *fan-out da notificação* (sino
cross-domain) vai pra fila. Chat é N=1, mas roteá-lo mantém consistência sem custo real (a msg já
foi entregue inline; o atraso sub-segundo do sino é irrelevante).

### Componentes

- **Dep nova:** `pg-boss`.
- **`QueueModule`/`QueueService`** (`src/queue/`): `onModuleInit`→`boss.start()`; `onModuleDestroy`→
  `boss.stop()` (shutdown limpo, sem open-handles no e2e); `enqueue(name, data)`; `registerWorker(name, handler)`
  via `boss.work`. Job único: **`notifications.fanout`** = `{ workerIds: string[], payload: NotificationPayload }`.
  `retryLimit: 2` + backoff.
- **`NotificationService.enqueueForMany(workerIds, payload)`** = `queue.enqueue('notifications.fanout', {...})`
  (rápido). O **worker handler** (registrado no boot) chama o **`createForMany` existente** (reusa insert+emit).
  `createFor`/`createForMany` **intactos**.
- **Callers** trocam `await createForMany(...)` por `await enqueueForMany(...)`: reports (`:53`),
  chat (`:106`), weather (`:32`). O `findMany(others)` do reports **fica no request** (query barata).

### Test-env seam (decisão-chave)

Em `NODE_ENV==='test'`, o `QueueService.enqueue` roda o handler **inline/síncrono** (não pg-boss).
Preserva o **determinismo dos e2e existentes** (o fan-out completa antes do request retornar, como
hoje) e evita flakiness de timing async + open-handles do poller nas 8 suites. O pg-boss **real
(async, durável)** roda no container (NODE_ENV unset) e é provado pelo **docker smoke**. Espelha o
padrão `skipIf` test-env do throttle (H3b).

## Data flow

- **Enqueue (request/cron):** caller computa recipients → `enqueueForMany` insere 1 job durável →
  **retorna na hora** (write-fonte não espera o fan-out).
- **Dequeue (worker in-process):** pg-boss poller pega `notifications.fanout` → handler `createForMany`
  → N inserts + N emits (best-effort) → job complete.

## Tratamento de erro

- **Enqueue falha** (fila down) → try/catch best-effort dos callers → write-fonte sobrevive, fan-out
  perdido (mesmo posture de hoje). Documentado.
- **Handler falha** → `createForMany` usa `Promise.allSettled` (destinatário ruim não derruba o lote);
  `retryLimit: 2` + backoff pra falha transitória.
- **Trade-off de duplicata (documentado, aceito pro piloto):** crash mid-batch → pg-boss re-entrega
  → handler re-roda → **notifs duplicadas** pros já inseridos (sem chave de idempotência). Raro +
  best-effort/não-crítico. Idempotência real = follow-up se importar.

## Testes / gate

- **Unit:** `QueueService` (mock pg-boss: enqueue→`boss.send`; registro do worker; inline em test-env);
  `NotificationService.enqueueForMany` (enfileira `{workerIds,payload}`); `createFor`/`createForMany`
  **intactos**. **Atualizar** specs dos callers que assertam `createForMany` → `enqueueForMany`
  (`reports.service.spec:92`, `chat.service.spec:140`, `weather-alert.spec:24`).
- **e2e:** com o inline-seam, os e2e seguem determinísticos (fan-out inline) → 8 suites verdes sem polling.
- **Docker smoke REAL (rebuild):** `POST /reports` → em <1s os outros workers têm a notif
  (`GET /notifications`) + socket recebe → prova o **pg-boss async ao vivo**. **Durabilidade:**
  enfileira job, **restart do container api**, confirma que o job ainda processa (sobrevive).
- **Gate:** backend build 0 / unit / e2e; **zero mobile/admin**.

## Não-objetivos / diferidos

- **Cursor pagination real** (a outra fatia pós-H3; quebrante backend+mobile).
- Idempotência real do fan-out (chave de dedup) — só se as duplicatas raras importarem.
- Worker em processo/container dedicado (hoje in-process; splitável quando a escala pedir).
- SQS/EventBridge nativo em AWS (pg-boss em RDS serve o piloto; migrar se um dia precisar).

## Execução (subagent-driven)

Branch `feat/backend-notif-fanout-queue` de `main`@`9477ba9`. Tasks:

1. **`QueueModule`/`QueueService`** — pg-boss + dep + inline test-seam + spec (TDD).
2. **`NotificationService.enqueueForMany` + registro do worker handler** (reusa `createForMany`) + spec.
3. **Repoint dos 3 callers** (reports/chat/weather) + atualizar specs.
4. **Verificação + docker smoke real** (fan-out async ao vivo + restart-survive) **+ PR** (controller = eu).

Cada task backend = implementer + **two-gate** (spec + code-quality). Commit local por task;
**push/PR só com luz verde explícita, sem rastros de IA**.
