# SWI Backend (container) — Fatia 5 (Notificações) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Fatia 5 da rodada container dos domínios
> não-saúde (`2026-07-02-swi-backend-dominios-nao-saude-design.md`), depois de
> Fundação/Perfil/Relatórios/Jornada/Chat.

## Contexto

Quinta fatia vertical do backend real conteinerizado (NestJS + Prisma + Postgres +
MinIO via Docker Compose; deploy futuro AWS ECS/RDS). **Abordagem A**: 1 fatia/PR
por domínio contra `main`, trocando o stub `amplify*Backend` do mobile por um
cliente REST `api*Backend`. Domínio: **Notificações** — feed in-app + **push
real-time via WebSocket** (reusa o `RealtimeModule` da Fatia 4) + **emits
cross-domain server-side** (a feature-título desta fatia segundo o design da rodada).

O model `Notification` já existe (Fatia 0). O seam mobile `services/notifications/`
(types + reducers puros + mock + provider + **a tela já fiada** ao `useNotifications()`)
veio pronto da era Amplify e está em `main`. Logo o mobile desta fatia é **só o
cliente REST** — idêntico ao lado mobile do Chat (telas/reducers/provider/component
intocados).

**Deps novas: nenhuma.** `@nestjs/websockets`/`@nestjs/platform-socket.io` já estão
no backend e `socket.io-client` no mobile (ambos da Fatia 4). Fatia mais leve que o Chat.

Branch: **`feat/backend-notificacoes`** (de `main`@`45f0443`, pós-merge do PR #28).

## Princípio orientador (feedback do usuário, 2026-07-03)

**Máxima execução real antes do deploy AWS.** Não deferir "pro hardening/deploy"
por default: liga-se toda capacidade cujo gatilho já exista no backend; só fica
deferido o hard-block físico (push do SO / credencial / serviço AWS-only). Por isso
esta fatia **liga os emits cross-domain que têm gatilho de runtime hoje** em vez de
adiá-los (como a fatia Amplify fazia).

## Decisões

1. **Feature-título = feed ao vivo + emits cross-domain reais.** Reusa o
   `RealtimeGateway`/`RealtimeModule` da Fatia 4 (socket.io na porta 3000, JWT no
   handshake, sala `user:<id>`, `emitToUsers`). Evento socket **`notification`**.
   Emits ligados **agora**:
   - **chat → notif**: `ChatService.sendMessage`, após persistir + emitir `message`,
     cria uma `Notification(domain='chat')` pro **destinatário** + push ao vivo.
   - **report → notif**: `ReportsService.create`, após persistir, faz **broadcast**
     de `Notification(domain='reports')` pros **outros workers aprovados** (Decisão 2a
     — bate com o inbox de relatórios que já é org-wide) + push ao vivo a cada um.
2. **task → notif = seed + injetável (Decisão 1b).** Não existe endpoint de
   atribuição de task (é papel do admin, contrato ainda sem Figma — *design-blocked*,
   não *infra-blocked*). As notificações `domain='journey'` entram pelo **seed**
   (fidelidade ao mock); o `NotificationService` fica **injetável** pra a rodada admin
   ligar o emit de runtime quando o gatilho de atribuição nascer.
3. **clima → notif = na Fatia 6.** O gatilho (alerta meteorológico) nasce na fatia
   Clima. Não é "deferido pro deploy" — é construído na fatia dona do gatilho; o
   `NotificationService` exportado já deixa isso pronto.
4. **faq → notif = seed-only.** FAQ é conteúdo estático, sem domínio/backend nem
   gatilho de runtime. Entra no seed (fidelidade), sem emit.
5. **Emits best-effort.** A notificação nasce **depois** do write-fonte, num
   `try/catch` que **engole falha**: mandar mensagem / criar relatório nunca pode
   quebrar porque o fan-out de notificação falhou. O write-fonte é a verdade; a
   notificação é derivada.
6. **Wiring cross-domain = dependência direta.** `ChatModule`/`ReportsModule`
   importam `NotificationModule` e injetam `NotificationService`. Explícito, síncrono,
   testável, zero dep nova, sem ciclo (o `NotificationModule` não depende de volta) —
   mesmo estilo do `ChatModule` importando `RealtimeModule`/`MediaModule`. Descartados
   event-emitter (indireção/fire-and-forget) e transação cross-service (complexidade
   sem ganho — a notificação é secundária).
7. **`read` boolean por-destinatário** (não o map por-viewer do Chat) — cada
   `Notification` tem exatamente 1 destinatário.
8. **Deep-link = `domain` enum + `targetId`** (já no model). Cliente mapeia
   `domain → rota` (a routing table da tela já existe). `targetId` habilita deep-link
   futuro; seed aponta a recursos reais quando existir.

## Model backend (já existe — Fatia 0)

```prisma
model Notification {
  id        String             @id @default(uuid())
  workerId  String
  worker    User               @relation(fields: [workerId], references: [id])
  title     String
  body      String?
  domain    NotificationDomain // weather|chat|reports|journey|faq
  targetId  String?
  read      Boolean            @default(false)
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
  @@index([workerId, createdAt])
}
```

Sem migração nova. `NotificationDomain` inclui `weather` (usado só no seed/mock; o
gatilho real vem na F6) e `faq` (seed-only).

## Backend — `swi-backend/src/notifications/`

| Arquivo | Papel |
| --- | --- |
| `notification.service.ts` (+spec) | `list(workerId)` (`createdAt desc`, `toDto`) · `markRead(workerId,id)` (ownership → **404** `NotFoundException`) · `markAllRead(workerId)` (`updateMany read=true`) · **`createFor(workerId, payload)`** (cria + `realtime.emitToUsers([workerId],'notification',dto)`) · **`createForMany(workerIds, payload)`** (loop `createFor` sob `Promise.allSettled` — o `createMany` do Prisma não devolve as rows pra montar o dto do emit, e um destinatário ruim não derruba o resto). Os dois últimos = superfície injetável cross-domain. |
| `notification.controller.ts` (JWT) | `GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all`. `workerId` sempre do JWT (nunca do body/param). |
| `notification.module.ts` | importa `RealtimeModule`, **exporta `NotificationService`** (Chat/Reports importam). |

- **`ChatModule`**: passa a importar `NotificationModule`. `ChatService.sendMessage`
  → best-effort `createFor(recipientId, { domain:'chat', title: <nome do remetente>,
  body: <corpo ou 'Enviou um anexo'>, targetId: conversationId })`.
- **`ReportsModule`**: passa a importar `NotificationModule`. `ReportsService.create`
  → resolve os **outros workers aprovados** (`User` role=WORKER, approvalStatus=APPROVED,
  id ≠ autor) → best-effort `createForMany(ids, { domain:'reports', title:'Novo
  relatório', body: report.title, targetId: report.id })`.
- **`app.module`**: registra `NotificationModule`.

### DTO de saída (`NotificationDto`)
`{ id, title, body, domain, targetId, read, createdAt }` — ISO no `createdAt`
(paridade com o `AppNotification` do mobile; ordenação lexicográfica = cronológica).

## Seed (`prisma/seed.ts` — Opção A, fidelidade)

Semear as 12 notificações do mock (`mockNotificationBackend.ts`) pro **worker
seedado**, domains preservados, `createdAt` decrescente (1ª = mais recente), mix
read/unread realista (3 não-lidas). `targetId` aponta a recursos reais seedados
quando existir (ex.: uma conversa/relatório/task já no seed); senão `null`. Guard de
idempotência como nas fatias anteriores.

## Real-time — contrato

```
socket 'notification'  (payload = NotificationDto)
  emitido por  realtime.emitToUsers([workerId], 'notification', dto)
  entregue na  sala user:<workerId>  (gateway da Fatia 4, intacto)
```

## Mobile — só o cliente REST (`mobile/services/notifications/`)

Telas (`app/(app)/notifications.tsx`), `NotificationState`, `NotificationProvider`,
reducers e `types.ts` **intocados** (já consomem `useNotifications()` e `subscribe`).

| Arquivo | Ação |
| --- | --- |
| `apiNotificationBackend.ts` (+test) | REST `listNotifications`/`markRead`/`markAllRead` via `services/api/http.ts` (erro com `.status`); `subscribe(cb)` via **socket.io-client** (conecta com o token; filtra evento `notification` → `cb`); `registerPushToken` = **no-op seam** (documentado deploy-gated); `myId` = singleton `services/api/session.ts`. |
| `getNotificationBackend.ts` | despinar → honra `DATA_BACKEND` (`'api'` → apiNotificationBackend, senão mock). |
| `amplifyNotificationBackend.ts` | **deletado**. |

**Socket:** o `apiNotificationBackend` abre o **próprio socket** (espelha o
`apiChatBackend`; o gateway aceita 2 conexões do mesmo user, ambas na sala
`user:<id>`, cada cliente filtra o seu evento). **Não toca no código mergeado do
Chat.** Consolidar num socket compartilhado = follow-up opcional anotado.

## Fluxo de dados

```
load()  → GET /notifications  → setNotifications (recente-primeiro)
subscribe(cb) (mount do provider) → socket 'notification' → applyNotification → feed ao vivo
tap card → markRead(id) (otimista) + navega (domain→rota | weather→modal in-place)
"marcar todas" → markAllRead() (otimista)

[cross-domain] worker A envia msg / posta relatório
  → ChatService/ReportsService (best-effort) → NotificationService.createFor(Many)
  → persiste Notification + emitToUsers → worker(s) B recebem 'notification' ao vivo
```

## Tratamento de erro

- `GET /notifications` falha → provider `loadStatus='error'` → `NotificationState`
  erro + retry (`.then(ok,err)`, já implementado).
- `markRead`/`markAllRead` otimistas: state atualiza já; swallow em falha (reconcilia
  no próximo load) — já implementado.
- Emits cross-domain best-effort: `try/catch` no service-fonte; falha não propaga.
- `subscribe` desinscreve + fecha o socket no unmount.
- `markRead`/`:id/read` de notificação de outro worker → **404** (ownership).

## Testes

- **Backend unit** (`notification.service.spec.ts`): ordem do `list`; `markRead` 404
  de ownership; `markAllRead`; `createFor` persiste + emite; `createForMany` faz
  broadcast + exclui o autor.
- **Backend e2e** (`notifications.e2e-spec.ts`): REST (list/read/read-all com JWT +
  404) **+ prova cross-domain de 2 sockets** — worker B conecta socket → worker A
  envia mensagem de chat (e/ou posta relatório) via REST → **worker B recebe
  `notification` ao vivo** (técnica do e2e do Chat: `app.listen(0)` + socket.io-client).
- **Mobile** (`apiNotificationBackend.test.ts`, `getNotificationBackend.test.ts`):
  REST list/markRead/markAllRead; subscribe com socket mockado; push no-op; seletor
  honra `DATA_BACKEND`.
- **Gate full-branch:** backend `build` 0 / `test` verde / `test:e2e` verde; mobile
  `tsc` **8 baseline** (0 novos) / `jest` verde / `expo export --platform web` 0;
  **docker smoke REAL** (rebuild do container: REST + push cross-domain de 2 sockets
  no container).

## Execução (subagent-driven, como o Chat)

1. **Módulo backend** — `NotificationModule` (service+controller+module, TDD) + registro no `app.module`.
2. **Emit chat→notif** — `ChatModule` importa `NotificationModule`; `sendMessage` chama `createFor` (best-effort) + teste de regressão.
3. **Emit report→notif** — `ReportsModule` importa `NotificationModule`; `create` chama `createForMany` (best-effort) + teste.
4. **Seed** — 12 notificações do mock pro worker.
5. **e2e** — `notifications.e2e-spec.ts` (REST + 2-socket cross-domain).
6. **Mobile** — `apiNotificationBackend` (+test), despin `getNotificationBackend` (+test), deletar `amplifyNotificationBackend`.
7. **Verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch**. Commit e PR **só com luz verde explícita do usuário** (sem
rastros de IA).

## Pendências de deploy (documentadas, não construídas — só hard-blocks reais)

- **Push do SO (o único hard-block)**: SNS/FCM/APNs + `expo-notifications` (permissão +
  token no device) + persistência do token. `registerPushToken` fica seam no-op.
- **clima → notif**: ligado na Fatia 6 (dona do gatilho).
- **task → notif runtime**: ligado na rodada admin (quando o endpoint de atribuição
  nascer com contrato/Figma).
- **Consolidar sockets** chat+notif num só (opcional; hoje 2 conexões, funcional).
- **Fan-out cross-domain é síncrono no write path**: `ReportsService.create` faz o
  broadcast (N inserts + N emits) **antes** de retornar o 201 — ok pra piloto, mas em
  org grande deve virar fire-and-forget / fila (SNS/SQS, ou `setImmediate`); o emit já
  é self-contained best-effort. Deferimento **deliberado** (Decisão 6: dependência
  direta síncrona sobre event-emitter), não implícito.
- **Contrato `domain` ↔ mapa de rotas** do cliente em sincronia (mesmo risco do
  `conversationId` do Chat).

## Não-objetivos

Push real do SO, emit de task em runtime, integração admin, menu real do `more_vert`,
agrupamento/categorização, preferências de notificação, badge de sino global no layout.
