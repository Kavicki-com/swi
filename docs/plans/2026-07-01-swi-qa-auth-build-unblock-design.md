# Design — Destravar a build de QA do vertical de auth (SWI)

**Data:** 2026-07-01
**Branch alvo:** nova `feat/backend-qa-auth-build` a partir de `feat/mobile-login`
**Status:** aprovado (brainstorming) — aguardando plano + luz verde de commit

---

## 1. Contexto e objetivo

O vertical de auth (NestJS + Postgres + Prisma conteinerizado) foi entregue e mergeado em
`feat/mobile-login @ 2c25c2c`, mas roda **só localmente** (`docker compose up`, `localhost:3000`) e
**só o auth** está ligado no backend real via o seam (`apiAuthBackend`). Os outros 9 domínios
(profile, vitals, reports, journey, chat, notifications, weather, evacuation, telemetry) continuam
em mock/stub-Amplify-morto.

**Objetivo desta fatia:** cortar uma **build de developer (APK) que o time de QA instala e usa pra
validar o fluxo de auth de ponta a ponta contra o backend real**, sem deploy AWS — no modelo local-first
(Docker local + túnel). QA remoto, em qualquer rede.

**Escopo do QA (decidido):** fluxo **completo** — signup → código por e-mail → confirmação → login →
gate de aprovação → reset de senha — **mais admin aprova/rejeita** um worker recém-cadastrado.

## 2. Dois eixos independentes (o modelo mental)

- **Alcançabilidade** (o device do QA chega no Docker?) → resolvido com **túnel** (`ngrok`/`cloudflared`).
  Não exige AWS. É o loop local-first.
- **Cobertura** (quanto do app fala com o real?) → hoje **só auth**. Esta fatia liga apenas o auth de
  forma limpa; ampliar cobertura é o roadmap de fatias seguintes.

## 3. Decisões

| # | Decisão | Escolha | Porquê |
|---|---|---|---|
| 1 | Como o QA alcança o backend | **Túnel** (ngrok domínio estático p/ API; túnel efêmero p/ MailHog) | QA remoto; URL da API precisa ser estável (grava no APK); sem AWS |
| 2 | Escopo do auth | **Fluxo completo + admin aprova/rejeita** | Cobre o que o QA precisa revisar |
| 3 | Como separar auth do resto no seam | **Chave própria `AUTH_BACKEND`** (Opção 1) | Menor superfície (2 arquivos), nome honesto, risco zero pros 9 domínios; mapa-por-domínio (Opção 3) fica pra quando a 2ª fatia real chegar |
| 4 | E-mail | **MailHog exposto via túnel** | Fluxo completo exige o código; sem inbox real ainda (SES é passo de produção) |
| 5 | Segurança pra expor | **JWT secret real via `.env` + throttle leve em `/auth/*`** | Mínimo pra abrir um túnel pro mundo; hardening completo fica pro pass pré-produção |

## 4. Arquitetura da mudança (7 peças)

### A. Seam — chave própria do auth
- `mobile/lib/featureFlags.ts`: adiciona `export type AuthBackendKind = 'mock' | 'api'` e
  `export const AUTH_BACKEND: AuthBackendKind = (process.env.EXPO_PUBLIC_AUTH_BACKEND as AuthBackendKind) ?? 'mock'`.
- `mobile/services/auth/getAuthBackend.ts`: passa a usar `AUTH_BACKEND === 'api' ? apiAuthBackend : mockAuthBackend`.
- `DATA_BACKEND` e os outros 9 `getXBackend.ts` **não mudam** (continuam mock).
- Atualiza `getAuthBackend.test.ts` (mocka a flag nova).

### B. Perfil de build `qa` (`mobile/eas.json`)
- Novo perfil `qa` herdando o padrão do `preview` (APK, `distribution: internal`), com `env`:
  - `EXPO_PUBLIC_AUTH_BACKEND: "api"`
  - `EXPO_PUBLIC_API_URL: "https://<dominio-estatico>.ngrok-free.app"` (gravado uma vez).

### C. Alcance via túnel
- **API (estável):** `ngrok http 3000 --domain=<seu>.ngrok-free.app` → URL fixa no APK.
- **MailHog (efêmero):** túnel separado da porta 8025; a URL é passada pro QA no início da sessão.
- Backend continua `docker compose up` sem alteração de topologia.

### D. Descoberta pra aprovação (fecha o gap do "admin aprova")
Hoje `POST /users/:id/approve` exige o **id** e não há como o admin descobri-lo sem tocar o banco. Adiciona o mínimo:
- `GET /users/pending` — guard `JwtAuthGuard` + `RolesGuard @Roles('ADMIN')` — retorna
  `[{ id, email, name, createdAt }]` dos `approvalStatus = 'PENDING'`.
- `POST /users/:id/reject` — mesmo guard — seta `approvalStatus = 'REJECTED'` (o escopo é aprovar **e** rejeitar).
- `UsersService`: `listPending()` e `reject(id)` (espelham o `approve(id)` existente, com `NotFoundException`).
- É o embrião da futura tela de aprovação no swi-admin.

### E. Hardening mínimo
- `docker-compose.yml`: `JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}` (exige env, sem fallback fixo);
  `.env.example` documenta gerar um segredo forte.
- `@nestjs/throttler`: throttle global leve (ex.: 10 req / 60s por IP) mirando abuso em `/auth/*`.
- **Fora de escopo (pass pré-produção):** timing-oracle de enumeração, `Math.random`→`crypto.randomInt`,
  bcrypt 10→12, reenviar-código, remover fallback de `JWT_SECRET` no código da app.

### F. Runbook (`docs/` ou README do swi-backend)
- **Pra o dev:** subir docker → subir os 2 túneis → `eas build --profile qa` → distribuir o APK.
- **Pra o QA:** instalar APK; credenciais seedadas (`worker@swi.local`/`worker123` aprovado,
  `admin@swi.local`/`admin123`); como pegar o código no link do MailHog; como o admin lista pendentes
  e aprova/rejeita. Troubleshooting (túnel caiu, URL trocou, etc.).

### G. Verificação
- **Backend:** `npm run build` + `npx jest` (unit, incl. novos `listPending`/`reject`) + `test:e2e` +
  **docker smoke** com os endpoints novos + **smoke manual pela URL do túnel** (prova o atravessamento de fora).
- **Mobile:** `tsc --noEmit` no baseline (8), `jest` (com o teste do seam novo), `expo export --platform web` exit 0.

## 5. O que eu faço vs. o que precisa de você
- **Automatizável nesta sessão:** A, B (config), D, E, F, G, design + plano.
- **Precisa de você (contas):** rodar `ngrok`/túnel e `eas build --profile qa` — comandos entregues no runbook.

## 6. Regras do projeto respeitadas
- Branch `feat/backend-*` (pode tocar `mobile/` ao fiar o app no backend); **não toca `swi-admin/`**.
- DS não exercitado (sem UI nova). Commit só com luz verde explícita.

## 7. Não-objetivos (YAGNI)
- Deploy AWS (ECS/RDS/SES), UI de aprovação no swi-admin, migrar os 9 domínios restantes, MinIO→S3,
  rename global `DATA_BACKEND`→`api`. Tudo roadmap posterior.
