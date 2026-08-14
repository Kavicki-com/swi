# Plano de Correção e Entrega do SWI ao Cliente

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Registro de execução (2026-08-14)

- **Origem:** plano gerado pelo Codex em 2026-08-13 em Plan Mode, que não permite gravar arquivos rastreados. Registrá-lo aqui é a primeira ação da Etapa 0.
- **Baseline auditada:** `c62edd99282af098ef369ed64f894007ee4f3083`, head da `main` no início da execução.
- **Decisões do responsável (2026-08-14).** Onde este registro conflitar com o texto original abaixo, vale o registro:
  1. **Branches:** em vez da branch única `codex/client-delivery-readiness`, a execução usa uma branch por lote, seguindo a convenção do repositório (`chore/repo-*`, `fix/backend-*`, `fix/mobile-*`, `chore/admin-*`). Lotes que atravessam mais de um app vão como `chore/repo-*`, caso em que a autorização explícita exigida pelo CLAUDE.md já foi concedida.
  2. **Runtime:** confirmado Node 22 LTS mais npm 10 como runtime oficial (engines, CI e Docker), e o desenvolvimento local passa a usar Node 22 via nvm-windows. As versões exatas citadas no texto (22.23.2 e 10.9.8) serão conferidas contra a distribuição oficial no Lote 1; se divergirem, vale a mais recente da linha 22 LTS.

     **Correção de 2026-08-14, depois do Lote 1.** O painel da hospedagem mostrou que a API de produção já roda **Node 22.11.0**, e não Node 18 como o comentário antigo do CI afirmava. Duas consequências. A etapa "atualizar a hospedagem do backend para Node 22" já estava cumprida antes de o plano existir. E o pin exato que a Etapa 1 pede (`engines.node = "22.23.2"`, `engines.npm = "10.9.8"`) somado ao `engine-strict` quebraria o deploy, porque o Node 22.11.0 traz npm 10.9.0 e as duas checagens falhariam por diferença de patch. Por isso o `engines` dos três projetos declara a FAIXA `>=22.11.0 <23` e `>=10.9.0 <11`, que é o contrato real (linha 22 LTS), enquanto `.nvmrc`, `.node-version`, CI e Dockerfile seguem exatos em 22.23.2, onde nós controlamos o ambiente.
  3. **Expo web:** a página informativa de "o acesso web ocorre pelo painel" vale somente para build web de release. Em dev e teste o app web continua funcional, preservando o smoke E2E web do mobile no stack gerenciado.
  4. **Guard de API local do painel (decidido no Lote 4).** A Etapa 4 pede um painel de produção servido em `http://localhost:5173` conversando com a API em `http://localhost:3000`, e `resolveApiUrl` (`swi-admin/src/services/api/apiConfig.ts`) recusava exatamente esse par. O guard passou a considerar também a ORIGEM DA PÁGINA: só recusa API local quando a página NÃO veio de origem local. É o que o comentário do arquivo já dizia proteger (um deploy público cujo bundle aponta para a máquina de quem abriu o navegador); quando o painel é servido da própria máquina, essa máquina é o servidor e não há o que proteger. Origem desconhecida (sem `window`) cai no lado estrito. A alternativa considerada e descartada foi uma variável de opt-in (`VITE_ALLOW_LOCAL_API`), que exigiria plumbing de build arg e uma env a mais no contrato para expressar a mesma condição.

     **Stack do cliente é um arquivo completo, não uma sobreposição.** `docker-compose.client.yml` vive na raiz e não estende `swi-backend/docker-compose.yml`, porque o Compose CONCATENA a lista `ports` entre arquivos em vez de substituí-la: sobrepondo, as publicações `5432:5432` e `9000:9000` do arquivo de desenvolvimento continuariam valendo em todas as interfaces e a exigência de prender tudo a `127.0.0.1` seria impossível de cumprir.

     **`NODE_ENV=development` na API do stack do cliente** não é descuido: `assertSeedAllowed` recusa semear fora de development/test, e `parseRuntimeEnv` proíbe origin de loopback e exige https no CORS sob `production`. As duas peças tornam `development` a única configuração coerente para uma demonstração que roda inteira na máquina do cliente. A API pública não usa este arquivo.
- **Defeito conhecido, correção adiada por decisão do responsável (achado no Lote 4).** `scripts/e2e/seed-e2e.mjs:126` ainda monta a URL do módulo com `new URL('file:///' + caminho)`, o mesmo defeito que o Lote 2 corrigiu em `scripts/e2e/run-test-stack.mjs`. Fora do Windows a expressão produz quatro barras, nunca casa com `import.meta.url`, e o seed vira **no-op silencioso**: o script termina com código 0 sem escrever nada no banco. O job `admin-e2e` que o Lote 2 acrescentou roda em runner Linux e foi verificado só localmente no Windows, então ele vai semear nada e quebrar no login. A correção é a mesma já aplicada no runner (`pathToFileURL`) mais o teste correspondente. **Fica fora do Lote 4 por decisão do responsável em 2026-08-14**; até ser feita, o CI em Linux permanece vermelho nesse job.
- **Planos substituídos:** `2026-08-05-source-delivery-hygiene-design.md` e `2026-08-05-source-delivery-hygiene.md`, da entrega em TXT. A higienização executada por eles continua válida e já está na `main`; o que este plano substitui é o formato e o processo de entrega ao cliente.
- **Mapa de execução:** cada etapa numerada abaixo é um lote com branch própria. Lote 0 corresponde à Etapa 0 (branch `chore/repo-delivery-plan`), Lote 1 à Etapa 1, e assim por diante até o Lote 8. O nome da branch de cada lote é definido na abertura dele.

## Resumo

**Objetivo:** entregar um pacote independente do GitHub que permita ao cliente, em Windows 10/11, abrir o painel web e backend localmente e instalar um APK Android funcional.

**Arquitetura da entrega:**

- Monorepo completo: `mobile/`, `swi-admin/`, `swi-backend/`, testes, assets, migrations, scripts e documentação.
- Site e backend iniciados por duplo clique, usando Docker Desktop.
- APK Android `1.0.1` apontando para `https://api.kavicki.com`.
- Node.js `22.23.2` e npm `10.9.8` fixados em desenvolvimento, CI e Docker.
- ZIP gerado somente de um commit aprovado, nunca copiando a worktree local.
- Credenciais de demonstração da API pública enviadas fora do ZIP.
- Nenhuma entrega enquanto CI, segurança, instalação limpa, navegador e aparelho físico não estiverem verdes.

## Etapas de implementação

### 0. Registrar o plano e substituir a entrega TXT

- Criar este `.md` na branch `codex/client-delivery-readiness`.
- Marcar os planos anteriores de entrega TXT como substituídos por este plano executável.
- Registrar `c62edd99282af098ef369ed64f894007ee4f3083` como baseline auditada.
- Trabalhar com commits convencionais pequenos e TDD; não alterar `main` diretamente.

### 1. Padronizar runtime e instalações limpas

- Criar `.nvmrc` e `.node-version` com `22.23.2`.
- Adicionar nos três `package.json`:
  - `engines.node = "22.23.2"`;
  - `engines.npm = "10.9.8"`;
  - `packageManager = "npm@10.9.8"`.
- Ativar `engine-strict` nos três projetos.
- Regenerar os três lockfiles usando npm 10.9.8, corrigindo o lock incompleto do mobile.
- Fixar CI e Docker em Node 22.23.2; remover a matriz Node 18.
- Atualizar a hospedagem do backend para Node 22 antes do próximo deploy.
- Converter o Dockerfile do backend para build multi-stage e substituir `npm install` por `npm ci`.
- Manter no runtime somente dependências necessárias à API e ao `prisma migrate deploy`.

### 2. Corrigir CI e infraestrutura de testes

- Criar um setup compartilhado para E2E do backend que defina, antes do `AppModule`, `NODE_ENV=test`, JWT descartável e configurações MinIO determinísticas.
- Remover as configurações MinIO duplicadas das suítes depois de cobri-las pelo setup comum.
- Corrigir `scripts/e2e/run-test-stack.mjs` para:
  - injetar seu próprio JWT descartável no Compose;
  - nunca imprimir o segredo;
  - esperar health HTTP, migrations e seed, não apenas porta TCP;
  - encerrar containers mesmo após falha.
- Atualizar `backend-integration` no CI com todas as variáveis de teste necessárias.
- Incluir o E2E Playwright do painel no CI, instalando Chromium no job.
- Manter cobertura mínima global de 80% nos três projetos.
- Tratar o painel administrativo como único site suportado. O Expo web exibirá apenas uma página informando que o acesso web ocorre pelo painel, sem montar autenticação ou providers mobile.

### 3. Fechar segurança de código e dependências

- Atualizar todas as dependências diretas com correção publicada, sem `npm audit fix --force`.
- Adaptar código e testes quando um upgrade major for indispensável para corrigir vulnerabilidade explorável.
- Corrigir especialmente React Router no admin e Nest/Express, Multer, Nodemailer, bcrypt/node-pre-gyp e tar no backend.
- Criar uma política versionada para `npm audit`:
  - bloquear achados `critical/high` corrigíveis ou alcançáveis em runtime;
  - permitir exceção somente sem correção disponível e sem caminho explorável no produto;
  - exigir pacote, advisory, justificativa, responsável e expiração máxima de 90 dias;
  - bloquear exceção vencida.
- Remover `continue-on-error` do job de segurança.
- Alterar `resolveApiUrl` do mobile para aceitar apenas HTTPS em release; HTTP continuará permitido somente em dev/teste local.
- Criar `resolveTrustedMediaUrl`/`openTrustedMediaUrl`:
  - somente HTTPS em release;
  - sem usuário ou senha embutidos;
  - origem exata pertencente à API ou a `EXPO_PUBLIC_MEDIA_ORIGINS`;
  - rejeição de `javascript:`, `file:`, subdomínios enganosos e origens não autorizadas;
  - erro amigável sem abrir o link.
- Substituir os dois `Linking.openURL(exam.fileUrl)` diretos pelo helper seguro.
- Descobrir a origem real do storage por uma URL presigned da API pública e registrá-la nos perfis EAS.
- Executar Gitleaks no repositório e novamente no ZIP final.
- Adicionar `NOTICE.md`: software proprietário, sem licença open source, com uso e transferência regidos pelo contrato.

### 4. Criar inicialização do site por duplo clique

- Adicionar imagem Docker de produção para o admin: build Vite com npm lockado e servidor Nginx com fallback SPA e healthcheck.
- Adicionar o serviço `admin` ao Compose e restringir, por padrão, todas as portas a `127.0.0.1`.
- Manter o fallback Esri existente quando não houver token Mapbox; a ausência do token não poderá quebrar o painel.
- Criar:
  - `START-SWI.cmd`;
  - `STOP-SWI.cmd`;
  - scripts PowerShell correspondentes em `scripts/client/`.
- O início deve:
  - verificar Docker Desktop;
  - gerar um JWT forte em arquivo ignorado, sem sobrescrever configuração existente;
  - construir e subir Postgres, MinIO, MailHog, API e admin;
  - aplicar migrations e seed idempotente;
  - esperar `http://localhost:3000/health`;
  - esperar o site em `http://localhost:5173`;
  - abrir o navegador automaticamente;
  - mostrar credenciais exclusivamente locais.
- O encerramento preservará volumes e dados. Nenhum comando de reset destrutivo fará parte do fluxo padrão.

### 5. Reescrever documentação e suporte

- Transformar o README raiz em documentação real do monorepo, eliminando a descrição antiga de frontend isolado.
- Criar `docs/client/INSTALL-WINDOWS.md`, `ACCEPTANCE-CHECKLIST.md` e `TROUBLESHOOTING.md`.
- Documentar:
  - Docker Desktop como único requisito para abrir site/backend;
  - Node apenas para desenvolvimento do fonte;
  - URLs e credenciais locais;
  - instalação e permissões do APK;
  - internet obrigatória para dependências, imagens Docker e API pública;
  - diferença entre backend local do site e API pública usada pelo APK;
  - vitais/smartband ainda simulados por decisão de produto;
  - ausência de suporte entregue para iOS e Expo web.
- Corrigir o README do backend: `docker compose up` isolado não será mais apresentado como suficiente sem ambiente/JWT.
- Atualizar o runbook de QA e remover instruções contraditórias ou obsoletas de túnel e MailHog.

### 6. Gerar e validar o APK Android

- Atualizar a versão visível para `1.0.1`.
- Validar o perfil EAS `qa` com:
  - `AUTH_BACKEND=api`;
  - `DATA_BACKEND=api`;
  - `API_URL=https://api.kavicki.com`;
  - mocks de demonstração ausentes;
  - origens de mídia explicitamente autorizadas.
- Gerar APK assinado e nomeá-lo `SWI-Android-1.0.1.apk`.
- Instalar em aparelho Android físico e testar:
  - instalação e primeiro início;
  - login com conta de demonstração aprovada;
  - dashboard e navegação;
  - mapas e localização;
  - permissões de câmera, galeria e notificações;
  - upload e abertura de exame;
  - chat, relatórios, jornada, clima e evacuação;
  - tratamento de API indisponível;
  - logout e nova autenticação.
- Registrar versão, package ID, impressão do certificado e SHA-256.
- Não incluir keystore, token EAS ou credenciais da API no pacote.

### 7. Gerar o pacote independente do GitHub

- Criar exportador e verificador em `scripts/client-delivery/`, desenvolvidos com testes.
- Gerar o ZIP via `git archive` do commit aprovado.
- Incluir fonte, testes, assets, migrations, configs, CI, scripts executáveis e documentação do cliente.
- Rejeitar automaticamente `.git`, `.env*` reais, `node_modules`, caches, coverage, builds, `.aab`, pacotes TXT antigos, arquivos locais de máquina e configurações internas de agentes.
- Produzir:
  - `SWI-source-1.0.1.zip`;
  - `SWI-Android-1.0.1.apk`;
  - `DELIVERY-MANIFEST.json`;
  - `SHA256SUMS.txt`.
- O manifesto conterá commit, versões Node/npm, data, arquivos, tamanhos e hashes, sem dados pessoais ou segredos.
- Extrair o ZIP em uma máquina Windows limpa e em caminho com espaços. Toda validação final deve ocorrer nessa extração, não na worktree de desenvolvimento.
- Entregar os arquivos por canal privado; credenciais da API pública seguem separadamente.

### 8. Gate final e GitHub

- Exigir PR revisado por qualidade e segurança e CI integralmente verde.
- Confirmar `main` limpa, commit final imutável e hashes correspondentes.
- Tornar o repositório GitHub privado antes da entrega, após confirmar que nenhum deploy depende de checkout público.
- Criar uma conta de demonstração de menor privilégio na API pública e validá-la no APK.
- Não liberar o pacote se algum gate abaixo estiver vermelho.

## Interfaces e contratos alterados

- Runtime oficial: Node `22.23.2` e npm `10.9.8`, conforme a [distribuição oficial Node 22 LTS](https://nodejs.org/en/download/archive/v22).
- Nova variável pública mobile: `EXPO_PUBLIC_MEDIA_ORIGINS`, CSV de origens HTTPS exatas.
- API pública REST não muda de formato.
- Novos comandos para o cliente: `START-SWI.cmd` e `STOP-SWI.cmd`.
- Portas locais: admin `5173`, API `3000`, MailHog `8025`, MinIO `9000/9001`, todas ligadas a localhost.
- Produto web suportado: somente `swi-admin`.
- Produto móvel suportado: APK Android; iOS fica fora desta entrega.

## Testes e critérios de aceite

| Gate | Critério obrigatório |
|---|---|
| Instalação | `npm ci` passa nos três projetos com Node/npm fixados, em Windows e Linux |
| Mobile | Expo Doctor 100%, lint, typecheck, cobertura maior ou igual a 80%, export Android e testes existentes verdes |
| Admin | lint, typecheck, 867+ testes, cobertura maior ou igual a 80%, build, Storybook e Playwright verdes |
| Backend | Prisma generate, lint, typecheck, 491+ unitários, cobertura maior ou igual a 80%, build Docker e 79/79 E2E verdes |
| Segurança | Gitleaks limpo; zero `critical/high` corrigível ou explorável fora da política de exceções |
| Stack local | Duplo clique sobe tudo; health 200; login local, navegação, mapa fallback e upload funcionam |
| APK | Instala e passa o smoke completo em aparelho físico contra a API pública |
| Pacote | ZIP abre em Windows limpo, contém os três projetos e não contém Git, segredos, caches ou builds locais |
| GitHub | PR e `main` verdes; repositório privado; pacote corresponde exatamente ao commit aprovado |

## Premissas fechadas

- Cliente usa Windows 10/11 e possui acesso à internet.
- Docker Desktop pode ser instalado e executado.
- Dependências npm e imagens Docker serão baixadas; não haverá pacote offline.
- O APK usa a API pública atual.
- Credenciais de demonstração são fornecidas fora do ZIP.
- Vulnerabilidades corrigíveis ou exploráveis bloqueiam; transitivos sem correção exigem exceção temporária documentada.
- Não será feito upgrade major generalizado de Expo/React Native/Nest sem necessidade de segurança ou compatibilidade comprovada.
- Vitais e smartband permanecem simulados e serão declarados como limitação conhecida.
- A entrega não inclui GitHub, iOS, TestFlight nem aplicação Expo web.
