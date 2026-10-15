# SWI

Plataforma de monitoramento de trabalhadores em campo voltada à segurança do trabalho. O SWI acompanha localização, jornada, sinais vitais e comunicação de equipes em operação, com suporte a alertas, evacuação e resgate.

## Aplicações

| Pasta | Aplicação | Stack | Documentação |
| --- | --- | --- | --- |
| `swi-backend/` | API | NestJS, Prisma, PostgreSQL | [`swi-backend/README.md`](swi-backend/README.md) |
| `swi-admin/` | Painel web de gestão | React, Vite, react-native-web | [`swi-admin/README.md`](swi-admin/README.md) |
| `mobile/` | App do trabalhador (Android e iOS, com app de Apple Watch) | Expo, React Native | [`mobile/README.md`](mobile/README.md) |

As três aplicações são independentes: cada uma tem o próprio `package.json`, `package-lock.json` e `node_modules/`, e é instalada, testada e compilada a partir da própria pasta. Não há workspaces nem configuração compartilhada na raiz.

O painel e o app usam o design system `@kavicki/swi-design-system`, biblioteca da Kavicki que acompanha o código como pacote em `swi-admin/vendor/` e `mobile/vendor/`.

Cada README de aplicação cobre pré-requisitos, instalação, execução, testes, build, deploy e a lista completa de variáveis de ambiente.

## Pré-requisitos

- **Node.js 22**, na faixa `>=22.11.0 <23`, e npm `>=10.9.0 <11`. A versão de referência está em `.nvmrc` e `.node-version` (22.23.2). Os três projetos têm `engine-strict=true` e recusam instalar com outra versão.
- **Docker**, para o banco, o armazenamento e o e-mail locais, para a demonstração por duplo clique e para os testes de integração.
- **Android:** JDK 17 e Android SDK. **iOS:** macOS com Xcode. Só para gerar os builds do app.

## Demonstração local (Windows)

Com o Docker Desktop aberto, um duplo clique em `START-SWI.cmd` sobe a API, o painel, o banco, o armazenamento de arquivos e uma caixa de e-mail local, aplica as migrations e carrega dados de demonstração:

| Endereço | O que é |
| --- | --- |
| `http://localhost:5173` | Painel |
| `http://localhost:3000/health` | API |
| `http://localhost:8025` | Caixa de e-mail local (códigos de verificação de cadastro) |
| `http://localhost:9001` | Console do armazenamento de arquivos |

O script mostra as contas de demonstração ao terminar; elas existem só no banco criado nessa máquina. Na primeira execução ele gera `swi-client.env` com a chave de assinatura dos tokens e o endereço da API que o painel usa. Trocando `VITE_API_URL` nesse arquivo pelo endereço da API publicada e rodando o `START-SWI.cmd` de novo, o painel passa a ler os mesmos dados do app. `STOP-SWI.cmd` para a stack e preserva banco e arquivos.

A stack está descrita em `docker-compose.client.yml`, e tudo é publicado só em `127.0.0.1`.

## Desenvolvimento

Ordem sugerida: API, depois painel e app.

```bash
cd swi-backend
npm ci
npx prisma generate
cp .env.example .env
docker compose up -d db mailhog minio minio-init
npx prisma migrate deploy
NODE_ENV=development ALLOW_DEV_SEED=1 npx prisma db seed
npm run start:dev
```

```bash
cd swi-admin
npm ci
npm run dev
```

```bash
cd mobile
npm ci
cp .env.example .env
npx expo run:android
```

Os detalhes de cada passo, e as alternativas, estão nos READMEs das aplicações.

## Testes e CI

O CI (`.github/workflows/ci.yml`) roda em todo pull request e em todo push na `main`, com Node 22.23.2:

| Job | O que verifica |
| --- | --- |
| `backend` | lint, typecheck, testes unitários com cobertura mínima de 80%, build |
| `backend-integration` | testes de integração da API contra PostgreSQL 16 |
| `admin` | lint, typecheck, testes com cobertura mínima de 80%, limite de 800 linhas por arquivo, build, build do Storybook |
| `admin-e2e` | testes de navegador do painel contra a API real, com infraestrutura descartável em Docker |
| `mobile` | `expo-doctor`, lint, typecheck, testes com cobertura mínima de 80%, exportação dos bundles Android, iOS e web |
| `security` | testes das ferramentas de `scripts/`, portão de higiene do código, portão de vulnerabilidades das dependências e varredura de segredos |

Os comandos de cada job das aplicações estão no README correspondente. Os do job `security`, a partir da raiz:

```bash
node --test scripts/quality/assert-client-hygiene.test.mjs
node --test scripts/e2e/run-test-stack.test.mjs scripts/e2e/seed-e2e.test.mjs
node --test scripts/client-delivery/policy.test.mjs scripts/client-delivery/zip.test.mjs scripts/client-delivery/export.test.mjs
node --test scripts/licenses/generate-anexo-iii.test.mjs
node scripts/quality/assert-client-hygiene.mjs
(cd mobile && npm ci) && (cd swi-admin && npm ci) && (cd swi-backend && npm ci)
node scripts/security/check-audit.mjs
node scripts/licenses/generate-anexo-iii.mjs --check
node --test scripts/security/check-audit.test.mjs
docker run --rm -v "$PWD:/repo:ro" zricethezav/gitleaks:v8.28.0 dir /repo --config /repo/.gitleaks.toml --redact --no-banner
```

`check-audit.mjs` bloqueia vulnerabilidades críticas e altas nas dependências dos três projetos, salvo exceções declaradas em `scripts/security/audit-policy.json` com justificativa, responsável e prazo de até 90 dias; exceção vencida também bloqueia. `generate-anexo-iii.mjs --check` falha se o `ANEXO-III-LICENCAS.md` não corresponder às dependências instaladas; depois de qualquer mudança de dependência, regere o anexo com `node scripts/licenses/generate-anexo-iii.mjs`.

## Build e deploy

| Aplicação | Build | Onde roda |
| --- | --- | --- |
| API | `npm run build` (gera `dist/`) ou imagem Docker | Qualquer hospedagem Node 22 ou container. As migrations do banco são aplicadas manualmente (`npx prisma migrate deploy`) antes de subir o código novo. |
| Painel | `npm run build` (gera `dist/` estático) ou imagem Docker com Nginx | Qualquer servidor de arquivos estáticos com fallback de rotas para `index.html`. O endereço da API é fixado no build. |
| App | `npx expo prebuild` mais Gradle (Android) ou Xcode (iOS), ou perfis do EAS | Instalação direta do APK, Google Play, TestFlight e App Store. |

O endereço de produção da API configurado no código é `https://api.kavicki.com`: no painel, em `swi-admin/.env.production`; no app, nos perfis do `mobile/eas.json`.

## Documentação da API

Com a API no ar, `GET /docs` abre a interface do Swagger e `GET /docs-json` devolve a especificação OpenAPI. A mesma especificação está versionada em `swi-backend/docs/openapi.json`. Detalhes em [`swi-backend/README.md`](swi-backend/README.md).

## Documentos da entrega

| Arquivo | Conteúdo |
| --- | --- |
| [`CHANGELOG.md`](CHANGELOG.md) | O que cada versão entrega |
| [`NOTICE.md`](NOTICE.md) | Aviso de propriedade do código |
| [`ANEXO-III-LICENCAS.md`](ANEXO-III-LICENCAS.md) | Bibliotecas de terceiros usadas diretamente e suas licenças. Gerado por `node scripts/licenses/generate-anexo-iii.mjs` com as dependências instaladas nos três projetos |
| [`MANUAL-PREDICAO-DE-FADIGA-E-DADOS-BIOMETRICOS.md`](MANUAL-PREDICAO-DE-FADIGA-E-DADOS-BIOMETRICOS.md) | Manual do algoritmo de predição de fadiga e do tratamento dos dados biométricos |

## Estrutura do repositório

```
swi-backend/                 API
swi-admin/                   painel web
mobile/                      app do trabalhador e app do relógio
scripts/
  client/                    scripts da demonstração por duplo clique
  client-delivery/           montagem do pacote de entrega do código
  source-delivery/           exportação do código em texto
  e2e/                       infraestrutura descartável dos testes de navegador
  quality/                   portões de higiene e de tamanho de arquivo
  security/                  portão de vulnerabilidades das dependências
  licenses/                  gerador do Anexo III
.github/workflows/ci.yml     integração contínua
START-SWI.cmd, STOP-SWI.cmd  demonstração local por duplo clique
docker-compose.client.yml    stack da demonstração local
```
