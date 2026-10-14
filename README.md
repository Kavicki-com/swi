# SWI

Plataforma de monitoramento de trabalhadores em campo voltada à segurança do trabalho. O SWI acompanha localização, jornada, sinais vitais e comunicação de equipes em operação, com suporte a alertas, evacuação e resgate.

O sistema é composto por três aplicações independentes neste repositório, mais um design system publicado à parte.

## Aplicações do repositório

| Pasta          | App                  | Stack                                   |
| -------------- | -------------------- | --------------------------------------- |
| `swi-admin/`   | Painel web (gestão)  | Vite + React 18 + react-native-web      |
| `mobile/`      | App do trabalhador   | Expo Router + React Native              |
| `swi-backend/` | API                  | NestJS + Prisma + PostgreSQL            |

As três aplicações são **deliberadamente isoladas**: cada uma tem seu próprio `package.json`, `node_modules/` e lockfile. Não há monorepo, workspaces nem configuração compartilhada na raiz. Cada app roda a partir da sua própria pasta.

O **design system** (`@kavicki/swi-design-system`) é mantido em repositório separado e consumido como dependência. Painel e app compartilham a mesma linguagem visual através dele.

## Pré-requisitos

- **Node.js 22.23.2** (fixado em `.nvmrc` / `.node-version`)
- **PostgreSQL** para o backend (local ou gerenciado)
- Para o app: conta Expo e, para builds nativos, EAS

## Como rodar

### Painel web (`swi-admin/`)

```bash
cd swi-admin
npm install
npm run dev          # http://localhost:5173
npm run storybook    # http://localhost:6007
```

### App mobile (`mobile/`)

```bash
cd mobile
npm install
npm start            # Expo (QR code, emulador ou dispositivo)
npm run android      # abre direto no Android
npm run ios          # abre direto no iOS
```

### Backend (`swi-backend/`)

```bash
cd swi-backend
npm install
npm run prisma:generate
npm run prisma:migrate   # aplica as migrations
npm run prisma:seed      # popula dados de desenvolvimento
npm run start:dev        # API em modo watch
```

Configure as variáveis de ambiente do backend (banco, chaves, storage de mídia) antes de subir. Veja `swi-backend/.env.example`.

## Verificação e testes

Cada app expõe o mesmo contrato de qualidade, espelhando o CI (`.github/workflows/ci.yml`):

```bash
# dentro de cada app
npm run lint
npm run typecheck
npm test
npm run build
```

- **`swi-admin`**: Vitest + Testing Library, Playwright para e2e, build Vite, Storybook.
- **`mobile`**: Jest, Playwright para e2e, `expo export` no build. Atalho: `npm run verify`.
- **`swi-backend`**: Jest unit + e2e, build NestJS. Atalho: `npm run verify`. O CI roda em matriz Node 18 e 22 (18 é a hospedagem, 22 é o ambiente de container).

## Estrutura do repositório

```
SWI/
  swi-admin/      painel web de gestão
  mobile/         app React Native do trabalhador
  swi-backend/    API NestJS + Prisma
  scripts/        utilitários de qualidade, e2e e deploy
  .github/        workflows de CI
  README.md
  NOTICE.md       avisos de licença de terceiros
```

## Deploy

- **Painel e API**: hospedados em produção pelo cliente (Cloudez). A API não roda migration sozinha no deploy: ela é aplicada de forma controlada.
- **App mobile**: empacotado via EAS (builds Android/iOS) e distribuído por TestFlight / APK.

## Interface

A camada visual do painel e do app vem do pacote `@kavicki/swi-design-system`, consumido como dependência. Painel (web) e app (mobile) compartilham os mesmos componentes e tokens através dele.
