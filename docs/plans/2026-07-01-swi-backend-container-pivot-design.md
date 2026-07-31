# SWI Backend — Pivô para stack conteinerizada (Docker → AWS) — design

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Marca um **pivô de arquitetura**: sai o Amplify
> Gen 2 (as-code, deploy-gated, nunca rodou) e entra um backend **conteinerizado**
> que roda local no Docker e deploya em AWS depois — o modelo local-first do estúdio.

## Contexto — por que o pivô

Até aqui o "backend" era **Amplify Gen 2, Abordagem A deploy-gated**: código em
`swi-backend/amplify/` (models/auth/Lambdas) + camadas `mock`/`amplify` atrás de flag
nos `services/*`, `tsc`+`jest` verdes, mas **nunca deployado** (sem conta AWS, R$0).
O app roda 100% em **mocks em memória**; nada de banco, servidor ou nuvem.

O usuário questionou (2026-06-30/07-01): *"esse backend é real? em outro projeto usamos Docker
local, aqui nunca vi. Quero com Docker local — como assim vai divergir?"*. A resposta
honesta:

- **"Local no Docker → deploya depois" é o jeito normal e correto** — e funciona
  como no modelo local-first **quando o backend é um servidor portável** (Node + Postgres): os
  mesmos containers rodam local e em produção.
- **Amplify Gen 2 não é um servidor** — é uma declaração que provisiona **serviços
  gerenciados AWS** (Cognito/AppSync/DynamoDB/Lambda). Não existe "imagem Docker do
  Cognito". Dá pra emular com LocalStack, mas a fidelidade é fraca justamente nas
  partes proprietárias que o schema usa (regras de auth, subscriptions, triggers) →
  "passa local" não prova a nuvem. **Essa** era a divergência. (Amplify **Gen 2**
  removeu o mock local que o Gen 1 tinha; fluxo oficial é sandbox **na nuvem**.)
- **O ponto que destrava:** o cliente exige **AWS**, mas **AWS ≠ Amplify**. Amplify
  foi recomendação nossa, não exigência. Um stack conteinerizado em **AWS ECS/Fargate
  + RDS** é AWS do mesmo jeito — só usa compute/containers em vez de serverless-
  gerenciado. Esse modelo é 100% viável e honra "cliente quer AWS".

**Custo do pivô:** joga fora os ~11 models as-code do `swi-backend/amplify/` (viram
schema SQL + servidor) e passamos a ser donos de auth e real-time (Cognito/AppSync
davam de graça). **Mantém:** todo o `mobile/services/*` (mock + selector + providers)
— o **seam `mock|amplify`** já é a costura; o caminho não-mock só passa a ser "nossa
API em container".

## Decisões desta sessão (2026-07-01)

| Tema | Decisão |
| --- | --- |
| **Stack** | **NestJS + PostgreSQL + Prisma** (TypeScript — uma linguagem no projeto inteiro) |
| **Escopo da rodada** | **Fundação + vertical de auth** (não big-bang; demais domínios em fatias) |
| **Fidelidade do auth** | **Real com MailHog** — signup/login/JWT + confirmação de e-mail + reset de senha |
| **Gate de aprovação** | **Incluído agora** (o que era a branch C nasce dentro do auth real) |
| **Estilo da API** | **REST + JWT** (mapeia 1:1 o mobile; GraphQL/tRPC descartados) |

---

## 1. Arquitetura & topologia

**Onde mora:** `swi-backend/` é **repropositado** para o projeto NestJS. O `amplify/`
atual fica **retido como referência read-only** (documenta o schema-alvo dos domínios
ainda não migrados; excluído do build do Nest; removido no fim da migração). O
`package.json` do Amplify é substituído pelo do Nest.

```
swi-backend/
  docker-compose.yml      # db + mailhog + api
  Dockerfile              # imagem da API Nest
  .env.example
  package.json            # Nest (substitui o do Amplify)
  tsconfig.json
  prisma/
    schema.prisma         # model User (domínios futuros aqui)
    migrations/
    seed.ts               # admin + worker-demo aprovado
  src/
    main.ts · app.module.ts
    prisma/               # PrismaModule + PrismaService
    auth/                 # module · controller · service · guards (JWT/Roles) · dto
    mail/                 # MailService (nodemailer → MailHog)
    users/                # UsersModule + service
  test/                   # e2e (supertest)
  amplify/                # RETIDO: referência read-only, não buildado
```

**docker-compose (o loop local-first):**

| serviço | imagem | portas | papel |
| --- | --- | --- | --- |
| `db` | `postgres:16` | 5432 | banco (volume) |
| `mailhog` | `mailhog/mailhog` | 1025 SMTP · **8025 UI** | catcher — e-mail visível em `localhost:8025` |
| `api` | build do `Dockerfile` | 3000 | API Nest, `depends_on` db+mailhog |

Loop local: `cd swi-backend && docker compose up` → API `localhost:3000`, e-mail
`localhost:8025`, Postgres `5432`. **Roda de verdade, offline, sem conta AWS.**

**Conexão do mobile:** o caminho não-mock do seam de auth vira um **cliente REST**
apontando pro `localhost:3000` (config via `EXPO_PUBLIC_API_URL`; notas de `10.0.2.2`
no emulador Android / IP da LAN em device físico). O **valor** da flag `DATA_BACKEND`
segue `'amplify'` nesta rodada (renomear `'amplify'`→`'api'` no seam inteiro = follow-up).

**Regra de branch:** `feat/backend-container-auth` toca `swi-backend/` + `mobile/`
(permitido pra `feat/backend-*` no wiring) — **nunca `swi-admin/`**.

## 2. Modelo de dados + semântica de auth/aprovação

```prisma
enum Role           { WORKER  ADMIN }
enum ApprovalStatus { PENDING APPROVED REJECTED }

model User {
  id             String   @id @default(uuid())   // identidade (substitui o Cognito `sub`)
  email          String   @unique
  passwordHash   String                           // bcrypt — nunca a senha crua
  name           String
  role           Role           @default(WORKER)
  emailVerified  Boolean        @default(false)
  approvalStatus ApprovalStatus @default(PENDING)

  confirmationCodeHash String?                     // código efêmero: hash + expiração
  confirmationExpires  DateTime?
  resetCodeHash        String?
  resetExpires         DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Gate de login = 2 portas:** só emite JWT se **`emailVerified = true` E
`approvalStatus = APPROVED`**. Senão, **403** com `reason` distinto:
- e-mail não confirmado → `"Confirme seu e-mail antes de entrar"`
- `PENDING`/`REJECTED` → `"Sua conta está aguardando aprovação do administrador"`

**Ciclo do worker:** signup (WORKER, não-verif., PENDING, gera código) → e-mail no
MailHog → confirm (verifica → `emailVerified=true`, ainda PENDING) → **admin aprova**
→ login libera.

**Ator admin (sem UI, sem tocar swi-admin):**
- **Seed** de um admin (`prisma/seed.ts`) — existe quem aprova; login de admin já funciona.
- `POST /users/:id/approve` protegido por **RolesGuard(ADMIN)**. Testável via seed/endpoint;
  a **fila de aprovação no swi-admin = futuro + Figma**.
- Um **worker-demo** entra seedado **APPROVED**+verificado (não quebra o login de demo);
  cadastros novos nascem PENDING.

**Identidade:** JWT carrega `{ sub: user.id, role }`. Onde o mobile usa o Cognito `sub`
como `workerId`/`assignedTo`, as fatias futuras passam a usar `user.id`. Nesta rodada
(só auth) não morde ninguém.

**Segredos:** senha via bcrypt; códigos de confirmação/reset como **hash + expiração**
(não texto puro), invalidados no uso.

## 3. Superfície REST + fluxo de dados

| Método mobile | Rota | Faz | Resposta |
| --- | --- | --- | --- |
| `signUp` | `POST /auth/signup` | cria worker pendente/não-verif., gera código, manda e-mail | `201 {nextStep:'CONFIRM'}` |
| `confirmSignUp` | `POST /auth/confirm` | valida código → `emailVerified=true` | `200` |
| `signIn` | `POST /auth/login` | senha + as 2 portas | `200 {accessToken, user}` ou `403 {reason}` |
| `resetPassword` | `POST /auth/password/forgot` | manda código de reset | `200` (sempre — não vaza e-mails existentes) |
| `confirmReset` | `POST /auth/password/reset` | valida código → troca senha | `200` |
| `getCurrentUser` | `GET /auth/me` | lê o JWT → usuário | `200 {user}` ou `null` |
| `signOut` | — | app descarta o JWT (stateless) | `200` no-op |
| *(admin)* | `POST /users/:id/approve` | aprova worker — só admin | `200` |

**Token (plumbing nova do mobile):** no login a API devolve `accessToken`; o app
**guarda** (`expo-secure-store`), anexa `Authorization: Bearer` nas chamadas, usa no
`getCurrentUser`→`/auth/me`, limpa no `signOut`. Sem token → `null` → tela de login.

**Fluxo ponta-a-ponta (o João):**
```
1. signUp   → POST /auth/signup   → User(pendente, não-verif.) + MailService → MailHog
2. [lê o código no localhost:8025]
3. confirm  → POST /auth/confirm  → emailVerified=true (ainda pendente)
4. login    → POST /auth/login    → 403 "aguardando aprovação"
5. [admin seedado] POST /users/{joão}/approve → APPROVED
6. login    → POST /auth/login    → 200 {accessToken, user} → guarda token → ENTRA
7. [reabriu] getCurrentUser → GET /auth/me → user (ou null → login)
```
Dentro do Nest: **Controller** → **Guard** (JWT/role quando precisa) → **Service** →
**PrismaService** (Postgres) / **MailService** (MailHog).

## 4. Tratamento de erro + integração com o seam

**Backend (DTOs `class-validator`):**

| Situação | Status |
| --- | --- |
| campo inválido / senha fraca / código malformado | `400` |
| senha errada / JWT ausente/inválido | `401` |
| não-confirmado · não-aprovado · não-admin | `403` + `reason` |
| e-mail já cadastrado | `409` |
| código expirado/usado | `400` |
| usuário inexistente (approve) | `404` |

Corpo consistente: `{ statusCode, message, reason? }`. **Guards:** públicas sem guard;
`/auth/me` = JwtAuthGuard; `/users/:id/approve` = JwtAuthGuard + RolesGuard(ADMIN).

**Mobile (seam absorve, telas intocadas):** a interface `AuthBackend` lança em falha
e as telas já capturam. O `apiAuthBackend` faz `fetch` → se `!ok`, **lança Error com a
mensagem que casa com a cópia do mock** (mapeia o `reason` do 403 → as mensagens das 2
portas). **Nenhuma tela muda.** Renomeio o arquivo `amplifyAuthBackend.ts` →
`apiAuthBackend.ts` (mobile-only, 1 import no selector; **valor** da flag intacto).
Token no `expo-secure-store`. URL base via `EXPO_PUBLIC_API_URL`.

**Borda do e-mail:** signup cria o usuário e tenta enviar; MailHog fora → `500` (no dev
está no compose). "Reenviar código" = nice-to-have/follow-up, fora do escopo.

## 5. Testes + verificação

**Backend (Nest + Jest):**
- *Unit* (Prisma mockado): `AuthService` — signup embaralha senha + gera código + cria
  pendente/não-verif.; confirm valida código+expiração; **lógica das 2 portas**; approve
  vira status; reset. `MailService` espionado.
- *e2e* (supertest, Postgres de teste descartável): fluxo inteiro signup→confirm→login
  `403`→approve→login `200`→`/me` + assert de envio de e-mail.

**Mobile (Jest):** selector `getAuthBackend` (mock vs api); `apiAuthBackend` com `fetch`
mockado (endpoints certos, `Bearer`, relança mensagens por `reason`, token via
`expo-secure-store` mockado). Testes do `mockAuthBackend` seguem verdes.

**Verificação (tripé + smoke Docker):**
- Backend: `npm run build` exit 0 · `npm test` verde · **`docker compose up`** → 3
  serviços de pé, migration aplicada, fluxo via curl OK, **e-mail no MailHog**.
- Mobile: `tsc --noEmit` 0 novos (8 baseline) · `jest` verde (108 baseline + novos) ·
  `expo export --platform web` exit 0.
- **Demo do loop:** compose up → mobile → cadastra → vê e-mail → confirma → barrado →
  aprova → loga → **entra**.

## Não-objetivos desta rodada (YAGNI)

- **Real-time** (WebSocket gateway) — só quando migrarmos chat/notificações.
- **Storage** (MinIO local → S3) — só quando migrarmos reports/chat-mídia.
- **Outros 10 domínios + 2 passthroughs** (weather/route) — fatias futuras.
- **UI de aprovação no swi-admin** — precisa Figma + é outra branch.
- **Rename do valor da flag** `'amplify'`→`'api'` — follow-up (evita re-varrer o seam agora).
- **Reenviar código de confirmação** — nice-to-have.

## Pendências de deploy (quando existir conta AWS)

- Container → **ECS/Fargate** (ou App Runner) atrás de ALB/HTTPS · Postgres → **RDS**/Aurora Serverless.
- **MailHog → SES/SMTP** · segredos (JWT/DB/SMTP) via **SSM/Secrets Manager**.
- `EXPO_PUBLIC_API_URL` → domínio real.
- Rename `'amplify'`→`'api'` no seam (mobile, depois admin).
- Migrar os domínios restantes; WebSocket (chat/notif.) e MinIO→S3 (mídia) nas fatias.
- Remover `swi-backend/amplify/` quando houver paridade.

## Transversais

- **Regra de branch:** `feat/backend-container-auth` = `swi-backend/` + `mobile/`, **nunca** `swi-admin/`.
- **Commit só com OK explícito** do usuário.
- **Sem UI nova** nesta rodada → a regra do DS não é exercitada aqui (entra quando houver telas).
