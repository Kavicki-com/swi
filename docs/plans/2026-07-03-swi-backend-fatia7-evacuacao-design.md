# SWI Backend (container) — Fatia 7 (Evacuação) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o
> backend inteiro estiver implementado. **Última fatia de domínio** da rodada
> container (`2026-07-02-swi-backend-dominios-nao-saude-design.md`), depois de
> Fundação/Perfil/Relatórios/Jornada/Chat/Notificações/**Clima**.
>
> **Supersede** o design Amplify-era `2026-06-24-swi-backend-evacuacao-design.md` (2ª
> Lambda `amplify/functions/route/` + custom query `client.queries.getEvacuationRoute`),
> obsoleto pós-pivô container. O seam mobile (`types`/`routeFormat`/`mock`/
> `EvacuationProvider`) construído naquela fatia foi mergeado em `main` e é **reusado**
> aqui — só o backend muda (Nest, não Lambda).

## Contexto

Sétima e **última fatia vertical de domínio** do backend real conteinerizado (NestJS
+ Prisma + Postgres + MinIO via Docker Compose; deploy futuro AWS ECS/RDS).
**Abordagem A**: 1 fatia/PR por domínio contra `main`, trocando o stub
`amplify*Backend` do mobile por um cliente REST `api*Backend`. Domínio: **Evacuação**
— a rota do canteiro até o ponto de encontro (`GET /evacuation/route`).

Passthrough **puro**: **sem persistência, sem cron, sem trigger de notificação**.
Evacuação é tela rara, `lazy` (o `EvacuationProvider` só busca na 1ª chamada — sem
fetch no boot). Muito mais simples que o Clima (que era dono do gatilho meteorológico).

O seam mobile `services/evacuation/` (`types` + `SITE_ROUTE` + `mockEvacuationBackend`
+ `routeFormat` puro + `EvacuationProvider` **já fiado** ao `getEvacuationBackend()`
+ as telas `evacuation.tsx`/`evacuation-ongoing.tsx`) veio pronto da era Amplify e
está em `main`. Logo o mobile desta fatia é **só o cliente REST** — idêntico ao lado
mobile de Chat/Notificações/Clima (telas/provider/format intocados).

Branch: **`feat/backend-evacuacao`** (de `main`, pós-merge do PR da Fatia 6).

## Princípio orientador (feedback do usuário, 2026-07-03)

**Máxima execução real antes do deploy AWS.** Não deferir "pro hardening/deploy" por
default: liga-se toda capacidade cujo gatilho já exista, só fica deferido o hard-block
físico (credencial / serviço externo pago / AWS-only).

Aplicação nesta fatia (decisão explícita do usuário, espelhando o híbrido do Clima):
a **geometria da rota não é deploy-gated** — existe roteador **sem chave** (OSRM
público) que computa uma rota real de SP hoje, no container. O provedor **premium**
(Mapbox Directions, com traffic/SLA/perfil `walking`) é que trava de verdade — precisa
do token do cliente (config de deploy). Por isso o **híbrido** abaixo: OSRM keyless
agora, Mapbox em prod, mesmo código.

## Onde a evacuação aparece no app (verdade das telas, não teoria)

Auditado no código mobile (fiel ao Figma). A rota só aparece **dentro do fluxo de
evacuação** (tela rara, aberta a partir do alerta de tempestade), em 2 telas que leem
`useEvacuation()` e renderizam o mapa via `routeFormat` (âncoras de chip, seta de
navegação, feature da linha), com **fallback reto (`straightLine`) chumbado** no
cliente (tela de segurança não pode renderizar mapa vazio/quebrado):

- **`evacuation.tsx`** (idle) — rota + chips de tempo + CTA "Iniciar".
- **`evacuation-ongoing.tsx`** (em curso) — mesma rota, seta de navegação ativa.

O `EvacuationProvider` é **`lazy` + dedupe**: dispara `getRoute()` só na 1ª chamada
(as telas chamam `load()` no mount), reusa a promise em voo, **sem fetch no boot**
(evacuação não é caminho quente). Consequência de design: a demo fiel ao Figma é a
**rota canned curva**, e o mock entrega isso por padrão (`EVACUATION_SCENARIO='normal'`).

## Decisões

1. **Provedor de rota = agnóstico; cascata keyless-primeiro → geometria real agora.**
   `RouteProvider.fetch()` escolhe a fonte por config: **`MAPBOX_TOKEN` setado →
   Mapbox Directions (`walking`)**; **senão → OSRM público (keyless, sem chave)**.
   Ambos devolvem GeoJSON (`geometries=geojson`) → mesma coerção pura
   (`routes[0].geometry.coordinates`/`.duration`/`.distance`). Em dev/container (sem
   token) o caminho é **OSRM → rota real computada** (o análogo ao "clima real de SP"
   do Clima). Em prod, o token do cliente ativa o Mapbox — código não muda.
2. **Fallback = rota canned (paridade com o mock), NUNCA reta.** Falha/timeout/payload
   ruim/roteador fora → `EvacuationService` devolve o `CANNED_ROUTE` (waypoints curvos
   + `durationSec`/`distanceM` **em paridade exata com o `mockEvacuationBackend`** — os
   mesmos ~23 min / 1500 m do Figma). Reta pareceria quebrada; a canned = pixel-Figma.
   O `straightLine` do `routeFormat` continua sendo o **last-resort do cliente** (se
   até a chamada HTTP falhar), não o fallback do servidor. Duas camadas.
3. **Sem persistência, sem model, sem migração.** Passthrough puro — nada a guardar
   (a rota é derivada de origem/destino fixos + roteador externo). Zero mudança de
   schema Prisma. Contrasta com o Clima (que tinha `WeatherAlertSeen` pro dedup do cron).
4. **Sem trigger de notificação, sem cron.** A evacuação não notifica ninguém — quem
   avisa "tem tempestade, evacue" é o card `weather` da Fatia 6. Esta fatia só **serve
   a rota** quando a tela abre. Nenhum `@nestjs/schedule`, nenhum `NotificationModule`
   importado. (É por isso que é a fatia mais enxuta do roadmap.)
5. **Origem/destino = `SITE_ROUTE` fixo no backend** (piloto SP: origem no canteiro,
   destino no ponto de encontro, ambos `[lng, lat]`). Espelha a `SITE_ROUTE` do seam
   mobile. `GET /evacuation/route` **sem args** (a rota é do site, não por-usuário) —
   igual ao `GET /weather` sem args do Clima. O provider recebe `SITE_ROUTE` por default.
6. **Mobile = só o cliente REST.** `apiEvacuationBackend.getRoute()` = `GET
   /evacuation/route`. Despinar `getEvacuationBackend` (honra `DATA_BACKEND`). Deletar
   `amplifyEvacuationBackend`. **Telas/provider/format intocados.** O **mock permanece**
   — é o caminho pixel-exato do Figma (`DATA_BACKEND=mock`) pra review de design.
7. **Rota real vs. Figma (reconciliação).** `DATA_BACKEND=mock` = rota canned
   pixel-exata do Figma (design review). `DATA_BACKEND=api` (em dev) = **rota OSRM real
   de SP** — geometria de verdade com a estrutura de tela fiel; a tela de mapa é
   **gated a prod build** (`FEATURE_GATES.maps = IS_PROD_BUILD`), então a rota real só
   aparece em build nativo, nunca atrapalha o review pixel-exato (que é o path `mock`).
   `api` + prod = Mapbox `walking` real. "Geometria real agora" e "fidelidade Figma"
   coexistem, cada uma no seu modo.

## Backend — `swi-backend/src/evacuation/`

| Arquivo | Papel |
| --- | --- |
| `evacuation.types.ts` | `RouteSnapshot` (espelha o seam), `SITE_ROUTE {origin,destination}` (mirror do mobile), `CANNED_ROUTE` (waypoints curvos + `durationSec`/`distanceM` em **paridade exata** com o `mockEvacuationBackend`). |
| `evacuation.provider.ts` (+spec) | `coerceDirections(raw): {waypoints, durationSec, distanceM}` **pura** (lê `routes[0].geometry.coordinates`/`.duration`/`.distance`; lança em payload ruim). `RouteProvider.fetch(route=SITE_ROUTE)`: `MAPBOX_TOKEN`? Mapbox `walking` URL : OSRM público keyless URL; `fetch` global (Node 20) c/ `AbortSignal.timeout(5000)`; `!res.ok`→throw. |
| `evacuation.service.ts` (+spec) | `getRoute(): Promise<RouteSnapshot>` — tenta `provider.fetch()` → em falha, **`Logger.warn` + `CANNED_ROUTE`**; sempre `fetchedAt` = agora. Tela de segurança nunca quebra. |
| `evacuation.controller.ts` (JWT) | `GET /evacuation/route` → `getRoute()`. `@UseGuards(JwtAuthGuard)`; sem body, sem dado por-usuário (rota é do site). |
| `evacuation.module.ts` | provê `RouteProvider` + `EvacuationService`. **Sem `NotificationModule`.** |
| `app.module.ts` | `+ EvacuationModule`. |
| `docker-compose.yml` | `+ MAPBOX_TOKEN` (vazio/unset em dev → caminho OSRM keyless), marcado dev/demo-only. |

### Contrato de saída (`GET /evacuation/route` = `RouteSnapshot`)
`{ waypoints:[[lng,lat],…], durationSec, distanceM, fetchedAt }` — `fetchedAt` ISO.
Exatamente o shape que o `EvacuationProvider`/`routeFormat` já consomem (`waypoints`
em `[lng, lat]`, convenção maplibre/GeoJSON).

### Escolha de perfil / roteador (nota honesta)
- **Mapbox** (prod, com token): perfil `walking` — evacuação a pé no canteiro, bate a
  Lambda Amplify original.
- **OSRM público** (dev/container, keyless): o server demo (`router.project-osrm.org`)
  só expõe o perfil **`driving`** (`foot`/walking não está no demo). Na escala urbana
  ~1.5 km a polyline segue **as mesmas ruas** — diferença de geometria desprezível pro
  mapa; a duração difere um pouco (irrelevante pra prova de "rota real computada").
  Documentado; não bloqueia.
- **Sem cache no provider** (o admin usa TTL 5 min no `mapboxDirections.ts`; aqui a
  evacuação é `lazy`/rara → YAGNI). Timeout 5 s, igual ao Clima.

## Mobile — só o cliente REST (`mobile/services/evacuation/`)

`EvacuationProvider`, `routeFormat`, telas (`evacuation.tsx`, `evacuation-ongoing.tsx`)
e `types.ts` **intocados**. Flag `EVACUATION_SCENARIO` permanece (mock-only).

| Arquivo | Ação |
| --- | --- |
| `apiEvacuationBackend.ts` (+test) | `getRoute()` = `apiRequest<RouteSnapshot>('/evacuation/route', {auth:true})` via `services/api/http.ts`. Espelha `apiWeatherBackend`. |
| `getEvacuationBackend.ts` (+test) | despinar → honra `DATA_BACKEND` (`'api'` → apiEvacuationBackend, senão mock). Test troca o "pinned em mock" pela asserção do switch. |
| `amplifyEvacuationBackend.ts` | **deletado** (após confirmar 0 refs). |

## Fluxo de dados

```
tela monta → EvacuationProvider.load() (lazy, 1ª vez) → getRoute() → GET /evacuation/route
  → RouteSnapshot (geometria OSRM real, ou Mapbox em prod, ou canned em falha)
  → evacuation.tsx / evacuation-ongoing.tsx renderizam o mapa via routeFormat
     (chipAnchors / navArrow / lineFeature; straightLine se a chamada falhar de vez)
```

## Tratamento de erro (duas camadas)

- **Servidor:** `RouteProvider` lança (timeout/não-200/payload ruim/OSRM fora) →
  `EvacuationService` **`Logger.warn` + `CANNED_ROUTE`**. O controller **nunca** devolve
  5xx a uma tela de segurança.
- **Cliente:** se mesmo assim a chamada HTTP falhar (rede off), `apiRequest` rejeita →
  `EvacuationProvider` cai em `loadStatus='error'` (`.then(ok,err)`, lição do Chat) →
  as telas usam o `straightLine(origin,destination)` do `routeFormat` (last-resort já
  implementado). Nada a construir no mobile aqui.

## Testes

- **Backend unit**: `evacuation.provider.spec` (coerção de payload GeoJSON de amostra
  Mapbox/OSRM; lança em `routes:[]`/geometria ausente; **seleção de URL** — Mapbox
  quando `MAPBOX_TOKEN` setado, OSRM quando não, `fetch` mockado); `evacuation.service.spec`
  (rota real → snapshot com `fetchedAt`; provider rejeita → `CANNED_ROUTE` + `warn`).
- **Backend e2e** (`evacuation.e2e-spec.ts`): `GET /evacuation/route` **401** sem token;
  **200** + shape com token (`waypoints` array de `[num,num]`, `durationSec`/`distanceM`
  números, `fetchedAt` string) — bate OSRM real, tolera rede off → canned (shape ainda válido).
- **Mobile**: `apiEvacuationBackend.test.ts` (GET /evacuation/route → snapshot, path+auth
  certos); `getEvacuationBackend.test.ts` (switch por `DATA_BACKEND`).
- **Gate full-branch**: backend `build` 0 / `test` verde / `test:e2e` verde; mobile
  `tsc` **8 baseline** (0 novos) / `jest` verde / `expo export --platform web` 0;
  **docker smoke REAL** (rebuild): `GET /evacuation/route` batendo **OSRM de verdade**
  (rota computada de SP no container, provado comparando `waypoints` vs a canned — deve
  diferir em nº de pontos/coordenadas), com `MAPBOX_TOKEN` ausente forçando o caminho keyless.

## Deps novas

**Nenhuma.** Rota real = `fetch` global do Node 20 (sem dep de HTTP); sem cron (sem
`@nestjs/schedule` nesta fatia); sem model (sem migração Prisma). A fatia mais leve
do roadmap.

## Execução (subagent-driven, como Clima)

1. **Provider + coerção** — `evacuation.provider.ts` (coerção pura + seleção Mapbox/OSRM, TDD, `fetch` mockado).
2. **EvacuationService + fallback canned** — `evacuation.service.ts` (+spec).
3. **Controller + módulo + e2e + compose** — `GET /evacuation/route` JWT; `EvacuationModule`; `app.module`; `MAPBOX_TOKEN` no compose.
4. **Mobile** — `apiEvacuationBackend` (+test), despin `getEvacuationBackend` (+test), deletar `amplify`.
5. **Verificação + docker smoke REAL + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality), depois **review holística**, depois
**finishing-branch**. Commit e PR **só com luz verde explícita do usuário** (sem
rastros de IA).

## Pendências de deploy (documentadas, não construídas — só hard-blocks reais)

- **Token Mapbox** (o único hard-block da fatia): `MAPBOX_TOKEN` (secret no deploy) ativa
  o perfil `walking` premium com traffic/SLA. Em dev/container a rota vem do OSRM keyless;
  o Mapbox entra no deploy. Código já é agnóstico de provedor.
- **OSRM só é demo/light-use**: `router.project-osrm.org` é pra teste leve, não produção.
  Prod usa Mapbox (token do cliente) — por isso o token é a config de deploy, não o OSRM.
- **Perfil `walking` no roteador keyless**: se um dia precisar de `foot` sem token, subir
  um OSRM self-hosted com perfil foot (fora de escopo da demo).

## Não-objetivos

Roteamento premium com traffic (Mapbox real), OSRM self-hosted, perfil `walking` keyless,
rotas alternativas/multi-destino, persistência/histórico de rota, recalculo por GPS ao
vivo (a tela `ongoing` é demo, não navegação turn-by-turn real), pontos de encontro
configuráveis (fixo em `SITE_ROUTE`), push real do SO.
