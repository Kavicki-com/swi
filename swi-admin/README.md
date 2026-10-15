# swi-admin

Painel web de gestão do SWI: dashboard operacional, funcionários, mapa geral, câmeras e transmissão ao vivo, chat, tarefas e relatórios, alertas, evacuação e resgate, e monitoramento de saúde. Conversa com a API (`swi-backend`) por HTTP e por WebSocket.

Stack: React 18 com react-native-web, Vite 5, React Router 6, styled-components, MapLibre GL para os mapas e socket.io-client para o tempo real. Os componentes visuais e os tokens vêm do design system `@kavicki/swi-design-system`, distribuído como pacote em `vendor/`.

## Pré-requisitos

- Node.js na faixa `>=22.11.0 <23` e npm `>=10.9.0 <11`. A versão de referência é a de `.nvmrc` na raiz (22.23.2). O `.npmrc` tem `engine-strict=true`, então a instalação recusa outra versão.
- A API do SWI acessível, local ou publicada. Ver `../swi-backend/README.md`.
- Para os testes de navegador: Docker e o Chromium do Playwright.

## Instalação

```bash
cd swi-admin
npm ci
cp .env.example .env.local
```

O design system é instalado a partir de `vendor/kavicki-swi-design-system-<versão>.tgz`, declarado em `package.json`. Não é preciso acesso a registro privado.

## Como rodar

```bash
npm run dev
```

Abre o painel em `http://localhost:5173`, falando com a API em `VITE_API_URL` (padrão `http://localhost:3000`). Para entrar, use uma conta de administrador da API apontada; o seed do backend cria contas de demonstração (ver `../swi-backend/README.md`).

A origem do painel precisa estar em `CORS_ORIGINS` da API. O padrão da API já é `http://localhost:5173`.

Outros comandos:

- `npm run storybook`: catálogo dos componentes do painel em `http://localhost:6007`.
- `npm run preview`: serve localmente o build de `dist/`, depois de `npm run build`.

## Testes

Os mesmos passos do job `admin` de `.github/workflows/ci.yml`:

```bash
cd swi-admin
npm ci
npm run lint
npm run typecheck
npm test -- --coverage
npm run gate:file-size
npm run build
npm run storybook:build
```

- `npm test` roda o Vitest com Testing Library; com `--coverage` vale a cobertura mínima de 80% de `vitest.config.ts`.
- `npm run gate:file-size` falha se algum arquivo de `src/` passar de 800 linhas.

### Testes de navegador

Os mesmos passos do job `admin-e2e`, a partir da raiz do repositório:

```bash
cd swi-backend && npm ci && npx prisma generate && cd ..
cd swi-admin
npm ci
npx playwright install --with-deps chromium
npm run test:e2e:managed
```

O runner sobe em Docker um Postgres, um MinIO e um MailHog descartáveis, em portas próprias, aplica as migrations, roda o seed, compila e inicia a API real e então executa o Playwright contra o painel. Ao final derruba tudo. Por isso precisa das dependências do backend instaladas. O `--with-deps` instala as bibliotecas de sistema que o Chromium pede no Linux.

A infraestrutura de teste usa portas fixas: 55432 (Postgres), 51025 e 58025 (MailHog), 59000 e 59001 (MinIO). No Windows, o sistema reserva faixas de portas para virtualização, e elas podem mudar depois de um reinício (`netsh interface ipv4 show excludedportrange protocol=tcp` lista as faixas). Se uma dessas portas cair numa faixa reservada, o Docker recusa publicá-la e o runner para no início com "ports are not available".

## Build

```bash
npm run build
```

Gera `dist/`, só HTML, CSS e JavaScript estáticos. As variáveis `VITE_*` são resolvidas **no build** e ficam gravadas no bundle: mudar o endereço da API exige um build novo.

O `.env.production` versionado aponta para `https://api.kavicki.com` e tem prioridade sobre o `.env.local` no build. Para gerar um build apontado para outra API, defina `VITE_API_URL` no ambiente do comando, que vence os arquivos:

```bash
VITE_API_URL=https://api.exemplo.com npm run build
```

## Deploy

O painel é uma aplicação de página única: qualquer servidor de arquivos estáticos serve, desde que toda rota sem arquivo correspondente devolva o `index.html` (senão recarregar a página em `/dashboard` responde 404).

- **Servidor estático (Nginx, Apache, hospedagem comum).** Publique o conteúdo de `dist/` e configure o fallback para `index.html`. O `nginx.conf` desta pasta é uma configuração pronta: fallback de rotas, compressão e cache longo para `assets/`, cujos nomes levam hash de conteúdo.
- **Vercel.** O `vercel.json` já declara o build e o fallback.
- **Docker.** O `Dockerfile` compila e entrega o `dist/` servido por Nginx na porta 80. O endereço da API entra como argumento de build, e o padrão do argumento é o ambiente local (`http://localhost:3000`), que vence o `.env.production`. Para produção, passe o endereço público. Da raiz do repositório:

  ```bash
  docker build --build-arg VITE_API_URL=https://api.exemplo.com --build-arg VITE_MAPBOX_TOKEN=pk.seu_token -t swi-admin swi-admin
  docker run -p 8080:80 swi-admin
  ```

Ao publicar o painel em um domínio novo:

1. Inclua a origem exata (por exemplo `https://painel.exemplo.com`) em `CORS_ORIGINS` da API.
2. Ajuste `ADMIN_APP_URL` da API, usado nos links de e-mail.
3. Inclua a origem na política de CORS do bucket de mídia (métodos `PUT` e `GET`), porque o upload de anexos sai direto do navegador para o armazenamento.
4. Se usar token do Mapbox, libere a origem na restrição de URL do token.

Para trocar uma versão no ar sem janela de indisponibilidade, copie primeiro os arquivos novos de `assets/` e substitua o `index.html` por último.

## Variáveis de ambiente

Lidas no build, a partir de `.env.local` (desenvolvimento), `.env.production` (build) ou do ambiente do comando. Tudo o que começa com `VITE_` vai para o bundle que o navegador baixa: **nenhuma** destas variáveis pode conter segredo.

| Variável | Obrigatória | Padrão | Significado |
| --- | --- | --- | --- |
| `VITE_API_URL` | no build de produção | `http://localhost:3000` em desenvolvimento; `https://api.kavicki.com` pelo `.env.production` | Endereço base da API, sem barra final. Usado pelo HTTP e pelos sockets. Ausente num build de produção, o painel mostra o erro de configuração na primeira requisição. Um endereço local (`localhost`, `127.0.0.1`) só é aceito em produção quando o próprio painel também é servido de endereço local. |
| `VITE_MAPBOX_TOKEN` | | | Token público do Mapbox (`pk.*`) para as imagens de satélite dos mapas. Sem ele os mapas usam o Esri World Imagery, que não pede chave, com cobertura menor nos níveis de zoom mais próximos. Restrinja o token por URL no painel do Mapbox. |

## Estrutura

```
swi-admin/
  src/
    app/          rotas, layout e guardas de autenticação
    pages/        telas, cada uma com seus componentes e hooks
    components/   composições compartilhadas entre telas
    services/     cliente HTTP, sockets e acesso à API
    lib/          utilitários
  e2e/            testes de navegador (Playwright)
  vendor/         pacote do design system
  public/         arquivos servidos como estão
  nginx.conf      configuração do servidor estático
  Dockerfile
```
