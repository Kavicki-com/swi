# SWI Backend — Migração dos domínios não-saúde pro container (design da rodada)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Sucede o roadmap Amplify
> (`2026-06-22-swi-backend-roadmap-design.md`, superado pelo pivô) e estende o
> pivô containerizado (`2026-07-01-swi-backend-container-pivot-design.md`) pros
> domínios restantes.

## Contexto

O vertical de auth já roda **real** no container (NestJS + Prisma + Postgres +
MailHog; branch `feat/backend-qa-auth-build`, 11 commits, não integrada ainda).
Decisão do usuário (2026-07-02): **introduzir o backend real em todas as telas,
exceto saúde/vitals e o que depende da API da smartwatch** — funcional e testado
local no Docker, pronto pra **só deployar** em AWS (ECS/Fargate + RDS) depois.

O lado mobile está adiantado: os 7 domínios têm seam `mock|amplify`, providers,
reducers puros testados e telas com estados loading/empty/error (fatias de
junho, era Amplify — hoje referência read-only em `swi-backend/amplify/`).
O trabalho novo é o lado servidor + trocar o stub `amplify*Backend` por um
cliente REST `api*Backend` por domínio (padrão do `apiAuthBackend`).

## Decisões (2026-07-02)

| Tema | Decisão |
| --- | --- |
| **Escopo** | 7 domínios: **perfil, relatórios, jornada/tarefas, chat, notificações, clima, evacuação**. Auth já feito. |
| **Fora (mock permanente até smartband)** | vitals, health-data (step-3 + settings), telemetria de amostras (VitalsSample/LocationSample — alimentam monitoramento admin, vitals-driven) |
| **Abordagem** | **A com schema fundacional**: Fatia 0 desenha o schema Prisma dos 7 domínios de uma vez (consistência da B); fatias seguintes = módulo Nest + wiring por domínio com verificação real a cada passo |
| **Real-time (chat/notif)** | **WebSocket gateway** no Nest (socket.io, JWT no handshake) — seam `subscribe()` do mobile já é subscription-shaped |
| **Mídia (fotos reports / anexos chat)** | **MinIO no compose** (S3-compatible; em AWS vira S3 sem mudar código), presigned URLs |
| **APIs externas** | Passthrough no Nest: clima=OpenWeather, evacuação=Mapbox Directions; chave via `.env`; **sem chave → snapshot canned** (wiring real desde já, chaves plugam depois) |
| **Flag** | `DATA_BACKEND` deixa de ser const hardcoded → lê `EXPO_PUBLIC_DATA_BACKEND` (`'mock'|'api'`); rename do valor `'amplify'`→`'api'` no seam inteiro; **selector de cada domínio só honra `'api'` quando sua fatia migrar**; selectors de saúde ignoram a flag pra sempre (carve-out) |
| **Critério de aceite da rodada** | **Zero mock fora de saúde/smartband** com `EXPO_PUBLIC_DATA_BACKEND=api` + `EXPO_PUBLIC_AUTH_BACKEND=api`; APK de QA final corta com tudo real |

## Sequência de fatias (1 branch/PR por fatia, padrão `feat/backend-*`)

| # | Fatia | Infra que entra junto |
| --- | --- | --- |
| 0 | **Fundação**: schema Prisma completo (migration única) + `DATA_BACKEND` env-driven + rename `'amplify'`→`'api'` | — |
| 1 | **Perfil** (menor; funda identidade `user.id` pros demais; tela user-info sai do adiamento na parte não-saúde) | — |
| 2 | **Relatórios** (CRUD + mídia) | MinIO + módulo de mídia (presigned URLs) |
| 3 | **Jornada/Tarefas** (âncoras de tempo persistidas; tasks seedadas — sem UI admin) | — |
| 4 | **Chat** (threads, mensagens, diretório = Users reais aprovados; `myId` = `user.id` do JWT) | WebSocket gateway + prefixo `chat/` na mídia |
| 5 | **Notificações** (feed + emits cross-domain server-side: report/task/chat/clima → cria Notification) | reusa o gateway |
| 6 | **Clima** (passthrough OpenWeather + fallback canned) | — |
| 7 | **Evacuação** (passthrough Mapbox + fallback canned) | — |

**Pré-requisito:** integrar `feat/backend-qa-auth-build` (push + PR + merge) —
as fatias constroem sobre o container de auth.

## Arquitetura

- **Compose** ganha `minio` (fatia 2). Demais serviços intactos (db, mailhog, api).
- **Nest**: um módulo por domínio (`src/profile/`, `src/reports/`, `src/journey/`,
  `src/chat/`, `src/notifications/`, `src/weather/`, `src/route/`), espelhando
  `src/auth/`+`src/users/`: controller → guard (JWT/Roles) → service → Prisma.
  Gateway WS em `src/realtime/` (chat + notificações num gateway só).
- **Modelos Prisma** (shape-fonte: `swi-backend/amplify/data/resource.ts`,
  referência read-only): `Profile` (1:1 User), `Report`, `Journey`, `Task`
  (assignedTo → User), `Conversation`, `Message`, `Notification`. `Contact`
  do Amplify **morre** — diretório vira query sobre Users aprovados. Clima e
  evacuação **sem model** (passthrough), cache é pendência de deploy.
- **Mobile**: por domínio, `amplify*Backend.ts` → `api*Backend.ts` (fetch +
  `Bearer` via `expo-secure-store`, base `EXPO_PUBLIC_API_URL`), selector
  honra `'api'`; providers/reducers/telas **intocados** (o seam absorve, como
  no auth). Real-time: cliente socket.io-client atrás do mesmo seam `subscribe()`.
- **Erros**: corpo consistente `{statusCode, message, reason?}` (padrão do auth);
  `api*Backend` relança com as mensagens que as telas já exibem.

## Testes + verificação (por fatia, disciplina das rodadas anteriores)

- Backend: unit (Prisma mockado) + e2e (supertest vs Postgres real) + **docker
  smoke** (lição: tsc/jest verdes não provam o container).
- Mobile: jest (reducers/selectors/api client com fetch mockado), tsc 0 novos
  (8 baseline), expo export web exit 0.
- Two-gate (spec + quality) por unidade + review holística por fatia; commit
  por task **só com luz verde explícita** do usuário.
- Teste manual do usuário por fatia no **dev build** (`EXPO_PUBLIC_DATA_BACKEND=api`
  no `.env` do Metro — sem rebuild).

## Não-objetivos da rodada

- Saúde inteira (vitals, health-data, telemetria) — mock até a smartband.
- Push de SO (`expo-notifications`/SNS) — seam `registerPushToken` segue no-op.
- UI de aprovação/admin no swi-admin (branches `feat/admin-*`, Figma, depois).
- Integração do swi-admin com a API (mesma regra — rodada própria).
- Deploy AWS (ECS/RDS/SES/S3/secrets) — pendência mapeada, pós-testes.

## Pendências de deploy (herdadas + novas)

- ECS/Fargate + RDS + ALB/HTTPS; MailHog→SES; MinIO→S3; secrets via SSM.
- Chaves reais OpenWeather (One Call 3.0) e Mapbox (contas do usuário).
- Túnel ngrok (QA) → domínio real.
- Remover `swi-backend/amplify/` quando a paridade fechar (fim desta rodada).
