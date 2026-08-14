# Runbook: build de QA do aplicativo Android

_Criado em 2026-07-01 (backend em Docker exposto por túnel ngrok). Reescrito em
2026-08-14: a infraestrutura de produção substituiu os túneis, e o procedimento
antigo passou a contradizer a realidade. O histórico do arquivo guarda a versão
original._

---

## 1. O que este runbook cobre

Gerar e validar uma **build de QA (APK Android)** do aplicativo apontando para a
**API pública** em `https://api.kavicki.com`.

**O que a build valida:** o aplicativo inteiro **exceto saúde**. Autenticação
(cadastro, verificação de e-mail com reenvio de código, aprovação por
administrador, login com portão de aprovação, perfil e redefinição de senha) e os
sete domínios não relacionados a saúde: perfil, relatórios, jornada, chat,
notificações, clima e evacuação. Duas variáveis fazem isso:
`EXPO_PUBLIC_AUTH_BACKEND=api` e `EXPO_PUBLIC_DATA_BACKEND=api`.

**O que a build não cobre:** **saúde**. Vitais, telemetria e smartband continuam
simulados por decisão de produto (os dados de saúde só existem quando a pulseira
for adquirida). Essas telas ignoram as variáveis de backend por design, e não há
flag para ligá-las.

---

## 2. Pré-requisitos

- Conta Expo/EAS autenticada na CLI (`eas login`).
- Node 22.23.2 e as dependências instaladas em `mobile/` (`npm ci`).
- Acesso à caixa de e-mail que será usada no teste de cadastro. Os e-mails são
  **reais** e chegam na caixa de verdade.

**Não é preciso** subir Docker, backend local, MailHog, MinIO nem túnel nenhum. A
build fala com a API pública.

---

## 3. Gerar o APK

```bash
cd mobile
eas build --profile qa --platform android
```

Só isso. O perfil `qa` já vem configurado em `mobile/eas.json`:

| Variável | Valor |
| --- | --- |
| `EXPO_PUBLIC_AUTH_BACKEND` | `api` |
| `EXPO_PUBLIC_DATA_BACKEND` | `api` |
| `EXPO_PUBLIC_API_URL` | `https://api.kavicki.com` |

Para iOS, use `--profile qa-testflight`. Os perfis `preview`, `qa`,
`qa-testflight` e `production` apontam todos para a mesma API pública; o que muda
entre eles é o tipo de distribuição e o formato do artefato.

O aplicativo lê a URL em `mobile/services/auth/apiConfig.ts` e as duas flags em
`mobile/lib/featureFlags.ts`.

Antes de subir a build, confirme que a API está no ar:

```bash
curl -s https://api.kavicki.com/health
# {"status":"ok"}
```

---

## 4. Distribuir

Envie ao QA o link do APK gerado pelo EAS e as credenciais da conta de
demonstração. **Não** envie URL de MailHog: não existe mais. Os códigos de
verificação e de redefinição chegam por e-mail de verdade, na caixa do próprio
QA.

> Se o SMTP de produção estiver mal configurado, o cadastro trava na tela de
> confirmação **parecendo defeito do aplicativo**. Antes de acusar o app,
> confirme que o e-mail saiu.

---

## 5. Roteiro do QA

### 5.1 Login direto (conta já aprovada)

1. Abrir o aplicativo.
2. Entrar com a conta de demonstração recebida.
3. Como ela já está aprovada e verificada, o login devolve 200 e o aplicativo
   entra no painel.

### 5.2 Fluxo completo (cadastro, aprovação, login)

1. **Cadastro** no aplicativo com um e-mail novo (`POST /auth/signup`, 201). Cria
   um usuário **PENDING**, com e-mail não verificado, e dispara o código.
2. **Ler o código na caixa de e-mail** e confirmar (`POST /auth/confirm`, 200).
   Se não chegar, ou se o código expirar (validade de 30 minutos), toque em
   **Reenviar código** na própria tela. Por anti enumeração, o endpoint de reenvio
   é silencioso: responde 200 mesmo para e-mail inexistente ou já confirmado.
3. **Tentar entrar.** O login devolve **403**: o usuário ainda não foi aprovado.
   **Isso é o comportamento esperado**, é o portão de aprovação.
4. **Aprovar.** Duas formas, veja a seção 6.
5. **Entrar de novo.** Agora devolve 200 com `{accessToken, user}` e o aplicativo
   abre o painel.

### 5.3 Redefinição de senha

1. `POST /auth/password/forgot` com o e-mail, 200. Envia o código por e-mail.
2. Ler o código e chamar `POST /auth/password/reset` com `{email, code, newPassword}`, 200.
3. Entrar com a nova senha, 200.

### 5.4 Demais domínios

Percorrer, com a conta autenticada: painel e navegação, mapa e localização,
permissões de câmera e galeria, envio e abertura de relatório com foto, chat,
jornada, clima, evacuação, central de notificações, sair e entrar de novo, e o
comportamento com a API indisponível (o aplicativo avisa na tela, não trava).

---

## 6. Aprovar um cadastro

### Pelo painel web (o caminho normal)

Entre no painel como administrador, vá em **Funcionários**, abra a aba
**Pendentes** e clique em **Aprovar** ou **Rejeitar**. O painel de produção fala
com a mesma API pública.

**Não existe tela de administração dentro do aplicativo.** A moderação é feita no
painel web.

### Pela API (quando não houver painel à mão)

Todos os endpoints de administração exigem token de ADMIN.

```bash
API=https://api.kavicki.com

# 1) Entrar como admin e capturar o token (requer jq)
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN>","password":"<SENHA>"}' \
  | jq -r '.accessToken')

# 2) Listar os pendentes
curl -s "$API/users?role=WORKER&approvalStatus=PENDING" \
  -H "Authorization: Bearer $TOKEN" | jq

# 3) Aprovar
curl -s -X POST "$API/users/<ID>/approve" \
  -H "Authorization: Bearer $TOKEN" | jq
# {"id":"<ID>","approvalStatus":"APPROVED"}

# (ou rejeitar)
curl -s -X POST "$API/users/<ID>/reject" \
  -H "Authorization: Bearer $TOKEN" | jq
```

O token pode ser validado em `GET /auth/me` com o header
`Authorization: Bearer <token>`.

### Endpoints de autenticação

| Método | Rota | Corpo | Retorno |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `{email, password, name}` | 201, cria PENDING e envia o código |
| POST | `/auth/confirm` | `{email, code}` | 200 |
| POST | `/auth/confirm/resend` | `{email}` | 200, silencioso por anti enumeração |
| POST | `/auth/login` | `{email, password}` | 200 `{accessToken, user}`; **403** se não aprovado |
| POST | `/auth/password/forgot` | `{email}` | 200, envia o código de redefinição |
| POST | `/auth/password/reset` | `{email, code, newPassword}` | 200 |
| GET | `/auth/me` | header `Authorization: Bearer` | 200 |

---

## 7. Problemas comuns

**O login sempre devolve 403.** É o portão de aprovação, não um defeito. Aprove o
usuário (seção 6) ou use uma conta já aprovada.

**O código de verificação não chega.** Aqui os e-mails são reais. Confira a caixa
de spam, confirme que o endereço está certo e, se ainda assim nada, verifique se
o SMTP de produção está configurado. Não há MailHog nesta rota.

**A API não responde.** Confirme `https://api.kavicki.com/health`. Se ela estiver
fora, nenhuma build de QA funciona: o aplicativo depende dela por inteiro.

**Refiz a build e o comportamento não mudou.** A URL e as flags são assadas no
bundle em tempo de build. Confirme que usou o perfil `qa` e não um perfil de
desenvolvimento, e que o EAS pegou o commit que você esperava.

**Preciso testar contra um backend local.** Isso não é build de QA, é
desenvolvimento. Suba a stack local seguindo o
[`README do backend`](../../swi-backend/README.md) e rode o aplicativo com
`npx expo start`, apontando `EXPO_PUBLIC_API_URL` para a sua máquina. Uma build
EAS apontando para `localhost` não funciona: `localhost`, no celular, é o próprio
celular.
