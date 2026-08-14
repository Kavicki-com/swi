# SWI

Sistema de monitoramento de segurança de trabalhadores em campo. O SWI é composto
por **três projetos** neste mesmo repositório, mais a API pública que já roda em
produção:

| Pasta | O que é | Tecnologia |
| --- | --- | --- |
| `swi-backend/` | API, banco de dados, e-mail, armazenamento de arquivos e fila de notificações | NestJS + Prisma + PostgreSQL |
| `swi-admin/` | Painel web usado pelo administrador | Vite + React + design system próprio |
| `mobile/` | Aplicativo Android do trabalhador | Expo (React Native) |

Os três são **independentes**: cada um tem o próprio `package.json`, o próprio
`node_modules/` e o próprio lockfile. Não há workspace, monorepo tooling nem
configuração compartilhada na raiz. Cada projeto é instalado e executado de
dentro da própria pasta.

---

## Só quero ver o sistema funcionando

Não precisa instalar Node, npm nem Git. **O único requisito é o Docker Desktop.**

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/) e
   espere ele terminar de iniciar.
2. Dê **duplo clique em `START-SWI.cmd`**, na raiz desta pasta.
3. Espere. O navegador abre sozinho no painel, em `http://localhost:5173`.

Para desligar, duplo clique em `STOP-SWI.cmd`. Os dados ficam salvos.

O passo a passo completo, com o que cada endereço serve, onde ler os e-mails do
sistema e quanto de disco a instalação ocupa, está em
**[`docs/client/INSTALL-WINDOWS.md`](docs/client/INSTALL-WINDOWS.md)**.

Se algo falhar, vá direto para
**[`docs/client/TROUBLESHOOTING.md`](docs/client/TROUBLESHOOTING.md)**.

---

## O que roda onde

Este é o ponto que mais gera confusão, então vale ser explícito. Existem **dois
backends diferentes** em jogo, e eles não são o mesmo:

| | Backend local (o do duplo clique) | API pública |
| --- | --- | --- |
| Endereço | `http://localhost:3000` | `https://api.kavicki.com` |
| Quem usa | O painel web em `http://localhost:5173` | O **aplicativo Android** (APK) |
| Onde roda | Na máquina de quem deu o duplo clique, em containers Docker | Em servidor na internet |
| Banco de dados | PostgreSQL do container, descartável | PostgreSQL do servidor |
| Arquivos | MinIO do container | Armazenamento de objetos do servidor |
| E-mails | Não saem para a internet, ficam em `http://localhost:8025` | SMTP de verdade, chegam na caixa do destinatário |
| Dados | Os de demonstração carregados pelo `START-SWI` | Os de produção |

Consequência prática: o que você cadastra no painel local **não** aparece no
aplicativo Android, e o contrário também vale. São dois ambientes separados de
propósito. O painel local existe para o sistema poder ser aberto e avaliado sem
depender de servidor, credencial ou internet além do download das imagens.

---

## O que é real e o que é simulado

O sistema tem backend de verdade: banco relacional com migrations versionadas,
autenticação com JWT, aprovação de cadastro por administrador, upload de
arquivos com URL assinada, chat por WebSocket, fila de notificações e envio de
e-mail. Nada disso é tela de mentira.

Há, porém, **partes deliberadamente simuladas**, e é honesto declará-las:

- **Sinais vitais e telemetria de smartband.** Batimentos, temperatura e nível de
  desgaste são gerados pelo sistema, não lidos de um dispositivo. É decisão de
  produto: os dados de saúde só passam a ser reais quando a pulseira for
  adquirida e integrada. As telas foram construídas para receber o dado real sem
  mudança de layout, e toda superfície que exibe esses números carrega o selo
  `SimulatedDataBadge` ("Dados simulados"), para o operador nunca confundir
  biometria fabricada com sinal de sensor.
- **Pareamento Bluetooth da smartband** no aplicativo, pelo mesmo motivo.
- **Movimentação dos trabalhadores no mapa** da stack local. O container da API
  sobe com `SIM_POSITIONS=1`, que faz as posições variarem para o mapa não ficar
  parado numa demonstração. A API pública não liga essa simulação.
- **Alerta de tempestade** da stack local, pelo mesmo motivo
  (`WEATHER_SCENARIO=alert`).

E há limites de escopo do que foi entregue:

- **iOS não faz parte da entrega.** O código do aplicativo é React Native e tem
  configuração de iOS no projeto, mas nenhuma build de iOS foi gerada, assinada
  ou testada, e distribuir na App Store exige conta de desenvolvedor Apple paga.
- **A versão web do aplicativo (Expo web) não é suportada.** O produto web
  entregue é o painel administrativo, não o aplicativo rodando em navegador.
- **Notificações push não estão neste build.** O aplicativo tem central de
  notificações interna e o backend tem a fila que as produz, mas o envio de push
  pelo sistema operacional exige configuração de projeto Firebase/APNs que não
  foi feita. O botão de notificações na tela de preferências do aplicativo é
  visual.

---

## Desenvolvimento

Aqui, sim, é preciso Node. A versão é **fixada**, e não é sugestão: o CI, o
Dockerfile, o `.nvmrc` e o `.node-version` apontam todos para a mesma.

```
Node 22.23.2    npm 10.9.x
```

Os três `package.json` declaram `"node": ">=22.11.0 <23"`. A faixa é intencional:
o ambiente de hospedagem roda 22.11.0, e um pin exato quebraria o deploy.

Instale por projeto, nunca na raiz:

```bash
cd swi-backend && npm ci
cd swi-admin   && npm ci
cd mobile      && npm ci
```

### Backend

Precisa de configuração antes de subir. Veja
[`swi-backend/README.md`](swi-backend/README.md); em resumo, copie
`swi-backend/.env.example` para `swi-backend/.env` e defina um `JWT_SECRET`
forte, senão o Compose falha na hora de interpolar a variável.

```bash
cd swi-backend
docker compose up -d --build   # Postgres, MailHog, MinIO e a API
npm run prisma:seed            # dados de demonstração (não roda sozinho)
npm run verify                 # lint + typecheck + testes + build
```

### Painel web

```bash
cd swi-admin
npm run dev            # http://localhost:5173
npm test               # Vitest
npm run typecheck
npm run lint
npm run build          # gera dist/
npm run storybook      # http://localhost:6007
npm run test:e2e:managed   # Playwright com a stack de teste subida pelo runner
```

Por padrão o painel de desenvolvimento aponta para `http://localhost:3000`. Para
apontar para outro lugar, use `VITE_API_URL` em `swi-admin/.env.local`.

### Aplicativo

```bash
cd mobile
npx expo start         # e então 'a' para abrir no Android
npm test               # Jest
npm run typecheck
npm run lint
```

O aplicativo escolhe a origem dos dados por variáveis de ambiente
(`EXPO_PUBLIC_AUTH_BACKEND`, `EXPO_PUBLIC_DATA_BACKEND`, `EXPO_PUBLIC_API_URL`).
Os perfis de build estão em `mobile/eas.json`; o perfil `qa` é o que gera o APK
apontando para `https://api.kavicki.com`.

---

## Testes e integração contínua

O workflow em `.github/workflows/ci.yml` roda em todo pull request e em todo push
para a `main`, sempre em Node 22.23.2:

| Job | O que faz |
| --- | --- |
| `mobile` | `expo-doctor`, lint, typecheck, testes com cobertura e `expo export` das três plataformas como smoke de build |
| `admin` | lint, typecheck, testes com cobertura, portão de tamanho de arquivo, build e build do Storybook |
| `backend` | Prisma generate, lint, typecheck, testes com cobertura e build |
| `backend-integration` | testes ponta a ponta da API contra Postgres e MinIO de verdade |
| `admin-e2e` | Playwright no painel, com a API real subida pelo runner |
| `security` | `npm audit` confrontado com `scripts/security/audit-policy.json`, onde cada tolerância tem justificativa, responsável e prazo. Exceção vencida bloqueia |

Os três projetos exigem **80% de cobertura** de testes; abaixo disso o job falha.

Os testes ponta a ponta usam `scripts/e2e/run-test-stack.mjs`, que sobe uma
infraestrutura descartável em portas próprias, aplica as migrations, roda o seed
e derruba tudo ao final.

---

## Estrutura do repositório

```
SWI/
  START-SWI.cmd                inicia tudo (duplo clique)
  STOP-SWI.cmd                 desliga preservando os dados
  docker-compose.client.yml    a stack que o duplo clique sobe
  scripts/
    client/                    os scripts PowerShell chamados pelos .cmd
    e2e/                       runner da stack descartável de testes
    security/                  política de vulnerabilidades tolerada
    quality/                   portões de qualidade usados no CI
  docs/
    client/                    documentação de instalação, aceite e problemas
    plans/                     documentos de planejamento e decisão
    runbooks/                  procedimentos operacionais
    audits/                    auditorias visuais e de fidelidade
  swi-backend/                 API (NestJS + Prisma + Postgres)
  swi-admin/                   painel web (Vite + React)
  mobile/                      aplicativo Android (Expo)
```

## Convenção de branches

As branches são prefixadas pelo projeto que tocam, para a lista continuar
legível: `feat/admin-*`, `fix/mobile-*`, `chore/backend-*`, `chore/repo-*`. Uma
branch não deve tocar dois projetos ao mesmo tempo.

## Licença

Software proprietário. Veja [`NOTICE.md`](NOTICE.md).
