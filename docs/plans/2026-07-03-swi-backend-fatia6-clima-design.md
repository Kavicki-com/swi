# SWI Backend (container) — Fatia 6 (Clima) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Fatia 6 da rodada container dos domínios
> não-saúde (`2026-07-02-swi-backend-dominios-nao-saude-design.md`), depois de
> Fundação/Perfil/Relatórios/Jornada/Chat/**Notificações**.
>
> **Supersede** o design Amplify-era `2026-06-23-swi-backend-clima-design.md`
> (Lambda + custom query `client.queries.getWeather`), obsoleto pós-pivô container.
> O seam mobile (`types`/`weatherFormat`/`mock`/`provider`) construído naquela fatia
> foi mergeado em `main` e é **reusado** aqui — só o backend muda (Nest, não Lambda).

## Contexto

Sexta fatia vertical do backend real conteinerizado (NestJS + Prisma + Postgres +
MinIO via Docker Compose; deploy futuro AWS ECS/RDS). **Abordagem A**: 1 fatia/PR
por domínio contra `main`, trocando o stub `amplify*Backend` do mobile por um
cliente REST `api*Backend`. Domínio: **Clima** — feed de clima (`GET /weather`) +
**gatilho `clima → notif`** (o alerta meteorológico, cujo dono é esta fatia, ligado
ao `NotificationService` da Fatia 5).

O seam mobile `services/weather/` (types + `mockWeatherBackend` + `weatherFormat`
puro + `WeatherProvider` **já fiado** ao `getWeatherBackend()` + as telas) veio
pronto da era Amplify e está em `main`. Logo o mobile desta fatia é **só o cliente
REST** — idêntico ao lado mobile do Chat/Notificações (telas/provider/format intocados).

Branch: **`feat/backend-clima`** (de `main`, pós-merge do PR da Fatia 5).

## Princípio orientador (feedback do usuário, 2026-07-03)

**Máxima execução real antes do deploy AWS.** Não deferir "pro hardening/deploy" por
default: liga-se toda capacidade cujo gatilho já exista, só fica deferido o hard-block
físico (credencial / serviço externo pago / AWS-only).

Aplicação nesta fatia (revisão explícita do usuário): os **números do clima** (temp,
umidade, vento, máx/mín) **não são deploy-gated** — existe provedor **sem chave**
(Open-Meteo) que dá dado real de SP hoje, no container. Só o **aviso oficial de
tempestade** é que trava de verdade (fonte governamental precisa de credencial/cobertura
que não temos, e alerta real é intermitente → não bate com o Figma, que é sempre
tempestade ativa). Por isso o **híbrido** abaixo.

## Onde o clima aparece no app (verdade das telas, não teoria)

Auditado no código mobile (fiel ao Figma). **Não existe "widget de clima normal"** —
o clima só aparece **dentro do fluxo de tempestade/evacuação**, em 2 superfícies que
leem `useWeather()` ao vivo, ambas com **fallback de tempestade chumbado** em
`weatherFormat` (tela de segurança não pode quebrar):

- **`AlertActiveView`** (`app/(app)/dashboard.tsx`, `?alert=active`, Figma 385:29591) —
  "Procedimento de evacuação": card de chuva + métricas + descrição do alerta.
- **`WeatherAlertModal`** (`components/modals/WeatherAlertModal.tsx`, Figma 385:29371) —
  "Local em Alerta!"; é pra onde o card `domain='weather'` do feed de notificações leva.

O card de clima do **feed de notificações** hoje vem do **seed da Fatia 5** (1
notificação `weather`). Consequência de design: a demo fiel ao Figma é o **cenário de
tempestade**, e o mock entrega isso por padrão (`WEATHER_SCENARIO='alert'`).

## Decisões

1. **Provedor de clima = agnóstico; default Open-Meteo (sem chave) → números reais
   agora.** `WeatherService.getSnapshot()` sempre tenta o provedor real (Open-Meteo:
   `current` temp/umidade/vento + `daily` máx/mín, mapeando `weather_code → WeatherCondition`)
   pro `SITE_LOCATION` da obra. Falha/timeout/payload ruim → **fallback canned**
   (17º/chuva/32-19/65%/65km/h — os mesmos números do mock) pra tela **nunca quebrar**.
   Em prod o provedor é config de deploy (chave OpenWeather do cliente, ou Open-Meteo
   comercial); o código não muda.
2. **Alertas NÃO vêm do Open-Meteo** (API numérica, sem aviso oficial). Fonte do alerta:
   - **dev/demo:** flag `WEATHER_SCENARIO` (paridade com o mobile). `alert` (default em
     dev) → sobrepõe o alerta canned de tempestade ("Tempestade severa / Risco de
     desabamentos", id estável `wx-0`); `normal` → sem alerta.
   - **prod:** fonte de aviso real (INMET/OpenWeather One Call) quando configurada;
     **o fallback nunca fabrica alerta** (sem flag → `alerts: []`). Assim produção não
     inventa tempestade quando o provedor de números falha.
3. **`clima → notif` = cron agendado + dedup.** `@nestjs/schedule` (`ScheduleModule`),
   `@Cron` a cada **30 min** (expressão via `WEATHER_CRON`, default `*/30 * * * *`):
   `getSnapshot()` → pra cada `alert.id` **ainda não visto**, `createForMany(<todos os
   workers aprovados>, { domain:'weather', title:'Alerta meteorológico', body: alert.event,
   targetId: alert.id })` + registra o id. Corpo inteiro **best-effort** (`try/catch` —
   uma falha de poll nunca derruba o app).
4. **Destinatários = todos os workers aprovados** (`role=WORKER, approvalStatus=APPROVED`).
   Invisível no Figma (é comportamento de backend); escolha por consistência — bate com
   a notificação `weather` org-wide já no seed e com o broadcast de relatórios. Tempestade
   afeta o canteiro inteiro; não há autor a excluir (≠ report).
5. **Dedup = 1 model estreito** `WeatherAlertSeen { alertId @id, notifiedAt }`. Alerta
   dura horas; cron a cada 30 min veria o mesmo id várias vezes → sem dedup = spam. O
   model **pré-semeado** com o id do alerta de demo (`wx-0`) pra o cron **não duplicar**
   a notificação `weather` que o seed da F5 já criou. Uma migração nova.
6. **Wiring = dependência direta síncrona** (mesmo estilo do `ReportsModule`).
   `WeatherModule` importa `NotificationModule` e injeta `NotificationService`.
   `ScheduleModule.forRoot()` + `WeatherModule` no `app.module`. Sem event-emitter, sem
   fila (a notificação é secundária; fan-out do cron é fora do request path por
   definição).
7. **Mobile = só o cliente REST.** `apiWeatherBackend.getWeather()` = `GET /weather`.
   Despinar `getWeatherBackend` (honra `DATA_BACKEND`). Deletar `amplifyWeatherBackend`.
   **Telas/provider/format intocados.** O **mock permanece** — é o caminho pixel-exato
   do Figma (`DATA_BACKEND=mock`) pra review de design.
8. **Números reais vs. Figma (reconciliação).** `DATA_BACKEND=mock` = tempestade
   pixel-exata do Figma (design review). `DATA_BACKEND=api` = **números reais de SP** +
   (em dev) alerta de demo sobreposto — dado real com a estrutura de tela fiel. `api` +
   prod = números reais + alertas reais. Assim "números reais agora" e "fidelidade Figma"
   coexistem sem conflito, cada um no seu modo.

## Model backend (novo — 1 migração)

```prisma
model WeatherAlertSeen {
  alertId    String   @id            // id do alerta (estável por evento)
  notifiedAt DateTime @default(now())
}
```

`NotificationDomain.weather` **já existe** (Fatia 0/5) → sem mudança de enum. Nenhum
model de clima persistido (é passthrough); o `WeatherAlertSeen` guarda só "que alertas
já notifiquei".

## Backend — `swi-backend/src/weather/`

| Arquivo | Papel |
| --- | --- |
| `weather.provider.ts` (+spec) | `fetchOpenMeteo(loc): Promise<{current, daily}>` via `fetch` global (Node 20). Coerção pura (payload Open-Meteo → `WeatherCurrent`/`WeatherDaily`, `weather_code → WeatherCondition`) num helper testável. Sem chave. |
| `weather.service.ts` (+spec) | `getSnapshot(): Promise<WeatherSnapshot>` — tenta o provider → em falha, **canned fallback**; sobrepõe `alerts` conforme `WEATHER_SCENARIO`/fonte de aviso; `fetchedAt` = agora. |
| `weather.controller.ts` (JWT) | `GET /weather` → `getSnapshot()`. `@UseGuards(JwtAuthGuard)`; sem body, sem dado por-usuário (clima é do site). |
| `weather-alert.service.ts` (+spec) | `@Cron(WEATHER_CRON)` → `pollAndNotify()` (público, pra o smoke chamar): `getSnapshot()` → alertas novos (não em `WeatherAlertSeen`) → `notifications.createForMany(<aprovados>, …)` + grava o id. `try/catch` best-effort. |
| `weather.module.ts` | importa `NotificationModule`; provê Service/Provider/AlertService. |
| `app.module.ts` | `+ ScheduleModule.forRoot()` `+ WeatherModule`. |

### Contrato de saída (`GET /weather` = `WeatherSnapshot`)
`{ current:{tempC,condition,humidityPct,windKmh}, daily:{minC,maxC}, alerts:[{id,event,description,startsAt,endsAt}], fetchedAt }` — ISO nas datas. Exatamente o shape que o `WeatherProvider`/`weatherFormat` já consomem.

## Flag de cenário (paridade com o mobile)

`WEATHER_SCENARIO` (env, docker-compose): `alert` (default em dev) → alerta canned
sobreposto; `normal` → sem alerta; **unset em prod** → sem alerta fabricado (só a fonte
real preenche). Espelha o `WEATHER_SCENARIO` do `mockWeatherBackend`.

## Mobile — só o cliente REST (`mobile/services/weather/`)

`WeatherProvider`, `weatherFormat`, telas (`dashboard.tsx` `AlertActiveView`,
`WeatherAlertModal`, `notifications.tsx`) e `types.ts` **intocados**.

| Arquivo | Ação |
| --- | --- |
| `apiWeatherBackend.ts` (+test) | `getWeather()` = `apiRequest<WeatherSnapshot>('/weather', {auth:true})` via `services/api/http.ts`. Espelha `apiNotificationBackend`. |
| `getWeatherBackend.ts` (+test) | despinar → honra `DATA_BACKEND` (`'api'` → apiWeatherBackend, senão mock). Test troca o "pinned em mock" pela asserção do switch. |
| `amplifyWeatherBackend.ts` | **deletado** (0 refs). |

## Fluxo de dados

```
tela monta → WeatherProvider.reload() → getWeather() → GET /weather → snapshot (números reais + alerta por cenário)
  → AlertActiveView / WeatherAlertModal renderizam via weatherDisplay() (fallback estático se null)

[clima→notif] cron 30min → getSnapshot() → alerta novo (não em WeatherAlertSeen)?
  → createForMany(<workers aprovados>) → Notification(domain='weather') + emitToUsers 'notification'
  → workers recebem o card ao vivo; id gravado (próximos ticks não repetem)
```

## Tratamento de erro

- `GET /weather` provider falha → **canned fallback** (nunca 5xx a tela de segurança).
- `getWeather()` rejeita no mobile → `WeatherProvider` `loadStatus='error'`; as telas
  caem no fallback estático do `weatherDisplay` (já implementado).
- Cron best-effort: `try/catch` em `pollAndNotify`; falha não derruba o processo.
- Prod: sem flag/fonte → `alerts: []` (nunca fabrica alerta num fallback de erro).

## Testes

- **Backend unit**: `weather.provider.spec` (coerção de payload Open-Meteo de amostra;
  `weather_code`→condition; fallback com `fetch` mockado rejeitando); `weather.service.spec`
  (fallback em falha; alerta sobreposto por `WEATHER_SCENARIO=alert`, ausente em `normal`);
  `weather-alert.service.spec` (alerta novo → `createForMany` 1x; mesmo id de novo → **dedup**
  (0 chamadas); poll com erro → swallow).
- **Backend e2e** (`weather.e2e-spec.ts`): `GET /weather` **401** sem token; **200** +
  shape com token. (Cron fora do e2e — provado no unit + docker smoke.)
- **Mobile**: `apiWeatherBackend.test.ts` (GET /weather → snapshot); `getWeatherBackend.test.ts`
  (switch por `DATA_BACKEND`).
- **Gate full-branch**: backend `build` 0 / `test` verde / `test:e2e` verde; mobile
  `tsc` **8 baseline** (0 novos) / `jest` verde / `expo export --platform web` 0;
  **docker smoke REAL** (rebuild): `GET /weather` batendo **Open-Meteo de verdade**
  (números reais de SP no container) + prova `clima→notif` ao vivo — socket conectado,
  `pollAndNotify` com um **alerta novo** (truncar `WeatherAlertSeen` ou id fresco) →
  card `weather` chega no socket → re-tick → **sem duplicata** (dedup provado no container).

## Deps novas

`@nestjs/schedule` (backend) — cron NestJS padrão. Único add. (Números reais = `fetch`
global do Node 20, sem dep de HTTP.)

## Execução (subagent-driven, como Chat/Notificações)

1. **Provider + coerção** — `weather.provider.ts` (Open-Meteo, TDD, `fetch` mockado).
2. **WeatherService + fallback + cenário** — `weather.service.ts` (+spec).
3. **Controller + módulo + e2e** — `GET /weather` JWT; `WeatherModule`; `app.module`.
4. **Migração + `WeatherAlertSeen`** — Prisma migrate; pré-seed do id de demo no `seed.ts`.
5. **`clima→notif`** — `weather-alert.service.ts` cron + dedup (importa `NotificationModule`).
6. **Mobile** — `apiWeatherBackend` (+test), despin `getWeatherBackend` (+test), deletar `amplify`.
7. **Verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch**. Commit e PR **só com luz verde explícita do usuário** (sem
rastros de IA).

## Pendências de deploy (documentadas, não construídas — só hard-blocks reais)

- **Fonte de aviso oficial de tempestade** (o único hard-block da fatia): INMET/Defesa
  Civil ou OpenWeather One Call (tier pago) + cobertura BR. Em dev o alerta vem da flag
  de cenário; a fonte real entra no deploy (flag desligada).
- **Provedor comercial de números**: Open-Meteo grátis é uso não-comercial; prod usa a
  chave OpenWeather do cliente ou plano comercial. Código já é agnóstico de provedor.
- **Push do SO**: herdado da F5 (`registerPushToken` seam no-op) — vale pro card `weather` também.
- **Consolidar sockets** e **`targetId`→deep-link** a recurso específico: follow-ups herdados.

## Não-objetivos

Fonte de aviso real, provedor comercial, forecast multi-dia (só hoje: `daily` min/max),
histórico/persistência de clima, mapa meteorológico real (Figma `map-metereologic-alerts`
segue mock), preferências de notificação de clima, push real do SO.
