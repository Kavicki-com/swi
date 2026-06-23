# SWI Backend (AWS) — Fatia Notificações (design)

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Esta é a **fatia 4** do roadmap pós-pivô
> (`2026-06-22-swi-backend-roadmap-design.md`), depois de Relatórios, Jornada e Chat.

## Contexto

Quarta fatia vertical do backend AWS, **Abordagem A, deploy-gated**: backend-as-code
em `swi-backend/` + camadas `mock`/`amplify` atrás da flag `AUTH_BACKEND` nos
`services/*` do mobile. `tsc` + `jest` verdes; **deploy real travado até existir
conta AWS** (custo R$0 agora). Domínio: **Notificações** — `Notification` + push
**SNS**; tela `notifications.tsx` (+ os 2 modais de alerta).

A fatia **espelha o padrão `services/<domínio>`** já estabelecido por Chat/Jornada
(não um design bespoke, nem dobrar notificações dentro de Chat).

Branch: **`feat/backend-notifications`** (uma branch `feat/backend-*` pode tocar
`swi-backend/` + o wiring em `mobile/` — permitido pela regra de branch).

## Decisões (forks resolvidos com o usuário)

1. **Headline = seam + feed in-app ao vivo (espelha Chat).** O núcleo testável é o
   **feed in-app ao vivo** (event-bus no mock + seam `subscribe()`, igual ao
   real-time do Chat). O **push via SNS é um seam deploy-gated**: `registerPushToken()`
   + stub de publish SNS no path amplify. **Nada de `expo-notifications`/push do SO
   agora** (precisa de device + APNs/FCM + conta AWS).
2. **Deep-link = `domain` enum + `targetId` opcional** (não href cru). O model guarda
   `domain: enum('weather'|'chat'|'reports'|'journey'|'faq')` + `targetId?`; a tela
   mapeia `domain → rota` (preservando a routing table atual, incl. o caso especial
   `weather → modal`). Type-safe, DB desacoplado dos literais de rota do mobile, e
   `targetId` habilita deep-link futuro a um relatório/tarefa específico.
3. **Read/unread = tratamento visual mínimo + "marcar todas como lidas".** `read` é
   um campo **por-destinatário** (1 destinatário → boolean, NÃO o map por-viewer do
   Chat). Cards não-lidos ganham ênfase sutil via token (`useTheme()`) — **forma
   exata confirmada contra o Figma antes de codar**. Tocar um card marca lido +
   navega; uma ação "marcar todas como lidas" zera tudo. O ícone `more_vert` segue
   **decorativo** (como hoje — sem menu real).
4. **Modais de alerta = deixar como estão.** `WeatherAlertModal` + `ActiveAlertModal`
   (fluxo meteorológico/evacuação) ficam **exatamente como hoje** — território das
   fatias Clima/Evacuação. Só trocamos o array estático `NOTIFICATIONS` pelo backend
   ao vivo; uma notificação `domain='weather'` ainda abre o `WeatherAlertModal`
   in-place em vez de navegar.

## Arquitetura

### Model backend (`swi-backend/amplify/data/resource.ts`)

```
Notification: a.model({
  workerId:  a.string().required(),   // Cognito sub do destinatário
  title:     a.string().required(),
  body:      a.string(),
  domain:    a.enum(['weather','chat','reports','journey','faq']),  // → rota
  targetId:  a.string(),              // id do recurso específico (opcional; deep-link futuro)
  read:      a.boolean(),             // por-destinatário (1 destinatário → boolean)
})
.authorization((allow) => [
  allow.ownerDefinedIn('workerId').to(['read','update']),  // worker lê + marca lida
  allow.group('admin'),                                     // backend/admin cria
]),
```

- **Ordenação por recência:** usa o timestamp de sistema `createdAt` do Amplify no
  path real; no mock o mirror carrega um `createdAt` ISO próprio. (Sem campo de
  timestamp custom redundante; índice de sort, se necessário, é trabalho de deploy.)
- **Auth espelha `Journey`/`VitalsSample`:** `ownerDefinedIn('workerId')` deixa o
  worker ler + dar update (marcar lida). **Criação por `admin`/backend** — os outros
  domínios vão emitir notificações (diferido pro hardening).
- **`read` boolean** (não o `unreadByJson` map do Chat) justamente porque uma
  notificação tem **exatamente um destinatário**.

### Camada de serviço (`mobile/services/notifications/`)

Espelha `services/chat` e `services/journey`.

| Arquivo | Papel |
| --- | --- |
| `types.ts` | `AppNotification` (nome evita a colisão com o global `Notification` do TS/RN) + interface `NotificationBackend`: `myId`, `listNotifications()`, `markRead(id)`, `markAllRead()`, `registerPushToken(token)` *(seam)*, `subscribe(cb)` *(feed ao vivo)*. |
| `notificationReducers.ts` (+test) | **Puro, TDD.** `applyNotification` (insere + dedupe por id + ordena recente-primeiro), `markRead`, `markAllRead`, `unreadCount`, `sortByRecent`. Espelha `chatReducers.ts`/`progress.ts`. |
| `mockNotificationBackend.ts` (+test) | Store in-memory + event-bus de canal único; **seed das 12 notificações** portadas do array estático atual (domains derivados dos hrefs de hoje), mix realista de read/unread. `registerPushToken` = no-op; `subscribe` = bus. **Sem chegadas sintéticas fabricadas** no app rodando — o bus é real + testado via emit interno, mas inventar push falso do servidor seria a mesma desonestidade que o Chat rejeitou com o "simulated replier". `markRead`/`markAllRead` atualizam ao vivo. `myId = 'me'`. |
| `amplifyNotificationBackend.ts` | Stub **deploy-gated** (throws; `subscribe` devolve unsub no-op), espelhando o stub do Chat. |
| `getNotificationBackend.ts` (+test) | Seletor por flag `AUTH_BACKEND`. |
| `NotificationProvider.tsx` | Espelha `ChatProvider`: `loadStatus` (idle/loading/ready/empty/error com `.then(ok,err)` — **não** `.finally`, lição do estado de erro do Chat), `notifications`, `load()`, `subscribe()` global → `applyNotification`, `markRead`, `markAllRead`, `unreadCount` derivado. **Escopo da tela** (envolve a tela de notificações) por ser rota única; içar pro app layout (badge de sino global) fica diferido pro hardening. |

### Wiring (`mobile/app/(app)/notifications.tsx` + `components/notifications/NotificationState.tsx`)

- Mantém o gate `isFeatureEnabled('notifications')` → `ProdOnlyPlaceholder`.
- Troca o array estático `NOTIFICATIONS` por `useNotifications()`.
- **loading/empty/error** via novo `NotificationState` DS-composto (espelha
  `ChatState`); erro → retry.
- **Tratamento de não-lido**: ênfase sutil por token (dot/bold) — *forma exata
  confirmada contra o Figma antes de codar*. `more_vert` segue decorativo. Ação
  **"marcar todas como lidas"** → `markAllRead()`.
- **Tap no card** → `markRead(id)` + navega via mapa `domain → rota` que **preserva a
  routing table atual**:
  `weather` → abre **WeatherAlertModal in-place** (caso especial, como hoje) ·
  `chat` → `/chat/inbox` · `reports` → `/reports` · `journey` → `/journey` ·
  `faq` → `/settings/faq`.
- **`WeatherAlertModal` + `ActiveAlertModal` ficam exatamente como estão.**

## Fluxo de dados

```
load()  → backend.listNotifications()  → setNotifications (ordenado recente-primeiro)
subscribe(cb) (montagem do provider)   → applyNotification no bus  → feed ao vivo
tap card → markRead(id) (otimista) + navega (domain→rota | weather→modal in-place)
"marcar todas" → markAllRead() (otimista)
unreadCount = derivado de notifications (read===false)
```

## Tratamento de erro

- `load()` falha → `loadStatus='error'` → `NotificationState` erro + retry (`.then(ok,err)`).
- `markRead`/`markAllRead` otimistas: atualizam o state já; swallow+log em falha
  (igual ao Chat).
- `subscribe` desinscreve no unmount.

## Testes

- `notificationReducers.test.ts` — applyNotification (inserir/dedupe/ordenar),
  markRead, markAllRead, unreadCount, sortByRecent.
- `mockNotificationBackend.test.ts` — shape do seed, list ordenada recente-primeiro,
  markRead/markAllRead persistem, subscribe emite no emit interno, registerPushToken no-op.
- `getNotificationBackend.test.ts` — seletor de flag devolve mock/amplify.
- **Gate full-branch:** jest tudo verde, mobile `tsc` 0 novos (8 baseline), backend
  `tsc --noEmit -p amplify` exit 0, `expo export --platform web` exit 0.

## Execução (3 unidades, espelhando o Chat)

- **Unit 1 — Model backend** (`Notification` em `resource.ts`) + verificar `tsc -p amplify`.
- **Unit 2 — Camada de serviço** (types, reducers+test TDD, mock+test, amplify stub,
  getBackend+test, provider).
- **Unit 3 — Wiring** (`NotificationState` + reescrita de `notifications.tsx`,
  preservando os modais).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch (merge só com OK explícito)**.

## Pendências de deploy (documentadas, não construídas)

- **Emit cross-domínio real**: relatório atribuído / tarefa atribuída / mensagem de
  chat / alerta meteorológico → criam `Notification` server-side. Diferido pro
  hardening cross-domínio.
- **SNS**: platform application (APNs/FCM) + endpoint-por-token + publish-on-create
  (Lambda/trigger); `registerPushToken` → `createPlatformEndpoint`.
- **`expo-notifications`** client (permissão + token) — diferido (opção não escolhida).
- **Persistência do push token** (model `PushToken` ou atributo Cognito) — diferido;
  não modelado nesta fatia.
- **Contrato `domain` ↔ mapa de rotas** do cliente tem que ficar em sincronia (mesmo
  risco do `conversationId` do Chat).
- **`targetId` → deep-links** a recursos específicos (`reports/[id]`, thread de chat)
  — ligados quando essas rotas aceitarem.

## Não-objetivos

Push real do SO, SNS real, emit cross-domínio, integração de alerts do admin, menu
real do `more_vert` por card, agrupamento/categorização, preferências de notificação.
