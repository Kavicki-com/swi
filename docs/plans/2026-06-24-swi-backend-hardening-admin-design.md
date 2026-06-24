# SWI Backend (AWS) — Fatia 7: Hardening + integração admin (design)

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Esta é a **fatia 7** (a última) do roadmap
> pós-pivô (`2026-06-22-swi-backend-roadmap-design.md`), depois de Relatórios,
> Jornada, Chat, Notificações, Clima e Evacuação.

## Contexto

Última fatia do backend AWS, **Abordagem A, deploy-gated**: backend-as-code em
`swi-backend/` + camadas `mock`/`amplify` atrás de flag nos `services/*`; `tsc` +
`jest` verdes; **deploy real travado até existir conta AWS** (custo R$0 agora).

Diferente das 6 fatias anteriores, a Fatia 7 **não é um domínio** — é um *basket*
de hardening que **cruza para o `swi-admin/`** e é a parte que mais depende de
deploy real. Por isso ela vira um **sub-roadmap de 3 branches sequenciais**, cada
uma um PR separado, respeitando a regra "uma branch não toca `swi-admin/` +
`mobile/` juntos".

Decisões do usuário nesta sessão (2026-06-24): **escopo = basket completo (A+B+C)**;
**ordem = B → A → C**.

## Estado atual (medido)

- **Flag global do mobile:** `AUTH_BACKEND: 'mock' | 'amplify'` em
  `mobile/lib/featureFlags.ts` já é o switch único lido por **todos** os domínios.
  Consumidores (medidos): **10 selectors** `services/*/get*Backend.ts` (auth,
  profile, vitals, reports, journey, chat, notifications, weather, evacuation,
  telemetry) + `services/amplify/configure.ts` + **4 telas** `(auth)/*` + **~9
  `jest.mock` factories**. O nome `AUTH_BACKEND` é legado da Fatia 1 (era só auth) —
  hoje é domain-neutral de fato, só não de nome.
- **`swi-admin` não tem abstração:** as páginas importam `mockApi/*` **direto**
  (`import { reportsApi } from '@/services/mockApi/reports'`, etc.). Domínios:
  `auth, admins, chats, dashboard, employees, monitoring, reports, rescue, roster`.
  Esse import direto é o ponto a refatorar.
- **Não existe conceito de aprovação:** `authApi.signUp` cria o admin e **loga
  direto** (sem gate). O `status: 'accept'|'pending'|'canceled'` em `admins.ts` é
  **status de saúde** ("Alerta de fadiga"), não aprovação — vitais-driven, fica mock.

## Decomposição (3 branches, mock default + deploy gated em todas)

| # | Branch | App | Entrega | Verificável em mock |
| --- | --- | --- | --- | --- |
| **B** | `feat/mobile-data-backend-flag` | `mobile/` | `AUTH_BACKEND` → `DATA_BACKEND` (flag global domain-neutral) | ✅ total |
| **A** | `feat/admin-backend-seam` | `swi-admin/` | seam `services/<domínio>` (mock default + amplify gated), repointar páginas | ✅ alto |
| **C** | `feat/backend-admin-approval` | `swi-backend/` (+UI) | SES-as-code + fluxo de aprovação (net-new) | ⚠️ baixo (deploy-bound) |

- **D — deploy de produção:** hard-blocked até existir conta AWS. **Não
  implementável agora**; registrado como pendência de deploy.
- **Esta sessão implementa só a B.** A e C ganham seu próprio `*-design.md` /
  `*-plan.md` quando chegarmos neles (igual ao padrão das fatias anteriores).

---

## Branch B — `DATA_BACKEND` (detalhada; implementada nesta sessão)

**O quê:** renomear o flag `AUTH_BACKEND` → **`DATA_BACKEND`** (e o tipo
`AuthBackendKind` → `DataBackendKind`), generalizando o comentário. **Rename puro,
zero mudança de comportamento** — valores seguem `'mock' | 'amplify'`, default
`'mock'`.

**Por quê:** o nome `AUTH_BACKEND` mente — ele já governa 10 domínios, não só auth.
A Fatia 7 é "hardening"; deixar o switch global com nome correto é o item mais
barato e self-contained, e fecha a arquitetura do mobile antes de espelhá-la no admin.

**Blast radius (medido, em lockstep):**

- `mobile/lib/featureFlags.ts` — `export const AUTH_BACKEND` → `DATA_BACKEND`;
  `type AuthBackendKind` → `DataBackendKind`; comentário "auth/profile data source"
  → "fonte de dados de todos os domínios".
- **10 selectors** `services/*/get*Backend.ts` — trocar import + uso.
- `services/amplify/configure.ts` — idem.
- **4 telas** `(auth)/account-confirmation.tsx`, `(auth)/email-sent.tsx`,
  `(auth)/password-recovery/new-password.tsx`, `(auth)/password-recovery/email.tsx`
  (+ comentário em `password-recovery/email-sent.tsx`).
- **~9 `jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock', ... }))`** —
  renomear a **chave** em cada factory, senão o selector lê `undefined` e cai sempre
  no mock por acidente (mascara regressão). Crítico: renomear chave + uso juntos.

**Não-objetivos da B:** não introduzir runtime override (env var) — segue const
editada à mão como hoje; não mexer nas `*_SCENARIO` (ficam como estão).

**Verificação:** `cd mobile` → `npx jest` (alvo = baseline 107/107), `npx tsc
--noEmit` (8 baseline / **0 novos**), `npx expo export --platform web` exit 0.

---

## Branch A — seam do `swi-admin` (altitude de roadmap; design completo depois)

Espelhar o padrão do mobile: cada domínio ganha `swi-admin/src/services/<domínio>/`
com selector `mock`(default)`|amplify` atrás de um `DATA_BACKEND` próprio do admin
(ambiente Vite — `import.meta.env` ou const), e as páginas param de importar
`mockApi/*` direto.

**Cobertura por domínio (decisão herdada do pivô):**

- **Real-backed** (têm model no `swi-backend`) → ganham caminho amplify de verdade:
  `auth`→Cognito, `reports`→`Report`, `chats`→`Conversation/Message`,
  `employees`/`admins`→`Profile`.
- **Vitais/saúde-driven** → o seam existe mas o "amplify path" é **mock declarado**
  (mock-até-smartband, pelo pivô): `dashboard`, `monitoring`, `rescue`-candidates,
  `roster`. A *geração* de alerta a partir de vitais fica mock; só a plumbing fica real.

**Risco a investigar no design da A:** trazer `aws-amplify`/`generateClient<Schema>`
pro bundle Vite do admin (cf. blocker DS↔Vite registrado na memória — verificar se
afeta o cliente Amplify, provavelmente não, é ESM-friendly).

---

## Branch C — SES + aprovação-do-admin (altitude de roadmap; design completo depois)

**Net-new** e o mais deploy-bound. Hoje `signUp` cria admin e loga direto. C
introduz: signup → estado **pending** → admin aprova (na lista de admins) → **SES**
dispara o email de aprovação/boas-vindas. SES-as-code (resource definition) é
pequeno; o envio real e o end-to-end **só rodam pós-deploy** → menor valor
verificável em mock, por isso é a última.

---

## Transversais

- **Regra de branch:** B=`feat/mobile-*`, A=`feat/admin-*`, C=`feat/backend-*` —
  **nunca** misturando `swi-admin/` + `mobile/` numa branch.
- **DS obrigatório** em qualquer UI nova da C (`@kavicki/swi-design-system`, tokens
  via `useTheme()`).
- **Commit só com OK explícito** do usuário. Deploy continua R$0/gated.
- **Apps isolados:** mobile e admin têm cada um seu `DATA_BACKEND` (sem código
  compartilhado entre eles; o model compartilhado vive no `swi-backend`).

## Pendências de deploy (quando existir conta AWS)

- Branch A: `amplify_outputs` real, flip do `DATA_BACKEND` do admin → `amplify`,
  smoke das telas real-backed.
- Branch C: identidade/domínio verificados no SES, template do email, fluxo de
  aprovação end-to-end.
- Branch D: deploy de produção (build, ambiente, cutover do mock → amplify nos 2 apps).
