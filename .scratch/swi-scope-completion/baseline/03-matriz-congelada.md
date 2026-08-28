# Baseline 03: Matriz de rastreabilidade congelada

**Tickets:** 05, 06, 07 (coleta por grupo) e 09 (congelamento)
**Commit-base:** `c93f02103075b8c432c8e9752f5837e41f42b3f7`
**Observado em:** 2026-08-25

Regra usada em toda linha: evidência é arquivo, endpoint, modelo ou teste lido neste commit. Citação de plano histórico não conta como evidência. Onde o plano e o código discordam, o código prevalece e a divergência está escrita.

## Mapa estrutural de partida

| Superfície     | O que existe                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend (Nest) | 17 módulos em `app.module.ts`: Prisma, Auth, Users, Profile, Media, Reports, Journey, WorkOrders, Chat, Realtime, Notification, Weather, Evacuation, Queue, Support, Positions, Companies   |
| Prisma         | 17 modelos: User, WorkerPosition, Company, Evacuation, EvacuationAck, Exam, Profile, SupportRequest, Report, Comment, Journey, WorkOrder, Task, Conversation, Message, Notification, WeatherAlertSeen |
| Mobile         | 52 rotas Expo Router; 14 serviços, incluindo `telemetry/`, `vitals/`, `location/`, `positions/`                                                                                            |
| Admin          | 13 áreas de página, incluindo `alerts/`, `maps/`, `monitoring/`, `tasks/`                                                                                                                  |

**Ausências estruturais confirmadas** (nenhum módulo backend, nenhum modelo Prisma): telemetria, câmeras, alertas como registro operacional, chave de idempotência, fadiga.

---

## Grupo A: Gestão, comunicação e relatórios (ticket 05)

### 1. Ordens de serviço

**Evidência:** `swi-backend/src/work-orders/work-orders.controller.ts` expõe 6 endpoints (`POST /`, `GET /`, `GET /assignable`, `GET /:id`, `PATCH /:id`, `DELETE /:id`); 5 specs no módulo. Modelos `WorkOrder` e `Task` no Prisma. Painel em `swi-admin/src/pages/tasks/`; mobile em `app/(app)/journey/task/[id].tsx`.
**Situação:** CRUD completo com exclusão, atravessando backend, painel e mobile.
**Classificação:** `EXECUTÁVEL AGORA`. Confirma a baseline do plano. Resta regressão e evidência de aceite, não construção.

### 2. Gestão de funcionários

**Evidência:** `swi-backend/src/users/users.controller.ts` com 9 endpoints e 3 specs; páginas `swi-admin/src/pages/employees/`.
**Situação:** cadastro e atividade existem. A telemetria mostrada no detalhe do funcionário vem de simulador (ver linha 16).
**Classificação:** `EXECUTÁVEL AGORA` para cadastro; a parte de telemetria cai no grupo C.

### 3. Gestão de administradores

**Evidência:** `swi-admin/src/pages/admins/AdminDetails.tsx`; fachada `swi-admin/src/services/admins.ts`, que `production-contract.test.ts` prova apontar para `api/users`.
**Situação:** igual à linha anterior. `AdminDetails.tsx` importa `simulatedVitals`.
**Classificação:** `EXECUTÁVEL AGORA` para cadastro; telemetria no grupo C.

### 4. Chat integrado

**Evidência:** `swi-backend/src/chat/chat.controller.ts` com 8 endpoints e 3 specs; modelos `Conversation` e `Message`; `swi-admin/src/services/chat/` (`ChatProvider`, `chatSocket`, `chatReducers`); mobile em `app/(app)/chat/`.
**Situação:** REST e socket implementados nas três superfícies.
**Classificação:** `EXECUTÁVEL AGORA`. Falta a fila offline, que é U09, não U00.

### 5. Relatórios admin

**Evidência:** `swi-backend/src/reports/reports.controller.ts` com 7 endpoints, incluindo `PATCH /:id` e `DELETE /:id` (204); `swi-admin/src/services/api/reports.ts` a 80% de statements. O commit-base é o merge do PR #134, "feat/admin-excluir-relatorio".
**Situação:** CRUD com anexos e comentários, exclusão recém-integrada.
**Classificação:** `EXECUTÁVEL AGORA`.

### 6. Relatórios mobile

**Evidência:** `mobile/services/reports/types.ts:53-59`. O contrato é exatamente:

```ts
export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  addComment(reportId: string, body: string): Promise<ReportComment>;
}
```

**Situação:** a alegação do plano se confirma, sem `update` e sem `remove`. **Divergência a favor do projeto:** o backend já expõe `PATCH /reports/:id` e `DELETE /reports/:id`. A lacuna é só do lado cliente, o que reduz o escopo da U01: não há trabalho de schema nem de controller, apenas contrato, adaptador e UI, mais concorrência e permissão.
**Classificação:** `EXECUTÁVEL AGORA`.

### 7. SOLID/MVC

**Evidência:** `swi-backend/src/app.module.ts:31` importa 17 módulos nomeados; cada domínio tem controller, service e specs próprios.
**Situação:** limites modulares preservados.
**Classificação:** `EXECUTÁVEL AGORA`. É restrição a manter, não entrega a fazer.

---

## Grupo B: Campo, mapas e continuidade (ticket 06)

### 8. Mapa admin: posições em tempo real

**Evidência:** `swi-backend/src/positions/positions.controller.ts` com 2 endpoints e 4 specs; modelo `WorkerPosition`; `swi-admin/src/services/positions/positionsSocket.ts` a 100% de cobertura; `swi-admin/src/pages/maps/hooks/useMapsGeneral.ts`.
**Situação:** posições e socket reais existem. Porém `swi-admin/src/services/api/positions.ts` importa `simulatedVitals`, então o que o mapa pinta sobre cada trabalhador mistura posição real com sinal vital simulado.
**Classificação:** posição `EXECUTÁVEL AGORA`; o sinal vital sobreposto pertence ao grupo C.

### 9. Timeline climática

**Evidência:** `swi-backend/src/weather/` com `weather.provider.ts` (`OpenMeteoProvider`), `weather.service.ts`, `weather-alert.service.ts` e 3 specs; `mobile/services/weather/`; `swi-admin/src/services/api/weather.ts` a 85,71% de statements e 60% de funções.
**Situação:** integração real com Open-Meteo funcionando. **Divergência relevante para a U06:** `weather.service.ts:25` injeta a classe concreta, `constructor(private readonly provider: OpenMeteoProvider)`. Não há token de interface, logo o provedor não é configurável hoje, ao contrário do que a premissa da seção 3 do plano exige.
**Classificação:** `EXECUTÁVEL AGORA`; a troca de provedor é trabalho real, não verificação.

### 10. Alertas meteorológicos e suporte

**Evidência:** `weather-alert.service.ts` com spec; modelo `WeatherAlertSeen`; `swi-backend/src/support/support.controller.ts` com 1 endpoint e 1 spec; modelo `SupportRequest`; `mobile/app/modals/weather-alert.tsx` e `modals/support-form.tsx`.
**Situação:** existem os dois fluxos, mas como notificação, não como registro operacional. Não há modelo com estados `open`/`acknowledged`/`in_progress`/`resolved`/`dismissed`, responsável, motivo nem histórico. Não há central administrativa de suporte.
**Classificação:** `EXECUTÁVEL AGORA` para o ciclo de alerta (U02); a ingestão de alerta oficial de autoridade depende de fornecedor.

### 11. GPS mobile em segundo plano

**Evidência:** `mobile/services/location/LocationProvider.tsx:23` chama `Location.requestForegroundPermissionsAsync()` e a linha 36 chama `Location.watchPositionAsync`. Busca por `startLocationUpdatesAsync`, `TaskManager` e `requestBackgroundPermissionsAsync` em todo o mobile: zero ocorrências. `mobile/package.json` declara `expo-location ~19.0.8` e não declara `expo-task-manager`.
**Situação:** confirma a baseline. Observação em primeiro plano apenas; a dependência necessária para background nem está instalada. Existe `services/positions/usePositionHeartbeat.ts`, que envia posição enquanto o app está aberto.
**Classificação:** `EXECUTÁVEL AGORA`, com dependência nova a instalar e configuração nativa a mexer.

### 12. Notificações web/mobile

**Evidência:** `swi-backend/src/notifications/notification.controller.ts` com 4 endpoints e 2 specs; `mobile/services/notifications/` com provider, reducers e adaptador de API; `mobile/app/(app)/notifications.tsx`. `mobile/package.json` não declara `expo-notifications`.
**Situação:** central em app e realtime existem; push nativo não existe, nem a dependência. O modelo Prisma é `Notification { workerId ... @@index([workerId, createdAt]) }`, o que confirma a migração de destinatário pedida pela U03.
**Classificação:** central `EXECUTÁVEL AGORA`; entrega nativa depende de credenciais.

### 13. Real-time Engine

**Evidência:** `swi-backend/src/realtime/realtime.gateway.ts:34` faz fan-out por sala de usuário (`this.server.to(this.room(id)).emit(...)`); 1 spec no módulo; consumidores em `swi-admin/src/services/chat/chatSocket.ts`, `services/positions/positionsSocket.ts` e `services/evacuations/`.
**Situação:** gateway funcionando e já usado por vários domínios.
**Classificação:** `EXECUTÁVEL AGORA`. Ressalva: `services/evacuations/evacuationsSocket.ts` está a 0% de cobertura no admin.

### 14. Funcionamento offline

**Evidência:** busca por `outbox`, `offlineQueue` e `persistQueue` em `mobile/services` e `mobile/app`: zero ocorrências.
**Situação:** confirma integralmente a baseline. Não há fila durável, não há cache de último estado, não há política de conflito. Do lado do servidor, nenhum modelo de chave idempotente e nenhum campo de versão nas entidades editáveis.
**Classificação:** `EXECUTÁVEL AGORA`; é construção do zero, e o plano corretamente a coloca antes do GPS de background.

### 15. Geolocalização global

**Evidência:** `swi-admin/src/services/cameras.ts:12` declara `CAMERA_LOCATIONS` como constante de módulo, consumida por `pages/maps/hooks/useMapsGeneral.ts:134-135`, com o comentário em `useMapsGeneral.ts:286` reconhecendo tratar-se de "a module-level constant".
**Situação:** o mapa tem pontos fixos embutidos no código do painel. Não há endpoint de leitura de câmeras nem modelo `Camera`.
**Classificação:** `EXECUTÁVEL AGORA`; ativação externa (streaming, credenciais) fica bloqueada por fornecedor.

---

## Grupo C: Telemetria, saúde e derivados (ticket 07)

Este grupo concentra o risco de leitura errada do escopo. Nenhuma linha aqui tem fonte real de medição.

### 16. Dashboard admin: BPM, MPM e temperatura

**Evidência:** `swi-admin/src/services/vitals/simulatedVitals.ts` é importado por 20 arquivos do admin, entre eles caminhos de produção: `services/api/dashboard.ts`, `services/api/monitoring.ts`, `services/api/positions.ts`, `services/api/rescue.ts`, `hooks/useMyVitals.ts`, `pages/monitoring/MonitoringLayout.tsx`, `pages/_shared/WorkerDetailsLayout.tsx`, `pages/employees/EmployeeDetails.tsx`, `pages/admins/AdminDetails.tsx`.
**Situação:** confirma a baseline. Todo número biométrico do painel é gerado localmente.

**Nuance importante, e é a que mais engana:** existe `swi-admin/src/services/production-contract.test.ts`, um guarda que quebra o `npm test` se qualquer arquivo do grafo de produção importar de `services/mockApi/`. Esse guarda não cobre `services/vitals/simulatedVitals.ts`, que não fica sob `mockApi/`. Ou seja, o painel tem um portão contra simulação, e a simulação de saúde passa por fora dele legitimamente. Quem ler o nome do teste pode concluir, erradamente, que não há simulação em produção.

**Classificação:** `PREPARAÇÃO AGNÓSTICA`; aquisição real `BLOQUEADO POR HARDWARE/FORNECEDOR`.

### 17. Saúde individual

**Evidência:** `mobile/app/(app)/my-stats.tsx`, `app/(app)/dashboard.tsx`, `app/(app)/map.tsx` e `app/(app)/chat/user-info.tsx` consomem vitals; `mobile/services/vitals/` contém `simulator.ts`, `simulatedContactFatigue.ts`, `deriveStatus.ts`, `phase.ts`, `mockVitalsBackend.ts` e `getVitalsBackend.ts`.
**Situação:** interface completa alimentada por simulação, com seletor de backend (`getVitalsBackend`) já existente, o que ajuda a U13.
**Classificação:** `PREPARAÇÃO AGNÓSTICA` + `BLOQUEADO POR DECISÃO DO CLIENTE`.

### 18. Smartband via Bluetooth

**Evidência:** `mobile/package.json` não declara nenhuma dependência de BLE ou Bluetooth. As telas `app/(onboarding)/smartband/connection.tsx` e `connection-start.tsx` são interface: a linha 55 é o texto "Ative o bluetooth no seu dispositivo" e a linha 88 é um `router.push`. Não há `BleManager`, não há descoberta, não há pareamento.
**Situação:** confirma a baseline. Existe onboarding visual de conexão que não conecta nada.
**Classificação:** adaptador real `BLOQUEADO POR HARDWARE/FORNECEDOR`. Só a interface do adaptador e o contrato de telemetria são executáveis.

### 19. Bateria da smartband

**Evidência:** aparece em `swi-admin/src/components/UserDetailsMenu.tsx`, `services/vitals/adminVitals.ts` e `services/mockApi/seed.ts`. Nenhum campo de bateria no Prisma, nenhum endpoint.
**Situação:** o painel exibe bateria vinda de simulação. O menu do avatar (`UserDetailsMenu.tsx`) mostra bateria e fadiga; o selo `SimulatedDataBadge` existe no projeto, mas esse menu está entre os pontos que exibem número fabricado.
**Classificação:** `PREPARAÇÃO AGNÓSTICA`; leitura real `BLOQUEADO POR HARDWARE/FORNECEDOR`.

### 20. Predição de fadiga

**Evidência:** `fadiga`/`fatigue` aparece apenas em componentes de frontend do admin (`UserDetailsMenu.tsx`, `useMyVitals.ts`, `AdminDetails.tsx`, `ChatInbox.tsx`, `ContactInfoPanel.tsx`, `useChatInbox.ts`, `HealthDonuts.tsx`, `MapBanner.tsx`) e em `mobile/services/vitals/simulatedContactFatigue.ts`. Nenhum módulo backend, nenhum modelo, nenhuma versão de algoritmo, nenhuma persistência de entradas.
**Situação:** é um valor de tela, sem regra, sem versionamento e sem auditoria.
**Classificação:** `PREPARAÇÃO AGNÓSTICA` + `BLOQUEADO POR DECISÃO DO CLIENTE`. O risco 7 da seção 8 do plano se aplica na íntegra.

### 21. Alertas de desgaste

**Evidência:** `swi-admin/src/pages/alerts/` contém `AlertsList.tsx`, `AlertsRescueRoute.tsx` e `AlertsRescueRouteSelection.tsx`, com testes de comportamento. Não há módulo de alertas no backend nem modelo com ciclo de vida.
**Situação:** a lista de alertas do painel é derivada dos mesmos vitals simulados. Alerta ainda não é registro operacional.
**Classificação:** `PREPARAÇÃO AGNÓSTICA` + `BLOQUEADO POR DECISÃO DO CLIENTE`.

---

## Achado transversal: resíduo de arquitetura superada dentro do contrato vivo

`mobile/services/telemetry/types.ts` define hoje:

```ts
export interface VitalsTelemetry extends Vitals {
  workerId: string; recordedAt: string; expiresAt: number; status: 'good' | 'alert' | 'low';
}
```

E `mobile/services/telemetry/useTelemetrySampler.ts:8` documenta: "expiresAt is epoch SECONDS (DynamoDB TTL contract), never ms".

O contrato de telemetria em uso carrega um campo cuja semântica é TTL do DynamoDB, banco que não existe mais neste projeto: nenhum dos três `package.json` declara `aws-amplify`, não há diretório `amplify/`, e os únicos pacotes AWS no backend são clientes S3 (`@aws-sdk/client-s3`, `s3-presigned-post`, `s3-request-presigner`), usados para mídia.

Além disso, esse contrato não tem `sampleId`, versão, dispositivo, origem nem qualidade, que são exatamente os campos que a U11 exige. Portanto a U11 não parte do zero: parte de um contrato existente contaminado por uma arquitetura abandonada, e removê-lo é parte do trabalho.

## Contagem final

| Classificação                                      | Linhas |
| -------------------------------------------------- | -----: |
| `EXECUTÁVEL AGORA` (núcleo da linha)               |     15 |
| `PREPARAÇÃO AGNÓSTICA` (isolada ou combinada)       |      6 |
| Com componente `BLOQUEADO POR DECISÃO DO CLIENTE`   |      4 |
| Com componente `BLOQUEADO POR HARDWARE/FORNECEDOR`  |      5 |

Nenhuma linha foi classificada com base em plano histórico. Nenhuma linha do grupo C foi classificada como executável agora.

---

# Congelamento (ticket 09)

## Falhas conhecidas ao fim da U00

| ID    | O que é                                                                        | Reproduz?              | Herdeiro                     |
| ----- | ------------------------------------------------------------------------------ | ---------------------- | ---------------------------- |
| MB-01 | `expo export --platform all` morre com estouro de `NewSpace` (exit 134)         | 1 em 2, com cache frio | **Sem dono.** Ver abaixo.    |
| BE-01 | Timeout intermitente de `main.spec.ts` afirmado pelo plano                      | **0 em 33**            | U00B, cuja premissa caiu     |

**MB-01 não tem dono e precisa de um.** Não pertence à U00B, que é sobre a suíte do backend. Bloqueia o `npm run verify` do mobile, logo bloqueia também o gate integrado da U17. Precisa de ticket próprio antes da U17.

**BE-01 inverteu-se:** não é uma falha a corrigir, é uma alegação a retirar. Detalhe em `02-flake-main-spec.md`.

## Bloqueios de entrada das próximas unidades, nomeados por evidência

### U00A: Permissões e escopo organizacional/setorial

O que o código mostra hoje:

- `enum Role { WORKER, ADMIN }` no Prisma. Apenas dois papéis, nenhuma capacidade.
- `RolesGuard` faz correspondência de string pura: `roles.includes(user?.role ?? '')`. Sem capacidade, sem setor, sem empresa.
- **38 condicionais de cargo espalhadas** em `swi-backend/src` fora de specs (`Role.ADMIN`, `'ADMIN'`, `'WORKER'`). É exatamente o "não repetem condicionais de cargo" que a U00A quer eliminar, agora quantificado.
- `User.companyId` existe, **nullable**, com o comentário do schema explicando: "seed/workers e o admin de seed não têm empresa". Usuário sem empresa fura o escopo por empresa por construção.
- `User.companyRole` é `String?` livre (owner/partner/manager/safety), declaradamente distinto do enum de autorização.
- **Setor não é escopo, é rótulo.** `sector` existe como texto livre em `Profile` (1:1 com `User`), com snapshots em `Report` e `WorkOrder`; `GET /profile/catalog` deriva a lista por DISTINCT dos valores digitados. Sem taxonomia curada e sem papel de autorização. (Corrigido em 2026-08-28: a versão congelada em 2026-08-25 negava `sector` no perfil.)

**Bloqueio de entrada:** modelar setor é pré-requisito, não detalhe. E `companyId` nullable precisa de decisão antes de virar fronteira de autorização.

### U00B: Estabilização da suíte backend

**Bloqueio de entrada: a falha que ela existe para corrigir não reproduz.** 33 execuções verdes. A unidade precisa ser encerrada ou reescopada como prevenção. Decisão do usuário.

### U01: Relatórios mobile completos

A unidade é **bem menor do que o plano estima**, e a evidência é específica:

- O backend já tem `PATCH /reports/:id` e `DELETE /reports/:id`.
- `remove` já aplica autor-ou-ADMIN mais escopo de empresa (`reports.service.ts:226-232`).
- O escopo por empresa já existe via `author.companyId`, documentado em `reports.service.ts:19`.
- A concorrência de anexos **já está resolvida**: o `PATCH` aceita `imageKeysBase`, um instantâneo dos anexos que aquele formulário carregou, e faz diff e escrita na mesma transação para não apagar anexo que outro usuário adicionou. O comentário do método é explícito: "só sai do bucket a remoção PROVADA".
- O painel já consome tudo isso em `swi-admin/src/services/api/reports.ts` (`update` na linha 243, `remove` na linha 255).

Ou seja, a U01 é **portar para o mobile um padrão que já funciona no admin**, mais a UI. Não há trabalho de schema nem de controller.

**Duas lacunas reais encontradas, que a U01 precisa cobrir:**

1. **`update` não verifica autoria.** A assinatura é `update(id, _userId, dto, companyId)` e o `_userId` está prefixado com underscore porque **não é usado**. Qualquer usuário da mesma empresa edita relatório de qualquer outro, enquanto excluir exige ser autor ou ADMIN. A assimetria é um defeito de autorização, não uma escolha registrada.
2. **Não existe controle de versão em nenhum modelo.** Busca por campo `version` no schema inteiro: zero. `Report` tem `updatedAt`, que não serve como ETag. A detecção de edição concorrente pedida pela U01 não tem em que se apoiar hoje, exceto o mecanismo específico de anexos.

## O que a U00 deliberadamente não fez

- Não corrigiu nada. A única alteração de código foi acrescentar `test:coverage` ao `package.json` do admin, exigida pela seção 7 do plano.
- Não rodou E2E gerenciado em nenhum projeto.
- Não verificou o mapper de clima nem os assets do DS citados por `2026-07-23-swi-admin-weather-fidelity-design.md`. Isso é U06.
- Não classificou os 90 planos um a um; usou coorte com regra explícita mais os cinco nomeados. Limite declarado em `04-planos-historicos.md`.

## Estado de commit

Nada foi commitado. A árvore de trabalho no fim da U00 tem `swi-admin/package.json` modificado (uma linha) e `.scratch/` não versionado, além do que já estava sujo antes da rodada (ver `00-ambiente.md`).
