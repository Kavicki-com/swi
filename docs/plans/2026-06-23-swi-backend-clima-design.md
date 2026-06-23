# SWI Backend (AWS) — Fatia Clima (design)

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Esta é a **fatia 5** do roadmap pós-pivô
> (`2026-06-22-swi-backend-roadmap-design.md`), depois de Relatórios, Jornada,
> Chat e Notificações.

## Contexto

Quinta fatia vertical do backend AWS, **Abordagem A, deploy-gated**: backend-as-code
em `swi-backend/` + camadas `mock`/`amplify` atrás da flag `AUTH_BACKEND` nos
`services/*` do mobile. `tsc` + `jest` verdes; **deploy real travado até existir
conta AWS** (custo R$0 agora). Domínio: **Clima** — Lambda → API externa de clima.

**Esta fatia é diferente das anteriores:** Relatórios/Jornada/Chat/Notificações
eram **models DynamoDB** atrás do Amplify Data. Clima **não tem model/persistência**
— é uma **passagem** pra uma API externa via **Lambda** (a 1ª função do projeto).

Branch: **`feat/backend-clima`** off `feat/mobile-login @ 63ce40c`.

## Estado atual (tudo chumbado/decorativo)

- **Dashboard** (`app/(app)/dashboard.tsx`, Figma 385:30122/30123): "Weather row"
  com valores **hardcoded** — ícone de chuva + umidade `65%` + vento `65km/h` +
  máx `32ºC` + mín `19ºC`.
- **map-weather** (`app/(app)/map-weather.tsx`, Figma 385:21840): heatmaps
  (tempestade + inundação) gerados **aleatoriamente no cliente** (Box-Muller
  `Math.random()`) + 11 pinos de alerta **estáticos** (`WEATHER_ALERT_PINS` em
  `lib/mapMockData.ts`) → tap abre o modal de alerta.
- **WeatherAlertModal** (`components/modals/WeatherAlertModal.tsx`): conteúdo de
  alerta **estático**; usado em 3 lugares (dashboard inline, rota
  `app/modals/weather-alert.tsx`, e `notifications.tsx`).

## Decisões (forks resolvidos com o usuário)

1. **Escopo = dashboard row + sinal de alerta.** O dado real alimenta o **Weather
   row do dashboard** (condições atuais + máx/mín) E um **sinal de "alerta
   meteorológico ativo"** derivado do `alerts[]` da API, que alimenta o **conteúdo
   do WeatherAlertModal**. O **heatmap + pinos do mapa ficam decorativos** (mock) —
   radar de verdade precisa de camada de tiles (fora de escopo) e a API dá **um**
   alerta por local, não um array de pinos geo-distribuídos (fingir isso seria
   desonesto).
2. **API externa = OpenWeather One Call 3.0.** Uma chamada devolve current + daily
   (mín/máx) + `alerts[]` (avisos governamentais). Free tier ~1000 calls/dia, JSON
   simples, mapeia 1:1 no que precisamos.
3. **Localização = local fixo da obra.** Usa o centroide do site (constante
   `SITE_LOCATION`, mesmo valor do `USER_LOCATION` que o mapa já centraliza — SP
   piloto). Todos os workers veem o mesmo clima do site; 1 fetch por site é
   cacheável (barato). Encaixa no enquadramento "segurança do site" e no piloto
   single-site. (Rejeitado: GPS por-worker → fetches por-worker = mais custo +
   jitter, overkill quando todos estão no mesmo site.)
4. **Seam = custom query do Amplify Data** (`client.queries.getWeather`), não
   Function URL nem model cacheado. Consistente com o `data/resource.ts` existente
   + auth Cognito; o cache é preocupação de deploy.

## Arquitetura

### Backend (`swi-backend/amplify/`)

Hoje: `auth` + `data` + `storage` em `backend.ts` via `defineBackend`. **Sem dir
`functions/`** — esta fatia cria a 1ª Lambda.

- **`functions/weather/resource.ts`** — `defineFunction({ name: 'weather', ... })`;
  chave da OpenWeather via `secret('OPENWEATHER_API_KEY')` no `environment`.
- **`functions/weather/handler.ts`** — busca OpenWeather One Call 3.0 pro lat/lng
  do site, mapeia o payload → o shape `WeatherSnapshot` (current temp/umidade/vento/
  condição + daily mín/máx + `alerts[]`). Deploy-gated: escrita + typecheck, nunca
  invocada até existir AWS.
- **`data/resource.ts`** — adiciona um `customType` `WeatherSnapshot` + uma custom
  query `getWeather(lat,lng) → WeatherSnapshot`, `.handler(a.handler.function(
  weatherFn))`, `allow.authenticated()`. **Sem model DynamoDB.**
- **`backend.ts`** — adiciona `weather` ao `defineBackend({ auth, data, storage,
  weather })`.
- **Custo/cache** → pendência de deploy (cache na Lambda / DynamoDB+TTL pra 1 fetch
  por site servir todos os workers e ficar sob o free tier).

### Camada de serviço (`mobile/services/weather/`)

Espelha o padrão `services/<domínio>` das fatias anteriores.

| Arquivo | Papel |
| --- | --- |
| `types.ts` | `WeatherSnapshot { current{tempC,condition,humidityPct,windKmh}, daily{minC,maxC}, alerts: WeatherAlert[], fetchedAt }`; `WeatherAlert { id, event, description, startsAt, endsAt }`; `WeatherCondition` enum (mapeado dos códigos da API); `WeatherBackend.getWeather()` (sem args — usa a constante de módulo `SITE_LOCATION`). |
| `weatherFormat.ts` (+test) | **Puro, TDD.** `formatTempC`, `formatHumidity`, `formatWind`, `conditionLabel`, `activeAlert(snapshot)` (devolve o alerta atual não-expirado ou null — filtra por `endsAt`). Espelha o estilo puro de `progress.ts`/`notificationReducers.ts`. |
| `mockWeatherBackend.ts` (+test) | Snapshot canned batendo os valores de hoje do dashboard (32º/19º, 65%, 65km/h, condição rain) **+** um alerta semeado pra o caminho de alerta ser demoável. Flag dev `WEATHER_SCENARIO` (`normal \| alert \| loading \| error`) pra exercitar os estados (espelha `VITALS_SCENARIO`). |
| `amplifyWeatherBackend.ts` | Stub **deploy-gated** (`getWeather` throws; comentário documenta `client.queries.getWeather({lat,lng})`). |
| `getWeatherBackend.ts` (+test) | Seletor por flag `AUTH_BACKEND`. |
| `WeatherProvider.tsx` | `loadStatus` (idle/loading/ready/error com `.then(ok,err)` — **lição do Chat**, sem `.finally`), `snapshot`, `activeAlert` derivado, `reload`. **Montado em `(app)/_layout.tsx`** (junto dos providers existentes) pra dashboard + mapa + modal compartilharem 1 fetch. |

### Wiring

- **Weather row do dashboard** (Figma 385:30122/30123): troca os hardcoded
  `65%`/`65km/h`/`32ºC`/`19ºC` + ícone de chuva por valores de `useWeather()`;
  loading → placeholder neutro (traços), erro → fallback gracioso (mantém o layout,
  não quebra a tela inicial). Mapeamento condição→ícone fica na tela.
- **WeatherAlertModal**: lê `useWeather().activeAlert` internamente pro seu
  evento/descrição (fallback pro texto estático de hoje quando não há alerta /
  mock) — **sem mudar props nos 3 call sites** (dashboard, rota weather-alert,
  notifications).
- **map-weather**: heatmap + pinos **intactos** (decorativos; radar fora de escopo).

## Fluxo de dados

```
(app)/_layout monta WeatherProvider → load() → backend.getWeather() → snapshot
dashboard Weather row  ← snapshot.current + snapshot.daily (formatado)
WeatherAlertModal      ← activeAlert(snapshot) (evento/descrição) | fallback estático
loadStatus loading/error → row com placeholder/fallback (nunca trava a landing)
```

## Tratamento de erro

- `getWeather()` falha → `loadStatus='error'`; o Weather row faz fallback gracioso
  (traços/última leitura), **nunca bloqueia o dashboard**; `reload` disponível.
- `activeAlert` filtra alertas expirados (`endsAt < agora`) → sem alerta fantasma.
- Lambda (deploy): timeout/erro da OpenWeather → resposta de erro tratada no
  amplify path (pendência de deploy).

## Testes

- `weatherFormat.test.ts` — formatters (temp/umidade/vento) + `activeAlert`
  (presente / vazio / expirado).
- `mockWeatherBackend.test.ts` — shape dos cenários (`normal`/`alert`), snapshot
  bate os valores do dashboard.
- `getWeatherBackend.test.ts` — seletor de flag devolve mock/amplify.
- Backend `tsc -p amplify` compila a nova function + custom query + customType.
- **Gate full-branch:** jest tudo verde, mobile `tsc` 0 novos (8 baseline), backend
  `tsc --noEmit -p amplify` exit 0, `expo export --platform web` exit 0.

## Execução (3 unidades, espelhando as fatias anteriores)

- **Unit 1 — Backend** (`functions/weather/resource.ts` + `handler.ts` + customType
  + custom query em `data/resource.ts` + `backend.ts`) + verificar `tsc -p amplify`.
- **Unit 2 — Camada de serviço** (types, weatherFormat+test TDD, mock+test, amplify
  stub, getBackend+test, provider).
- **Unit 3 — Wiring** (montar `WeatherProvider` em `(app)/_layout`, Weather row do
  dashboard ao vivo, WeatherAlertModal lendo `activeAlert`).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch (merge só com OK explícito)**.

## Pendências de deploy (documentadas, não construídas)

- Chave da OpenWeather como **secret** real (`ampx sandbox secret set`).
- **Cache** na Lambda (in-memory por container quente) ou DynamoDB+TTL — 1 fetch por
  site, sob o free tier.
- Mapeamento dos **códigos de condição** da OpenWeather → enum `WeatherCondition`.
- Paridade do **shape de retorno** da custom query (`ampx generate` substitui o
  mirror de `types.ts`).
- Coerção de alertas ausentes/expirados no boundary amplify.

## Não-objetivos

Heatmap de radar real (tiles), pinos de alerta geo-distribuídos por dado real
(API dá 1 alerta/local), previsão estendida (multi-dia) na UI, clima por GPS
do worker, model de persistência de clima.
