# swi-backend

API do SWI: autenticação, usuários, jornada, posições, chat, relatórios, alertas, evacuação, clima, câmeras, transmissão ao vivo e telemetria de saúde. Atende o painel web (`swi-admin`) e o app do trabalhador (`mobile`) por HTTP e por WebSocket (socket.io).

Stack: NestJS 10, Prisma 5 com PostgreSQL 16, pg-boss (fila sobre o próprio Postgres), armazenamento de mídia compatível com S3 (MinIO no ambiente local) e envio de e-mail por SMTP.

## Pré-requisitos

- Node.js na faixa `>=22.11.0 <23` e npm `>=10.9.0 <11`. A versão de referência é a de `.nvmrc` na raiz (22.23.2). O `.npmrc` tem `engine-strict=true`, então a instalação recusa outra versão.
- PostgreSQL 16.
- Armazenamento compatível com S3 (MinIO, Cloudflare R2, Amazon S3) com um bucket criado.
- Servidor SMTP.
- Docker, para o ambiente local descrito abaixo (Postgres, MinIO e MailHog prontos).

## Instalação

```bash
cd swi-backend
npm ci
npx prisma generate
cp .env.example .env
```

O client do Prisma é gerado e não versionado: sem `npx prisma generate` nem o typecheck nem o build encontram os tipos de `@prisma/client`. O `.env.example` traz valores locais que funcionam com o ambiente Docker abaixo; troque o `JWT_SECRET` por um valor próprio (`openssl rand -hex 32`).

## Como rodar

### Tudo em Docker

```bash
cd swi-backend
docker compose up --build
```

Sobe a API em `http://localhost:3000`, o Postgres em `localhost:5432`, o MinIO em `localhost:9000` (console em `localhost:9001`, usuário e senha `minioadmin`) e o MailHog em `http://localhost:8025`, onde ficam os e-mails enviados pela API (códigos de verificação, redefinição de senha). O container da API aplica as migrations antes de iniciar.

O compose lê o `JWT_SECRET` do `.env` desta pasta e recusa subir sem ele. Para usar um SMTP real no lugar do MailHog, declare no mesmo `.env` as variantes `API_SMTP_HOST`, `API_SMTP_PORT`, `API_SMTP_SECURE`, `API_SMTP_USER`, `API_SMTP_PASS`, `API_MAIL_FROM` e `API_REPORT_TO_EMAIL`. O prefixo existe porque o `.env` também serve à API rodando fora do Docker, onde `SMTP_HOST=localhost` é verdade, e esse valor não pode vazar para dentro do container.

Esta stack é de desenvolvimento: liga o alerta de tempestade fabricado (`WEATHER_SCENARIO=alert`) e o simulador de posições (`SIM_POSITIONS=1`).

### API no Node, infraestrutura em Docker

```bash
cd swi-backend
docker compose up -d db mailhog minio minio-init
npx prisma migrate deploy
npm run start:dev
```

`npm run start:dev` compila em modo watch e lê o `.env` desta pasta. Para criar uma migration nova a partir de uma mudança em `prisma/schema.prisma`, use `npm run prisma:migrate` (é o `prisma migrate dev`, que só deve ser usado em banco de desenvolvimento).

### Dados de demonstração

```bash
NODE_ENV=development ALLOW_DEV_SEED=1 npx prisma db seed
```

O `npx prisma db seed` carrega o `.env` desta pasta antes de executar `prisma/seed.ts`. O seed cria empresa, contas de demonstração com senha conhecida, funcionários, histórico e imagens no bucket. Por isso ele exige as duas variáveis acima e recusa rodar com `NODE_ENV=production` em qualquer caso. As contas e senhas estão em `prisma/seed.ts`. Rode com o banco e o MinIO de pé e as migrations aplicadas.

## Documentação da API (Swagger)

Com a API no ar:

- `GET /docs`: interface do Swagger, com os endpoints, parâmetros e esquemas, e a opção de informar o token Bearer para testar as rotas autenticadas.
- `GET /docs-json`: a especificação OpenAPI em JSON, para importar em clientes HTTP ou geradores de código.

As duas rotas ficam ligadas por padrão. `API_DOCS=0` desliga ambas.

O arquivo `docs/openapi.json` desta pasta é a mesma especificação, gerada a partir do código e versionada, para consulta sem a API no ar.

`GET /health` responde `200` sem autenticação e sem consultar o banco. Serve para sonda de disponibilidade.

## Testes

Os mesmos passos dos jobs `backend` e `backend-integration` de `.github/workflows/ci.yml`:

```bash
cd swi-backend
npm ci
npx prisma generate
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

`npm run test:coverage` roda os testes unitários com cobertura mínima de 80% em linhas, funções, ramos e instruções.

Os testes de integração (`test/*.e2e-spec.ts`) sobem a aplicação em processo e falam com um Postgres de verdade:

```bash
DATABASE_URL=postgresql://swi:swi@localhost:5432/swi npx prisma migrate deploy
DATABASE_URL=postgresql://swi:swi@localhost:5432/swi npm run test:e2e
```

Use um banco descartável: as suítes escrevem e apagam dados. Como alternativa, `npm run test:e2e:managed` sobe uma infraestrutura própria em Docker, em portas separadas das do desenvolvimento, aplica as migrations, roda as suítes e derruba tudo ao final. As portas usadas estão em `../swi-admin/README.md`, seção "Testes de navegador".

`npm run verify` encadeia lint, typecheck, testes unitários e build.

## Build

```bash
npm run build
```

Gera `dist/`. Para executar o build: `npm run start:prod` (o mesmo que `node dist/main`). O `app.js` desta pasta é um ponto de entrada alternativo para hospedagens cujo gerenciador de processo executa um arquivo fixo: ele fixa o diretório de trabalho na pasta da aplicação, onde está o `.env`, e carrega `dist/main.js`.

A imagem Docker (`Dockerfile`) compila em um estágio e entrega só `dist/` e as dependências de execução no estágio final, com `NODE_ENV=production`. Da raiz do repositório:

```bash
docker build -t swi-api swi-backend
```

## Deploy

As migrations do Prisma **não** rodam sozinhas no deploy: nem o `CMD` da imagem nem o `npm run start:prod` as aplicam. A ordem é sempre banco primeiro, código depois.

1. **Build.** Em uma máquina com as dependências completas: `npm ci`, `npx prisma generate` e `npm run build`.
2. **Pacote.** Leve para o servidor `dist/`, `package.json`, `package-lock.json`, `prisma/` (schema e migrations) e, se a hospedagem executar um arquivo fixo, `app.js`.
3. **Dependências no servidor.** `npm ci --omit=dev` e `npx prisma generate`. O CLI do Prisma é dependência de execução justamente para estar disponível aqui.
4. **Backup do banco**, por exemplo com `pg_dump -Fc`, antes de qualquer migration.
5. **Migrations.** `npx prisma migrate deploy` com o `DATABASE_URL` de produção, antes de subir o código novo. `npx prisma migrate status` mostra antes quais estão pendentes.
6. **Ambiente.** `.env` na pasta da aplicação (ou variáveis do processo) com `NODE_ENV=production` e todas as obrigatórias da tabela abaixo. Em produção, variável obrigatória ausente ou valor inseguro derruba a inicialização com a lista de problemas, sem mostrar os valores.
7. **Troca e reinício** do processo (`node dist/main` ou `node app.js`).
8. **Conferência.** `GET /health` responde `200`; `POST /auth/login` com uma credencial inexistente devolve `401` "Credenciais inválidas", o que confirma a conexão com o banco.

Com Docker, a imagem é a de `docker build`; rode `npx prisma migrate deploy` em um container avulso da imagem nova, com o `DATABASE_URL` de produção, antes de substituir o container da API.

### Atrás de proxy

- **Socket Unix.** Se o proxy encaminha para um socket em vez de uma porta, defina `LISTEN_SOCKET` com o caminho. A API remove um socket antigo no caminho antes de escutar, e `PORT` é ignorada.
- **CORS injetado pelo proxy.** Se o proxy já acrescenta `Access-Control-Allow-Origin` às respostas, defina `CORS_PROXY_SETS_ORIGIN=1`. Sem isso a resposta chega com dois valores no cabeçalho e o navegador bloqueia o painel inteiro. Nesse modo a API deixa esse cabeçalho com o proxy nas respostas de sucesso e redirecionamento, continua respondendo os cabeçalhos do preflight e preenche o `Access-Control-Allow-Origin` nas respostas de erro, que um proxy com `add_header` sem `always` deixa de fora. Sem esse preenchimento nenhuma mensagem de erro da API chega legível ao painel. Se o proxy também carimbar as respostas de erro, defina ainda `CORS_PROXY_SETS_ORIGIN_ON_ERRORS=1`.
- **WebSocket.** Se o proxy não repassa WebSocket, o socket.io cai em long-polling e cada cliente ocupa uma conexão até o próximo ping. Em hospedagem que limita conexões simultâneas com o processo, um `SOCKET_PING_INTERVAL_MS` menor (por exemplo `2000`) faz as conexões girarem. Onde o WebSocket passa, não é necessário.

## Variáveis de ambiente

Validadas no boot por `src/config/runtime-env.ts`. "Obrigatória" significa que, com `NODE_ENV=production`, a API não sobe sem ela. Variável vazia equivale a ausente, salvo onde indicado.

### Núcleo

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `NODE_ENV` | | `development` | `development`, `test` ou `production`; qualquer outro valor impede o boot. Em `test` o limite de requisições fica desligado, então nunca rode a API real assim. |
| `DATABASE_URL` | sim | | Conexão do PostgreSQL. Também é usada pela fila de tarefas (pg-boss). |
| `JWT_SECRET` | sim | | Assinatura dos tokens de acesso. Em produção, no mínimo 32 caracteres. |
| `PORT` | | `3000` | Porta HTTP. Ignorada quando `LISTEN_SOCKET` está definida. |
| `LISTEN_SOCKET` | | | Caminho de um socket Unix para escutar em vez da porta. |
| `API_DOCS` | | ligada | `0` desliga `GET /docs` e `GET /docs-json`. |

### CORS e conexões

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `CORS_ORIGINS` | sim | `http://localhost:5173` | Origens do painel liberadas, separadas por vírgula, para HTTP e WebSocket. Em produção: ao menos uma, só `https://`, sem curinga e sem endereço local. Declarada e vazia, fecha o CORS. |
| `CORS_PROXY_SETS_ORIGIN` | | | `1` quando o proxy já injeta `Access-Control-Allow-Origin` (ver "Atrás de proxy"). |
| `CORS_PROXY_SETS_ORIGIN_ON_ERRORS` | | | `1` quando esse proxy também carimba as respostas de erro. Só tem efeito com `CORS_PROXY_SETS_ORIGIN=1`. |
| `SOCKET_PING_INTERVAL_MS` | | 25000 (padrão do socket.io) | Intervalo do ping do socket.io, inteiro de 1000 a 25000. Valor inválido impede o boot. |

### E-mail

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `SMTP_HOST` | | `localhost` | Servidor SMTP. |
| `SMTP_PORT` | | `1025` | Porta SMTP (1025 é a do MailHog local). |
| `SMTP_SECURE` | | | `1` usa TLS desde a conexão (porta 465); vazio usa STARTTLS quando o servidor oferece (porta 587). |
| `SMTP_USER` | | | Usuário SMTP. Sem ele a API envia sem autenticação. |
| `SMTP_PASS` | | | Senha SMTP. |
| `MAIL_FROM` | sim | `no-reply@swi.local` | Remetente dos e-mails. |
| `REPORT_TO_EMAIL` | sim | | Destinatário das denúncias de mensagem do chat. Sem ele a rota de denúncia responde `503`. |
| `ADMIN_APP_URL` | | `http://localhost:5173` | Endereço do painel usado nos links de e-mail (definir e redefinir senha). Em produção, defina com o endereço público do painel. |

### Armazenamento de mídia (S3 compatível)

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `MINIO_PUBLIC_URL` | | | Endpoint do armazenamento. É o host que as URLs assinadas carregam, então precisa ser o endereço que o navegador e o app alcançam. Vazio usa o endpoint padrão da Amazon S3. |
| `MINIO_ACCESS_KEY` | | | Chave de acesso. Precisa vir junto com a secreta: metade do par impede o boot. Sem as duas, o armazenamento fica desligado: upload responde `503` e imagens não aparecem. |
| `MINIO_SECRET_KEY` | | | Chave secreta. |
| `MINIO_BUCKET` | | `swi-media` | Bucket. |
| `MINIO_REGION` | | `us-east-1` | Região. |

O bucket precisa aceitar `PUT` e `GET` vindos da origem do painel (política de CORS do bucket), porque o upload sai direto do navegador para o armazenamento.

### Serviços externos

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `MAPBOX_TOKEN` | | | Token do Mapbox Directions para a rota de evacuação (perfil a pé). Vazio usa o servidor público de demonstração do OSRM, com perfil de carro e sem garantia de disponibilidade: em produção, defina. |
| `OPEN_METEO_BASE_URL` | | `https://api.open-meteo.com` | Provedor de clima. O endereço público só vale para uso não comercial; em produção, use o endereço do plano contratado. |
| `OPEN_METEO_API_KEY` | | | Chave do plano contratado do Open-Meteo. |
| `LIVE_ICE_SERVERS` | | STUN `stun:stun.l.google.com:19302` | Servidores de conexão da transmissão ao vivo da câmera, em lista JSON no formato do navegador (`[{"urls":"turn:turn.exemplo.com:3478","username":"u","credential":"s"}]`). `[]` desliga até o STUN (só mesma rede). Sem TURN, celular em rede móvel pode não fechar a conexão. A credencial do TURN chega a todo usuário logado. Lista inválida impede o boot. |
| `CAMERA_EMBED_ALLOWED_HOSTS` | | | Domínios, separados por vírgula, aceitos para o player embutido de câmera no painel. Só entram endereços `https` cujo host esteja na lista. Vazia recusa todo player embutido. |

### Agendamentos e retenção

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `WEATHER_CRON` | | a cada 30 minutos | Coleta de clima. |
| `TELEMETRY_CONDITION_SWEEP_CRON` | | `*/30 * * * * *` (a cada 30 s) | Varredura de condições de saúde. Expressão de seis campos, com segundos. |
| `TELEMETRY_LIFECYCLE_CRON` | | `0 30 6 * * *` (06:30 UTC) | Resumo diário da telemetria e limpeza das leituras brutas já resumidas. |
| `TELEMETRY_RETENTION_DAYS` | | `30` | Dias de retenção das leituras brutas de telemetria. Mínimo 2; abaixo disso o processo não sobe. |
| `TELEMETRY_RETENTION_BATCH_SIZE` | | `5000` | Linhas apagadas por lote na limpeza. Mínimo 1. |
| `POSITION_RETENTION_CRON` | | `0 45 6 * * *` (06:45 UTC) | Limpeza da trilha de posições do mapa de calor. |
| `POSITION_RETENTION_DAYS` | | `30` | Dias de retenção das posições. Mínimo 1. |

### Somente desenvolvimento e homologação

Nenhuma destas deve ser ligada no servidor de produção.

| Variável | Padrão | Significado |
| --- | --- | --- |
| `WEATHER_SCENARIO` | | `alert` fabrica um alerta de tempestade. Ignorada com `NODE_ENV=production`. |
| `SIM_POSITIONS` | | `1` movimenta os funcionários do seed pelo mapa. Ignorada com `NODE_ENV=production`. |
| `TELEMETRY_ALERTS_INCLUDE_DEMO` | | `1` faz a fila de alertas mostrar alertas de origem demonstração. Vale também com `NODE_ENV=production`, por isso exige cuidado. |
| `POSITIONS_HEAT_INCLUDE_SIM` | | `1` deixa o mapa de calor incluir posições do simulador. Vale também com `NODE_ENV=production`. |
| `ALLOW_DEV_SEED` | | `1` autoriza o seed (`npx prisma db seed`), que além disso exige `NODE_ENV` igual a `development` ou `test`. |
| `QA_DEMO_TELEMETRY` | | `1` autoriza `npm run qa:demo-telemetry`, que injeta telemetria de demonstração para homologação. Recusado com `NODE_ENV=production`. |

## Estrutura

```
swi-backend/
  src/                     módulos da API, um por domínio; ambiente em src/config/runtime-env.ts
  prisma/                  schema.prisma, migrations/ e seed.ts
  test/                    testes de integração
  scripts/                 ferramentas de homologação
  docs/                    openapi.json
  app.js                   ponto de entrada para hospedagens que executam um arquivo fixo
  Dockerfile
  docker-compose.yml       stack de desenvolvimento
  docker-compose.e2e.yml   sobreposição usada pelos testes de integração
```
