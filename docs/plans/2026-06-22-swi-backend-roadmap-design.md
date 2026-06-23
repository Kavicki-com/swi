# SWI Backend (AWS) — Roadmap do restante do backend (pós-pivô 2026-06-22)

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Macro-roadmap; cada fatia tem seu
> próprio `*-design.md` + `*-plan.md`.

## O pivô (decisão do usuário, 2026-06-22)

Os **dados de saúde só existem quando o cliente comprar a smartband** — é coisa
futura. Então:

- **Tudo de saúde fica MOCK** até a smartband chegar: vitais (`VitalsSample`/
  `LocationSample`, já mock na Fatia 3) **e** o `HealthData` clínico (tipo
  sanguíneo, alergias, exames, gênero, peso, PcD; telas `complimentary-data/
  step-3` e `settings/health-data`). Lançamos em produção com saúde mockada;
  ela "acende" quando a smartband for integrada.
- **Construir o backend REAL de todo o resto** (não-saúde): relatórios, jornada,
  chat, notificações, clima, rota de evacuação, + a integração com o swi-admin.
- A **Fatia 2 registrada** (ferramenta de admin + wiring `HealthData`/step-3)
  fica **ABORTADA** nesta rodada — não faz sentido ligar no backend real algo que
  é mock-até-smartband.

## Princípios herdados (mantidos)

- **Abordagem A, deploy-gated:** backend-as-code em `swi-backend/` + camadas
  `mock`/`amplify` atrás de flag nos `services/*` do mobile; `tsc` + `jest`
  verdes; **deploy real travado até existir conta AWS** (custo R$0 agora).
- **Regra de branch:** uma branch **não** toca `swi-admin/` + `mobile/` juntos.
  Domínios compartilhados → modelo único no `swi-backend`, wiring de cada app em
  branch separada.
- **DS sempre** (`@kavicki/swi-design-system`), tokens via `useTheme()`.
- **Commit só com aprovação explícita** do usuário.

## Estado atual (em `feat/mobile-login`)

- **Fatia 1** — Auth + Perfil (Cognito + `Profile`/`HealthData`) — mock-path, mergeada.
- **Fatia 3** — Vitais + GPS — mock-path, mergeada (e **fica mock** pelo pivô).
- **Relatórios** — `Report` + S3 + `services/reports` + wiring — mock-path,
  **mergeada** em `feat/mobile-login` (FF, `a6b62e9..f3b46f9`).
- **Jornada/Tarefas** — `Journey` + `Task` + S3 (`swiMedia`) + `services/journey`
  (`progress.ts` puro + mock/amplify + provider) + wiring — mock-path,
  IMPLEMENTADA em `feat/backend-jornada` (jest 56/56, tsc 0 novos, backend tsc
  `-p amplify` exit 0, expo export web OK; two-gate por unidade + review holística:
  C1 [barra de progresso lia snapshot stale na tela de detalhe] achada e corrigida,
  pronta). Merge pra `feat/mobile-login` aguardando OK do usuário.
- **Chat** — `Conversation` + `Message` + `Contact` + S3 (`swiMedia`, prefixo
  `chat/`) + `services/chat` (`chatReducers.ts` puro + mock event-bus/amplify stub
  + `ChatProvider`) + wiring (inbox/[userId]) — mock-path, **real-time** via seam
  `subscribe()`. IMPLEMENTADA em `feat/backend-chat` (jest 74/74, tsc 0 novos,
  backend tsc `-p amplify` exit 0, expo export web OK; two-gate por unidade +
  review holística: 3 achados [conversa lazy sumindo do inbox, 1ª msg não anexada,
  thread sem estado de erro] corrigidos, ready). Merge pra `feat/mobile-login`
  aguardando OK do usuário.

## Mapa dos domínios não-saúde (estado hoje)

| Domínio | Mobile (worker) | swi-admin | Fonte de dados hoje | Infra nova |
| --- | --- | --- | --- | --- |
| Relatórios | index/new/[id]/responsibles | ReportsList/Details/New | mobile arrays inline; admin `mockApi/reports` | **S3** (mídia) |
| Jornada/Tarefas | journey/index, task/[id] (+ `JourneyProvider`) | — | `lib/journeyMockData.ts` + provider | S3 (fotos) |
| Chat | inbox/[userId]/user-info | ChatInbox | arrays inline; admin `mockApi/chats` | **AppSync subscriptions** |
| Notificações | notifications.tsx (+ 2 modais) | monitoring/alerts (papel similar) | array inline | **SNS** (push) |
| Clima | map-weather | MapsGeneral/Alerts/Monitoring | `lib/mapMockData.ts` | **Lambda** + API externa |
| Evacuação | evacuation, evacuation-ongoing | AlertsRescueRoute | `lib/mapMockData.ts` + OSRM | **Lambda** (rota server-side) |

Observações:
- **swi-admin já tem camada de serviço** (`src/services/mockApi/*`) — esse é o
  ponto limpo de integração: trocar `mockApi` → cliente Amplify (no hardening).
- **mobile quase não tem abstração** (só `journey`): cada domínio ganha um
  `services/<domínio>` espelhando o padrão da Fatia 1 (`profile/`).
- **alerts/monitoring no admin são movidos por vitais (saúde)** → a *geração* de
  alerta a partir de vitais fica **mock**; só a plumbing fica real.

## Sequência (incremental, uma fatia pequena por domínio)

1. ✅ **Relatórios** (IMPLEMENTADA mock-path, `feat/backend-reports`) — `Report` +
   mídia **S3** + responsibles; `services/reports` + wiring (index/new/[id]);
   estados loading/empty/error. → `*-reports-design.md` / `*-reports-plan.md`.
2. ✅ **Jornada/Tarefas** (IMPLEMENTADA mock-path, `feat/backend-jornada`) —
   `Journey` (turno) + `Task` (atribuída ao worker) + estado/progresso **reais**
   (âncoras de tempo + tick no cliente) + fotos **S3**; `progress.ts` puro +
   `services/journey` (mock/amplify) + provider refatorado + wiring (index/[id]);
   estados loading/empty/error. → `*-jornada-design.md` / `*-jornada-plan.md`.
3. ✅ **Chat** (IMPLEMENTADA mock-path, `feat/backend-chat`) — `Conversation` +
   `Message` + `Contact` (diretório) + **real-time** via seam `subscribe()` +
   event-bus no mock (amplify stub deploy-gated); `chatReducers.ts` puro +
   `services/chat` (mock/amplify) + `ChatProvider` + wiring (inbox/[userId]) +
   anexo S3 (prefixo `chat/`) + criação lazy + estados loading/empty/error.
   Auth participant-scoped (`ownersDefinedIn('participants')`). jest 74/74, tsc 0
   novos, backend tsc -p amplify exit 0, expo export web OK; two-gate + holística =
   ready. Merge pra `feat/mobile-login` aguardando OK. →
   `*-chat-design.md` / `*-chat-plan.md`.
4. **Notificações** — `Notification` + push **SNS**; `services/notifications` + wiring.
5. **Clima** — **Lambda** → API externa (OpenWeather/Tomorrow.io) → dados de
   heatmap/alerta; `services/weather` + map-weather.
6. **Evacuação** — **Lambda** server-side de rota; `services/evacuation` + wiring.
7. **Hardening + integração admin** — trocar `mockApi` do swi-admin → cliente
   Amplify (branches `feat/admin-*` por domínio), SES, aprovação-do-admin,
   deploy de produção, generalizar a flag `AUTH_BACKEND` → switch global.

## Não-objetivos do roadmap

- Reativar saúde real (smartband/BLE/vitais reais) — futuro, fora desta fase.
- Deploy de produção antes de existir conta AWS.
- Misturar `swi-admin` + `mobile` numa branch só.
