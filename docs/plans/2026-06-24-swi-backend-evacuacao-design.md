# SWI Backend (AWS) — Fatia Evacuação (design)

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. Esta é a **fatia 6** do roadmap pós-pivô
> (`2026-06-22-swi-backend-roadmap-design.md`), depois de Relatórios, Jornada,
> Chat, Notificações e Clima.

## Contexto

Sexta fatia vertical do backend AWS, **Abordagem A, deploy-gated**: backend-as-code
em `swi-backend/` + camadas `mock`/`amplify` atrás da flag `AUTH_BACKEND` nos
`services/*` do mobile. `tsc` + `jest` verdes; **deploy real travado até existir
conta AWS** (custo R$0 agora). Domínio: **Evacuação** — Lambda → API externa de
roteamento (rota a pé do site até o ponto de encontro).

**Esta fatia espelha o Clima** (não os domínios com model): Evacuação **não tem
model/persistência** — é uma **passagem** pra uma API externa de rota via **Lambda**
(a 2ª função do projeto, depois da `weather`). Difere do Clima só no provedor
(roteamento, não clima) e em ter origem+destino em vez de um ponto.

Branch: **`feat/backend-evacuacao`** off `feat/mobile-login @ 6310cb9`.

## Estado atual

- **`evacuation.tsx`** (Figma 385:30193, "rota planejada", idle): mapa com pino de
  início (good), pino de destino (alert), polyline ciano `#8AD2E2`, 2 time chips
  ("6 minutos"/"17 minutos") em 35%/70%, card de instrução + botão "Continuar".
- **`evacuation-ongoing.tsx`** (Figma 385:30336, "navegando"): polyline roxa
  `#BC88FF`, só o pino de destino, seta de navegação (`#50B3D2`) a ~30% rotacionada
  pro próximo waypoint, 2 time chips. Sem card (mapa fullscreen).
- Ambas consomem `getEvacuationRoute()` de **`lib/evacuationRouteCache.ts`** (cache
  module-level + dedupe `inFlight`), que envolve **`fetchEvacuationRoute()`** de
  **`lib/api/osrm.ts`** — uma **chamada HTTP real client-side** ao **OSRM público**
  (`router.project-osrm.org`, sem SLA, **proibido em produção** pelo próprio
  comentário), com fallback de **interpolação linear de 5 pontos** quando offline.
- Origem/destino são constantes em `lib/mapMockData.ts` (`EVACUATION_ORIGIN`,
  `EVACUATION_DESTINATION`). A geometria da polyline já é "real"; as time chips são
  **copy estática do Figma** (o `durationSec` da rota **não** alimenta a UI hoje).

## Decisões (forks resolvidos com o usuário)

1. **Escopo = rota fixa do site.** Origem = local da obra, destino = ponto de
   encontro designado, **ambos constantes** (espelha o `SITE_LOCATION` fixo do
   Clima). GPS do worker é mock pós-pivô → parametrizar por GPS seria fingir; 1 rota
   por site é cacheável. (Rejeitado: origem por GPS do worker → fetch por-worker +
   jitter, overkill no piloto single-site.)
2. **Provider de rota (alvo de produção) = Mapbox Directions.** Bate com a stack
   AWS/Mapbox já decidida do projeto; chave via `secret('MAPBOX_TOKEN')` espelhando
   o secret da OpenWeather do Clima; tem SLA (ao contrário do OSRM público). A
   Lambda chama `directions/v5/mapbox/walking`. (Rejeitado: OSRM público = proibido
   em produção; self-hosted = custo de infra.)
3. **Mock = canned determinístico.** Geometria de rota fixa semeada (`waypoints` +
   `durationSec` + `distanceM`), espelha o mock canned do Clima → testes
   determinísticos, sem rede. (Rejeitado: manter a chamada OSRM ao vivo no mock →
   não-determinístico + dependência de rede nos testes/demo.) O fallback de
   interpolação linear de 5 pontos vira o **fallback de erro** do mock/provider.
4. **As 2 time chips ficam copy estática do Figma** (decorativas — como o
   heatmap/mapa do Clima ficou decorativo). A polyline é a parte "ao vivo"
   (geometria real); as 2 chips em 35%/70% **não mapeiam 1:1** num `durationSec`
   único → derivar 2 tempos de 1 duração seria arbitrário e desalinharia do Figma.
   O `durationSec`/`distanceM` viajam no snapshot (disponíveis pra uso futuro), mas
   **não** são exibidos nesta fatia.
5. **Seam = custom query do Amplify Data** (`client.queries.getEvacuationRoute`),
   não Function URL nem model cacheado. Consistente com o Clima + auth Cognito; o
   cache é preocupação de deploy. **Sem model DynamoDB** (rota é passagem, não dado
   persistido).
6. **Provider montado em `(app)/_layout` com fetch lazy-triggered.** Espelha o padrão
   dos providers, MAS a busca é **disparada pelas telas de evacuação ao montar**
   (`load()`), não na entrada do app — porque evacuação é uma tela **rara**, e buscar
   uma rota em todo boot seria desperdício. Mantém a semântica lazy de hoje +
   adiciona os estados loading/erro que as telas não têm + 1 fetch compartilhado
   idle→ongoing (substitui o `evacuationRouteCache.ts`).

**Não-objetivo desta fatia:** qualquer model/estado de "evacuação disparada/ativa".
A rota fica **sempre disponível** (como hoje); não há trigger de alerta→evacuação no
backend nesta rodada.

## Arquitetura

### Backend (`swi-backend/amplify/`)

Hoje: `auth` + `data` + `storage` + `weather` (1ª Lambda) em `backend.ts`. Esta
fatia cria a **2ª Lambda**, espelhando `functions/weather/`.

- **`functions/route/resource.ts`** — `defineFunction({ name: 'route', entry:
  './handler.ts', runtime: 20, timeoutSeconds: 15, environment: { MAPBOX_TOKEN:
  secret('MAPBOX_TOKEN') } })`.
- **`functions/route/handler.ts`** — deploy-gated. Recebe origem+destino, chama
  Mapbox Directions (`walking`, `geometries=geojson`, `overview=full`), mapeia o
  payload → o shape `RouteSnapshot` (`waypoints: [lng,lat][]`, `durationSec`,
  `distanceM`). Nunca invocado agora (sem AWS); existe pra o backend ser código real
  + typechecked. Usa `process.env` → `@types/node` (já adicionado na fatia Clima).
- **`data/resource.ts`** — adiciona `customType` `RouteSnapshot` + custom query
  `getEvacuationRoute(originLng, originLat, destLng, destLat) → RouteSnapshot`,
  `.handler(a.handler.function(route))`, `allow.authenticated()`. **Sem model.**
- **`backend.ts`** — adiciona `route` ao `defineBackend({ ..., weather, route })`.
- **Custo/cache** → pendência de deploy (rota fixa por site é cacheável: 1 fetch
  serve todos os workers; cache na Lambda / DynamoDB+TTL).

### Camada de serviço (`mobile/services/evacuation/`)

Espelha o padrão `services/weather` da fatia anterior.

| Arquivo | Papel |
| --- | --- |
| `types.ts` | `RouteSnapshot { waypoints: [number,number][], durationSec, distanceM, fetchedAt }`; `EvacuationBackend.getRoute()` (sem args — usa as constantes de rota do site); `SITE_ROUTE` = `{ origin, destination }` (movido de `lib/mapMockData.ts`). |
| `routeFormat.ts` (+test) | **Puro, TDD.** Helpers de geometria lifted das telas: `chipAnchors(waypoints)` (índices 35%/70%), `navArrow(waypoints)` (~30% + `bearingDeg`, com clamp pra `<2` waypoints), `lineFeature(waypoints)` (`Feature<LineString>`). Espelha o estilo puro de `weatherFormat.ts`. |
| `mockEvacuationBackend.ts` (+test) | Snapshot canned (polyline curva crível semeada + `durationSec`/`distanceM` batendo os ~6/17min do Figma) + flag dev `EVACUATION_SCENARIO` (`normal \| loading \| error`) espelhando `WEATHER_SCENARIO`. |
| `amplifyEvacuationBackend.ts` | Stub **deploy-gated** (`getRoute` throws; comentário documenta `client.queries.getEvacuationRoute({...})`). |
| `getEvacuationBackend.ts` (+test) | Seletor por flag `AUTH_BACKEND`. |
| `EvacuationProvider.tsx` | `loadStatus` (idle/loading/ready/error com `.then(ok,err)` — **lição do Chat**, sem `.finally`), `route`, `load()` (gatilho lazy, dedupe — substitui o `inFlight` do cache antigo), `reload`. **Montado em `(app)/_layout.tsx`**. |

### Wiring

- **`(app)/_layout.tsx`** — monta `EvacuationProvider` (junto dos providers
  existentes).
- **`evacuation.tsx` + `evacuation-ongoing.tsx`** — troca o import
  `getEvacuationRoute()` por `useEvacuation()`; chama `load()` no mount; renderiza
  polyline/pinos/chips/seta a partir de `route.waypoints` via os helpers puros de
  `routeFormat`; adiciona **loading** (mapa neutro / sem rota desenhada) e **erro**
  (fallback gracioso — a tela ainda renderiza o mapa, nunca quebra) que hoje não
  existem. **Copy das chips intacta** (decorativa).
- **Deletar** `lib/api/osrm.ts` + `lib/evacuationRouteCache.ts` (absorvidos pelo
  service). `EVACUATION_ORIGIN`/`EVACUATION_DESTINATION` movem pra
  `services/evacuation/types.ts` (`SITE_ROUTE`); ajustar qualquer outro import.

## Fluxo de dados

```
evacuation* monta → useEvacuation().load() → backend.getRoute() → RouteSnapshot
EvacuationProvider segura { route, loadStatus } (1 fetch compartilhado idle→ongoing)
polyline ← lineFeature(route.waypoints)         (parte "ao vivo": geometria real)
chips    ← copy estática do Figma               (decorativa; não usa durationSec)
seta     ← navArrow(route.waypoints)            (ongoing)
loadStatus loading/error → mapa neutro / fallback (nunca trava a tela)
```

## Tratamento de erro

- `getRoute()` falha → `loadStatus='error'`; a tela faz fallback gracioso (o antigo
  fallback de interpolação linear de 5 pontos vira o caminho de erro, então o mapa
  **nunca renderiza rota quebrada**); `reload` disponível.
- `navArrow`/`chipAnchors` lidam com `<2` waypoints (degenerado) sem crashar.
- Lambda (deploy): timeout/erro do Mapbox tratado na resposta de erro do amplify
  path (pendência de deploy).

## Testes

- `routeFormat.test.ts` — `chipAnchors`/`navArrow`/`lineFeature` incluindo
  degenerados (0, 1, `<2` waypoints) + `bearingDeg`.
- `mockEvacuationBackend.test.ts` — shape dos cenários (`normal`/`error`), snapshot
  canned bate a geometria esperada.
- `getEvacuationBackend.test.ts` — seletor de flag devolve mock/amplify.
- Backend `tsc -p amplify` compila a nova function + custom query + customType.
- **Gate full-branch:** jest tudo verde, mobile `tsc` 0 novos (8 baseline), backend
  `tsc --noEmit -p amplify` exit 0, `expo export --platform web` exit 0.

## Execução (3 unidades, espelhando as fatias anteriores)

- **Unit 1 — Backend** (`functions/route/resource.ts` + `handler.ts` + customType +
  custom query em `data/resource.ts` + `backend.ts`) + verificar `tsc -p amplify`.
- **Unit 2 — Camada de serviço** (types + `SITE_ROUTE`, `routeFormat`+test TDD,
  mock+test, amplify stub, getBackend+test, provider).
- **Unit 3 — Wiring** (montar `EvacuationProvider` em `(app)/_layout`, repointar as
  2 telas pra `useEvacuation()` + estados loading/erro, deletar
  `lib/api/osrm.ts` + `lib/evacuationRouteCache.ts`).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch (merge só com OK explícito)**.

## Pendências de deploy (documentadas, não construídas)

- Token do Mapbox como **secret** real (`ampx sandbox secret set MAPBOX_TOKEN`).
- **Cache** da rota (rota fixa por site → 1 fetch serve todos; in-memory por
  container quente ou DynamoDB+TTL).
- Paridade do **shape de retorno** da custom query (`ampx generate` substitui o
  mirror de `types.ts`; re-nest flat→nested no boundary se necessário).
- Tratamento de timeout/erro do Mapbox no amplify path.
- Definir o **ponto de encontro real** do site (constante `SITE_ROUTE.destination`).

## Nota de pesquisa — radar de clima (fora do escopo desta fatia)

Discussão paralela (deep-research 2026-06-24): tornar o heatmap "onde vai chover" do
`map-weather` **real** não escapa do bloqueio de AWS. Achados verificados:
- **OpenWeather Weather Maps** (1.0 `precipitation_new` / 2.0 PR0·PA0) = caminho
  produção-correto: tiles XYZ no MapLibre, **ODbL comercial OK** (atribuição
  "Weather data © OpenWeather"), consolida no fornecedor já usado — **mas a `appid`
  vai na URL do tile → precisa de proxy (a Lambda)** → AWS-gated igual ao resto.
- **RainViewer** = único keyless/client-side (real sem AWS), **mas uso
  pessoal/educacional apenas** (não-comercial) e API comercial em **desligamento**
  (cortes já passados em 2026) → inviável pro produto.
- **MapTiler Weather / Tomorrow.io** e a **qualidade real do radar em SP** ficaram
  **não conclusivos** — exigem 2ª pesquisa antes de cravar.

**Decisão:** manter o mapa decorativo (como hoje) e registrar "camada de radar
OpenWeather via proxy na Lambda" como **pendência de deploy do Clima** (não desta
fatia).

## Não-objetivos

Roteamento por GPS do worker, multi-rota / re-roteamento dinâmico, navegação
turn-by-turn real (instruções por passo), model de persistência de rota, trigger de
alerta→evacuação no backend, radar de clima real (ver nota acima).
