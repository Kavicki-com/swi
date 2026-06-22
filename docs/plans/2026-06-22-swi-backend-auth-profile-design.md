# SWI Backend (AWS) — Fatia 1: Auth + Perfil

**Date:** 2026-06-22
**Branch alvo:** `feat/backend-auth-profile` (novo prefixo `feat/backend-*` — ver Seção 1)
**Status:** design aprovado (segue pra plano de implementação)

## Contexto

O cliente **exige** o backend do SWI em **AWS** (requisito não-negociável). A fase
de backend foi aberta em 2026-06-19 com 6 decisões de arquitetura travadas. Este
documento desenha a **primeira fatia vertical** dessa fase: autenticação + perfil
do worker, de ponta a ponta, sobre Amplify Gen 2. As demais áreas (vitais/telemetria,
GPS, jornada, relatórios, chat, clima, rota de evacuação, ferramenta de admin) são
fatias seguintes, planejadas depois.

### Decisões de arquitetura já travadas (2026-06-19, contexto)

1. Escala: piloto, 10-50 workers, vitais amostrados a cada 1-5 min.
2. GPS: celular (`expo-location`), não a smartband.
3. Mapas: Mapbox (consistência com o admin), não Amazon Location.
4. Rota de evacuação: server-side (Lambda).
5. **health-data: editado pelo admin/saúde ocupacional; tela do worker é só leitura.**
6. Banco: DynamoDB on-demand (scale-to-zero), não Aurora.

**Princípio orientador:** custo mínimo = serverless scale-to-zero + free tiers.
**Stack:** Amplify Gen 2 (Cognito + AppSync + DynamoDB + S3 + Lambda) + SES/SNS;
Mapbox; externos clima (OpenWeather/Tomorrow.io) e CEP (ViaCEP/cep-promise). Região
sugerida `sa-east-1`.

### Decisões desta sessão de brainstorming (2026-06-22)

- **Escopo:** fatia vertical **Auth + Perfil** (não o backend inteiro de uma vez).
- **Sem conta AWS ainda** → escrevemos todo o **backend-as-code** (definição Amplify
  Gen 2) deploy-ready; o round-trip real na nuvem destrava quando a conta existir.
- **Cadastro:** **self sign-up + confirmação por e-mail** (Cognito).
- **Aprovação do admin** pós-cadastro: **adiada** (fast-follow opcional), pra manter a
  fatia pequena.
- **Abordagem A (flag):** o wiring do mobile entra atrás de um feature flag; default =
  mock (comportamento de hoje), vira `amplify` após o deploy. Sem fake local descartável.

## Seção 1 — Onde o backend mora + branch

Novo irmão na raiz, no mesmo nível de `swi-admin/` e `mobile/` (filosofia "siblings
isolados" do CLAUDE.md — package.json/lockfile/node_modules próprios):

```
swi-backend/
├─ package.json            # @aws-amplify/backend, @aws-amplify/backend-cli (ampx)
├─ amplify/
│  ├─ backend.ts           # defineBackend({ auth, data })
│  ├─ auth/resource.ts     # Cognito
│  └─ data/resource.ts     # schema DynamoDB + AppSync
└─ amplify_outputs.json    # gerado no deploy (gitignored) — config que o mobile consome
```

**Branch:** adicionar o prefixo `feat/backend-*` ao CLAUDE.md (não existia) e fazer a
fatia em `feat/backend-auth-profile`. A regra "uma branch não toca admin + mobile"
continua; backend + mobile na mesma branch é OK por ser uma feature lógica única
("ligar o auth do mobile ao backend novo"). Como o wiring precisa das telas atuais do
mobile (em andamento em `feat/mobile-login`), a branch de backend parte desse estado.

## Seção 2 — Autenticação (Cognito via `defineAuth`)

- **Login:** e-mail + senha (`loginWith: { email: true }`).
- **Self sign-up + confirmação por e-mail:** padrão do Cognito (código por e-mail). E-mail
  nativo do Cognito basta no piloto; **SES é fast-follow** quando o volume crescer.
- **Grupos:** `worker` (default no sign-up) e `admin` (atribuído manualmente no console
  por enquanto). Os grupos destravam a regra "health-data só admin edita" (Seção 3).
- **Aprovação do admin:** adiada (trigger `post-confirmation` jogando o user num grupo
  `pending`) — fora desta fatia.

## Seção 3 — Modelo de dados (DynamoDB via Amplify Data)

Dois models, separados pra honrar a decisão 5:

**`Profile`** — editado pelo próprio worker (steps 1 e 2 do complementary-data):
- step-1: `fullName`, `phone`, `cpf`, `birthDate`
- step-2: `cep`, `street`, `number`, `complement`, `neighborhood`, `city`, `uf`
- **Auth:** `allow.owner().to(['read','create','update'])` + `allow.group('admin')`.

**`HealthData`** — clínico (step-3 / settings health-data): `gender`, `height`,
`weight`, `bloodType`, `disability`.
- **Auth:** `allow.group('admin').to([crud])` + `allow.owner().to(['read'])`. Worker
  lê o próprio, não edita (decisão 5).

**Recorte da fatia:** "Perfil" aqui = `Profile` (pessoal + endereço). `HealthData` é
**definido no schema agora** (pra o modelo nascer correto), mas o **step-3 não é
conectado** nesta fatia — depende da ferramenta de admin (fatia futura). Na Fatia 1 o
step-3/health segue no mock; só login/sign-up/recovery + step-1 + step-2 ligam de verdade.

## Seção 4 — Contrato da API

Amplify Data **gera o AppSync GraphQL automaticamente** a partir do schema — sem
resolver custom nesta fatia. O mobile consome via dois SDKs do `aws-amplify`:

- **Auth** (`aws-amplify/auth`): `signUp` → `confirmSignUp` (código por e-mail) →
  `signIn` / `signOut` / `resetPassword` / `confirmResetPassword`. Cobre `login.tsx`,
  `sign-up.tsx`, `password-recovery/*` e a tela de confirmação.
- **Data** (`generateClient<Schema>()`): `client.models.Profile.get()` (= "me"),
  `.create()` / `.update()` (= salvar steps 1-2). Owner-auth garante dono-only.

Lambdas (evacuação, agregação de vitais) e subscriptions real-time são fatias seguintes.

## Seção 5 — Wiring no mobile (Abordagem A, sobre o seam existente)

O `services/auth/AuthProvider` já existe e hoje é um mock em memória (`signIn(email)`
cria um `User {id,email,name}` fake, sem senha/auth real) — é o seam exato da Abordagem A.

- **Flag** em `lib/featureFlags.ts`: `AUTH_BACKEND: 'mock' | 'amplify'` (default `'mock'`).
- **`AuthProvider` vira flag-driven.** Interface `AuthBackend` + duas implementações:
  - `mockAuthBackend` — comportamento de hoje (preserva o demo).
  - `amplifyAuthBackend` — `aws-amplify/auth` (signUp/confirm/signIn/signOut/reset/confirmReset).

  O provider escolhe pela flag; `useAuth()` segue sendo a API das telas. A superfície
  cresce (`signIn` ganha `password`; entram `signUp/confirm/reset`), tocando login.tsx,
  sign-up.tsx, password-recovery/* e a confirmação — parte esperada da fatia.
- **`ProfileProvider` novo**, mesmo padrão (mock vs `client.models.Profile`), pros steps
  1-2 (`get`=me, `create/update`=salvar).
- **`Amplify.configure(amplify_outputs.json)`** em `app/_layout.tsx`, **guardado**: só roda
  quando a flag = `amplify` e o arquivo existe. No caminho mock, nada de Amplify é
  inicializado → app roda igual a hoje.

## Seção 6 — Caminho de deploy (adiado; destrava quando a conta AWS existir)

1. Configurar credenciais (`aws configure`/SSO) — ação do usuário, interativa.
2. `cd swi-backend && npm install && npx ampx sandbox` → provisiona Cognito + DynamoDB +
   AppSync num sandbox pessoal e gera `amplify_outputs.json`.
3. Apontar `Amplify.configure` pra esse arquivo (gitignored, por-ambiente).
4. Virar a flag → `amplify`. Login/sign-up/perfil falam com a AWS real.
5. Custo ocioso ≈ **US$0** (sandbox + DynamoDB on-demand + Cognito free tier, scale-to-zero).
   Deploy de produção (`ampx pipeline-deploy`) é fatia futura — o sandbox já prova o e2e.

## Seção 7 — Testes & não-objetivos

**Testes:**
- validators/masks (puros) já cobertos; testar `mockAuthBackend` + a seleção por flag (unit).
- `amplifyAuthBackend` só é verificável após deploy → smoke manual (signUp → código →
  signIn → salvar perfil).
- `tsc` no `swi-backend` garante que o schema compila.

**Não-objetivos desta fatia:** vitais/telemetria, GPS, jornada, relatórios, chat, clima,
Lambda de evacuação, ferramenta de admin, wiring do step-3/`HealthData`, SES,
aprovação-do-admin, deploy de produção, integração com o swi-admin.

## Fatias futuras (ordem provável)

2. Ferramenta de admin + wiring do `HealthData`/step-3 (destrava a decisão 5 completa).
3. Telemetria de vitais + GPS (batch→DynamoDB+TTL — maior driver de custo).
4. Jornada + relatórios + chat (com S3 pra mídia e subscriptions real-time).
5. Clima (externo) + rota de evacuação (Lambda server-side).
6. Hardening: SES, aprovação-do-admin, deploy de produção, integração com o swi-admin.
