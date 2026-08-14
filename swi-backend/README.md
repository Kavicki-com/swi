# swi-backend

API do SWI: NestJS + Prisma + PostgreSQL, com MinIO para arquivos, MailHog para
e-mail em desenvolvimento e fila pg-boss (no mesmo Postgres) para o fan-out de
notificações.

Design: [`../docs/plans/2026-07-01-swi-backend-container-pivot-design.md`](../docs/plans/2026-07-01-swi-backend-container-pivot-design.md).

> **Só quer ver o sistema rodando?** Não use este arquivo. Dê duplo clique no
> `START-SWI.cmd` da raiz do repositório, que sobe a API, o banco, os arquivos,
> o e-mail e o painel web de uma vez, sem exigir Node nem configuração.
> Instruções em [`../docs/client/INSTALL-WINDOWS.md`](../docs/client/INSTALL-WINDOWS.md).

---

## Antes de subir: configure o ambiente

**`docker compose up` sozinho não sobe a API.** O Compose interpola
`${JWT_SECRET:?...}` e aborta com erro explícito se a variável não existir. Isso
é intencional: um segredo de assinatura com valor default é uma credencial de
verdade no dia em que alguém apontar a stack para um banco que não é
descartável.

```bash
cd swi-backend
cp .env.example .env
```

Depois abra o `.env` e defina o `JWT_SECRET` com um valor forte, de no mínimo 32
caracteres:

```bash
openssl rand -hex 32
# sem openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O `.env` é ignorado pelo git. O `.env.example` documenta **todas** as variáveis,
cada uma com o que faz e o que acontece se faltar. A validação está em
`src/config/runtime-env.ts` e roda **no boot**: em produção, variável obrigatória
ausente ou valor inseguro (CORS com curinga, origin de loopback, ausência de
`MAIL_FROM`) derruba a inicialização, em vez de falhar na primeira requisição.

---

## Subir a stack de desenvolvimento

```bash
docker compose up -d --build
```

| Serviço | Porta | Observação |
| --- | --- | --- |
| `db` (postgres:16) | 5432 | usuário `swi`, senha `swi`, banco `swi` |
| `mailhog` | 1025 SMTP, 8025 web | interface em <http://localhost:8025> |
| `minio` | 9000 API, 9001 console | arquivos de relatórios e chat |
| `minio-init` (minio/mc) | | sidecar: cria o bucket `swi-media` e sai |
| `api` | 3000 | roda `prisma migrate deploy` e depois `node dist/main` |

> Este compose é o de **desenvolvimento**, e publica as portas em todas as
> interfaces da máquina. O compose do pacote entregue ao cliente é outro arquivo,
> `../docker-compose.client.yml`, que prende tudo a `127.0.0.1` e não publica o
> Postgres. Um não é sobreposição do outro: o Compose concatena a lista `ports`
> entre arquivos em vez de substituí-la, então sobrepor não conseguiria fechar as
> portas do primeiro.

As migrations aplicam sozinhas no boot da API. Health check:

```bash
curl -s localhost:3000/health
# {"status":"ok"}
```

## Dados de demonstração

O seed **não roda no boot**, por decisão de segurança. Rode à mão:

```bash
ALLOW_DEV_SEED=1 npm run prisma:seed
```

No PowerShell não existe prefixo de variável na mesma linha; use duas:

```powershell
$env:ALLOW_DEV_SEED = "1"
npm run prisma:seed
```

São duas travas independentes, em `src/config/seed-guard.ts`: o `NODE_ENV`
precisa ser `development` ou `test` (ausente conta como perigo, não como
desenvolvimento), e o `ALLOW_DEV_SEED=1` é a confirmação explícita de que este
banco é descartável. Contra um banco de produção, o seed não seria "popular
dados": seria abrir uma conta administrativa com senha pública.

O seed é feito de upserts, então rodar duas vezes não duplica nada. Ele cria:

| E-mail | Senha | Papel |
| --- | --- | --- |
| `admin@swi.local` | `admin123` | ADMIN, aprovado e verificado |
| `worker@swi.local` | `worker123` | WORKER, aprovado e verificado |

Mais oito trabalhadores com setor, função e dados de ficha, conversas de chat,
relatórios com foto, tarefas, alertas e previsão do tempo.

---

## Desenvolvimento

Node **22.23.2** (veja `.nvmrc` na raiz). O `engines` declara a faixa
`>=22.11.0 <23`, porque a hospedagem roda 22.11.0.

```bash
npm ci
npx prisma generate     # o client é gerado, não versionado
npm run start:dev       # watch
npm run verify          # lint + typecheck + testes + build
```

| Comando | O que faz |
| --- | --- |
| `npm test` | unitários (Jest) |
| `npm run test:coverage` | os mesmos, com o piso de 80% de cobertura que o CI aplica |
| `npm run test:e2e` | ponta a ponta contra Postgres e MinIO de verdade |
| `npm run test:e2e:managed` | idem, com a infraestrutura descartável subida e derrubada pelo runner |
| `npm run prisma:migrate` | cria uma migration nova a partir do schema |
| `npm run build` | compila para `dist/` |

O `test:e2e:managed` usa `../scripts/e2e/run-test-stack.mjs`, que sobe tudo em
portas próprias (55432, 3300, 4173, 59000), aplica migrations, roda o seed e
derruba num `finally`. Ele injeta o próprio segredo descartável, então não
depende do seu `.env`.

## Produção

O deploy roda a mesma imagem do `Dockerfile`. Duas diferenças de configuração
valem registro:

- `LISTEN_SOCKET` substitui a `PORT` quando a hospedagem faz proxy por socket
  Unix em vez de porta TCP.
- `CORS_PROXY_SETS_ORIGIN=1` quando o proxy do host já injeta o
  `Access-Control-Allow-Origin`. Sem isso o header sai duplicado e o navegador
  recusa a resposta.

Com `NODE_ENV=production`, o boot exige `DATABASE_URL`, `JWT_SECRET` com 32
caracteres ou mais, `MAIL_FROM` e `REPORT_TO_EMAIL`, e recusa CORS com curinga
ou endereço local.
