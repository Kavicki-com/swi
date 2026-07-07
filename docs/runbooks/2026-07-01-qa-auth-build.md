# Runbook — Build de QA ponta a ponta (Docker + túnel + EAS build)

## 1. Contexto

Este runbook descreve como gerar e validar uma **build de QA (APK Android)** do app mobile
apontando para o **backend conteinerizado** (NestJS + Postgres + MinIO + MailHog + fila pg-boss
via Docker Compose), exposto à internet por um **túnel** (ngrok). O objetivo é validar o app
**ponta a ponta contra o backend real** — o vertical de autenticação **e** todos os domínios
não-saúde —, **sem depender de AWS**.

**O que este build valida:** o app inteiro **exceto saúde**. Auth (cadastro, verificação de e-mail
**com reenvio de código**, aprovação/rejeição por admin, login com gate de aprovação, perfil
autenticado e reset de senha) **mais** os 7 domínios não-saúde (perfil, relatórios, jornada, chat,
notificações, clima, evacuação) ligados ao backend real. Duas flags fazem isso:
`EXPO_PUBLIC_AUTH_BACKEND=api` (auth) e `EXPO_PUBLIC_DATA_BACKEND=api` (os 7 domínios).

**O que este build NÃO cobre:** **saúde** — vitais/telemetria/smartband **continuam em mock**
(decisão de produto: dados de saúde só existem quando a smartband for adquirida). Essas telas
IGNORAM as flags de backend por design.

_Atualizado: 2026-07-05 — cobertura ampliada de auth-only → app inteiro (não-saúde). Branch original: `feat/backend-qa-auth-build`_

---

## 2. Pré-requisitos

- **Docker Desktop** rodando (para `db`, `mailhog` e `api` via Docker Compose).
- **Conta ngrok** com um **domínio estático** reservado (para uma URL de API estável entre rebuilds).
  O cloudflared serve como alternativa de túnel.
- **Conta Expo / EAS** autenticada na CLI (`eas`) para gerar o APK.
- **`swi-backend/.env`** preenchido com um **`JWT_SECRET`** forte. O arquivo é gitignored;
  copie o `swi-backend/.env.example` e defina o segredo. Sem `JWT_SECRET` o `docker compose`
  **falha ao subir** (falha explícita). Gere um segredo com:
  ```bash
  openssl rand -hex 32
  # ou, sem openssl:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

> **Windows / PowerShell 5.1:** os encadeamentos com `&&` mostrados abaixo funcionam no
> **Git Bash**. No PowerShell 5.1, rode cada comando em linhas separadas (ou use `;`).

---

## 3. Passo a passo do DEV (gerar e distribuir a build)

### 3.1 Subir a stack do backend

```bash
cd swi-backend && docker compose up -d --build
```

Serviços que sobem:

| Serviço      | Imagem/origem              | Porta(s)                           | Observação                                              |
|--------------|----------------------------|------------------------------------|---------------------------------------------------------|
| `db`         | postgres:16                | `5432`                             | user `swi` / pass `swi` / db `swi`                      |
| `mailhog`    | mailhog                    | `1025` (SMTP) / `8025` (web)        | UI web em `http://localhost:8025`                       |
| `minio`      | minio/minio                | `9000` (S3 API) / `9001` (console)  | mídia (fotos de relatórios e chat)                      |
| `minio-init` | minio/mc                   | —                                  | sidecar: cria o bucket `swi-media` uma vez e sai        |
| `api`        | build do `swi-backend/Dockerfile` | `3000`                      | no boot roda `npx prisma migrate deploy && node dist/main`; a **fila pg-boss** (fan-out de notificações) roda dentro do `api`, no mesmo Postgres |

As **migrations aplicam automaticamente** no boot do `api`. O **seed NÃO roda automaticamente**
(ver 3.2).

Health check:

```bash
curl -s localhost:3000/health
# esperado: {"status":"ok"}
```

### 3.2 Rodar o seed (manual, depois que o DB estiver de pé)

```bash
cd swi-backend && npm run prisma:seed
```

Usa o `DATABASE_URL` do `swi-backend/.env`. Cria **dois usuários APROVADOS e com e-mail já verificado**:

| E-mail             | Senha       | Role   | Estado                         |
|--------------------|-------------|--------|--------------------------------|
| `admin@swi.local`  | `admin123`  | ADMIN  | aprovado, e-mail verificado    |
| `worker@swi.local` | `worker123` | WORKER | aprovado, entra direto         |

### 3.3 Subir o túnel da API (URL estável — ngrok)

```powershell
ngrok start --all --config C:\Users\Gabriel\ngrok-swi-qa.yml
```

O config define **só o túnel da API** (`localhost:3000` → domínio estático). Publica a API numa
**URL estável** — é ela que vai no `eas.json` (passo 3.5).

Dois gotchas descobertos em 2026-07-06 (por isso o comando é esse e não `ngrok http ...`):

- **O ngrok instalado via Microsoft Store (MSIX) ignora o config default**
  (`%LOCALAPPDATA%\ngrok\ngrok.yml` é virtualizado — edições ali não têm efeito). Sempre passar
  `--config C:\Users\Gabriel\ngrok-swi-qa.yml` explicitamente.
- **NÃO subir MailHog/MinIO pelo ngrok**: no plano free (1 domínio estático), túneis extras
  fazem *pooling* na MESMA URL do domínio — os três serviços dividiriam a URL da API com
  load-balancing entre eles, quebrando o roteamento. MailHog/MinIO vão por cloudflared (3.4).

### 3.4 Subir os túneis de MailHog e MinIO (cloudflared quick tunnels)

**MailHog** (para o QA ler os códigos de e-mail):

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --url http://localhost:8025
```

Gera uma **URL efêmera** (`https://<aleatório>.trycloudflare.com`). **Passe essa URL ao QA**
para que ele leia os códigos de e-mail (confirmação, **reenvio** e reset).

**MinIO** (mídia — necessário porque `DATA_BACKEND=api` liga o upload de fotos em relatórios e chat):

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --url http://localhost:9000
```

As URLs presigned de upload/download são **atadas ao host** que as assina — por isso o `api`
precisa saber a URL pública do MinIO. Grave a URL desse túnel no `swi-backend/.env` como
`MINIO_PUBLIC_URL` (ex.: `MINIO_PUBLIC_URL=https://<aleatório>.trycloudflare.com`) e **suba a
stack de novo** (`docker compose up -d`) para o `api` reassinar contra ela. Sem isso, o app abre
a tela mas **falha ao subir foto** (a URL presigned aponta para `localhost:9000`, inacessível do
aparelho). Como a URL do quick tunnel **muda a cada restart do cloudflared**, repita este passo
(URL nova → `.env` → `docker compose up -d`) sempre que ele reiniciar. Em produção AWS o
`MINIO_PUBLIC_URL` fica **unset** (o SDK usa o S3 real).

### 3.5 Gravar as URLs e flags no `eas.json`

No `mobile/eas.json` existe o perfil **`qa`** com `env`:

- `EXPO_PUBLIC_AUTH_BACKEND=api` — manda o **auth** para o backend real.
- `EXPO_PUBLIC_DATA_BACKEND=api` — manda os **7 domínios não-saúde** para o backend real.
- `EXPO_PUBLIC_API_URL` — hoje um **placeholder**: `https://REPLACE-WITH-STATIC-TUNNEL.ngrok-free.app`

**Substitua o placeholder** pela URL estável do ngrok da API (a de 3.3). As duas flags de backend
já vêm setadas no perfil; a de saúde continua mock por design (não há flag para ligá-la).

### 3.6 Gerar o APK

```bash
cd mobile && eas build --profile qa --platform android
```

O app lê `EXPO_PUBLIC_API_URL` em `mobile/services/auth/apiConfig.ts` e as flags
`EXPO_PUBLIC_AUTH_BACKEND` / `EXPO_PUBLIC_DATA_BACKEND` em `mobile/lib/featureFlags.ts`.

### 3.7 Distribuir

Envie o **link do APK** gerado pelo EAS ao QA, junto com a **URL do MailHog** (3.4) e as
credenciais seedadas (3.2).

---

## 4. Passo a passo do QA (validar no app)

1. **Instalar o APK** recebido no aparelho Android.
2. Ter em mãos as **credenciais seedadas** e a **URL do MailHog** enviadas pelo dev.

> **Importante:** **não há tela de admin no app.** A aprovação/rejeição de usuários é feita
> **por API/curl** pelo dev/admin (ver 4.2, passo 4). Os códigos de e-mail (confirmação e reset)
> são lidos no **MailHog**: `http://localhost:8025` (na máquina do dev) ou pela **URL do túnel** enviada.

### 4.1 Caminho A — login direto (usuário já aprovado)

1. Abrir o app.
2. Login com `worker@swi.local` / `worker123`.
3. Como o usuário já está **APPROVED** e verificado, o login retorna **200** e o app entra no dashboard.

### 4.2 Caminho B — fluxo completo (signup → aprovação → login)

1. **Signup** no app com um e-mail novo (`POST /auth/signup` `{email, password, name}` → 201).
   Cria um usuário **PENDING**, e-mail **não verificado**, e dispara um **código por e-mail**.
2. **Ler o código no MailHog** (`http://localhost:8025` ou o túnel) e **confirmar**
   (`POST /auth/confirm` `{email, code}` → 200).

   > Se o e-mail não chegar (ou o código expirar — TTL 30 min), toque **"Reenviar código"** na
   > tela de confirmação do app; um novo código é enviado (`POST /auth/confirm/resend`). Por
   > anti-enumeração o endpoint é silencioso (sempre 200), mesmo para e-mail inexistente ou já
   > confirmado.
3. **Tentar login** (`POST /auth/login` `{email, password}`). Como o usuário **ainda não foi aprovado**,
   o login retorna **403** (gate de aprovação). Isso é o comportamento esperado.
4. **Admin aprova via API/curl** (sem tela no app) — ver exemplos em 4.3.
5. **Login novamente** → **200** `{accessToken, user}`; o app entra no **dashboard**.

### 4.3 Aprovação pelo admin (via API/curl)

Todos os endpoints admin exigem token de **ADMIN**. Fluxo: logar como admin → pegar token →
listar pendentes → aprovar.

```bash
# 1) Login do admin e captura do accessToken (requer jq)
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@swi.local","password":"admin123"}' \
  | jq -r '.accessToken')

# 2) Listar usuários pendentes -> [{id, email, name, createdAt}]
curl -s "$API/users/pending" \
  -H "Authorization: Bearer $TOKEN" | jq

# 3) Aprovar um usuário (troque <ID> pelo id retornado acima)
curl -s -X POST "$API/users/<ID>/approve" \
  -H "Authorization: Bearer $TOKEN" | jq
# esperado: {"id":"<ID>","approvalStatus":"APPROVED"}

# (Opcional) Rejeitar em vez de aprovar
curl -s -X POST "$API/users/<ID>/reject" \
  -H "Authorization: Bearer $TOKEN" | jq
# esperado: {"id":"<ID>","approvalStatus":"REJECTED"}
```

> Defina `API` antes: para o dev na própria máquina, `API=http://localhost:3000`;
> para acesso via túnel, `API=https://<SEU-DOMINIO-ESTATICO>.ngrok-free.app`.

Depois de aprovado, o usuário consegue logar (200) e o token pode ser validado em
`GET /auth/me` (header `Authorization: Bearer <token>` → 200).

### 4.4 Reset de senha

1. Solicitar reset: `POST /auth/password/forgot` `{email}` → 200; envia um **código de reset por e-mail** (MailHog).
2. Ler o código no **MailHog** e resetar: `POST /auth/password/reset` `{email, code, newPassword}` → 200.
3. Login com a **nova senha** (`POST /auth/login`) → 200.

### Resumo dos endpoints de auth

| Método | Rota                     | Corpo                          | Retorno                                    |
|--------|--------------------------|--------------------------------|--------------------------------------------|
| POST   | `/auth/signup`           | `{email, password, name}`      | 201 (cria PENDING, envia código)           |
| POST   | `/auth/confirm`          | `{email, code}`                | 200                                        |
| POST   | `/auth/confirm/resend`   | `{email}`                      | 200 (reenvia código; silencioso se e-mail não existe ou já confirmado) |
| POST   | `/auth/login`            | `{email, password}`            | 200 `{accessToken, user}`; **403** se não APPROVED |
| POST   | `/auth/password/forgot`  | `{email}`                      | 200 (envia código de reset)                |
| POST   | `/auth/password/reset`   | `{email, code, newPassword}`   | 200                                        |
| GET    | `/auth/me`               | header `Authorization: Bearer` | 200                                        |

---

## 5. Troubleshooting

**Túnel caiu / a URL trocou.** O app foi compilado com a URL fixada no `eas.json`. Se a URL do
ngrok mudar, ou você **usa o domínio estático** (recomendado, mantém a mesma URL) ou precisa
**refazer a build** com a nova URL (atualize `EXPO_PUBLIC_API_URL` no `mobile/eas.json` e rode
`eas build --profile qa --platform android` de novo).

**Compose não sobe.** Verifique se o `swi-backend/.env` tem `JWT_SECRET` — sem ele o
`docker compose` falha explicitamente. Copie do `.env.example` e gere um segredo forte
(`openssl rand -hex 32`).

**API não responde / erros no boot.** Veja os logs dos serviços:

```bash
cd swi-backend && docker compose logs api
cd swi-backend && docker compose logs db
```

Confirme o health: `curl -s localhost:3000/health` → `{"status":"ok"}`.

**Login sempre retorna 403.** É o gate de aprovação: o usuário não está **APPROVED**.
Aprove via API/curl (seção 4.3) ou use o `worker@swi.local`, que já está aprovado.

**Faltam os usuários seedados.** O seed **não roda no boot**. Rode manualmente:
`cd swi-backend && npm run prisma:seed`.

**Onde achar os códigos de e-mail (confirmação/reset).** No **MailHog**:
`http://localhost:8025` (máquina do dev) ou pela **URL do túnel** enviada ao QA.
API JSON das mensagens: `http://localhost:8025/api/v2/messages`.
