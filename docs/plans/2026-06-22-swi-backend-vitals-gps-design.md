# SWI Backend (AWS) — Fatia 3: Vitais + GPS

**Date:** 2026-06-22
**Branch alvo:** `feat/backend-vitals-gps` (sai do estado atual de `feat/mobile-login`)
**Status:** implementado (caminho mock) em 2026-06-22 — vitais simulados + GPS real (expo-location) atrás da flag `AUTH_BACKEND` (default `mock`); backend-as-code (VitalsSample/LocationSample + TTL) deploy-ready. Estados loading/empty/stale/error wired (status neutro do heart-badge via FALLBACK hide-badge — bump do DS adiado, ver abaixo). Verificação headless verde: `swi-backend` tsc limpo, `mobile` tsc sem erros novos (8 pré-existentes), jest 32/32, `expo export --platform web` OK. **Pendente:** smoke visual dos 5 cenários `VITALS_SCENARIO` (eyeball), deploy real (Fatia 1 Fase 6), e o **bump do DS** (condição neutra no HeartrateStatus/HeartStatus/StatusChart — repo disponível em `C:/Users/Gabriel/Documents/swi-design-system`).

## Contexto

Terceira fatia vertical do backend AWS (depois da Fatia 1 Auth+Perfil). Telemetria
de **sinais vitais + GPS** do worker — o coração do produto (monitoramento de
segurança) e, pela memória, o **maior driver de custo**. Construída no padrão
"Abordagem A" da Fatia 1: backend-as-code + abstração mobile atrás da flag
`AUTH_BACKEND` (default `mock`) + lógica pura testada. **Sem conta AWS ainda** →
tudo deploy-ready; o round-trip real destrava na Fase 6 da Fatia 1 (deploy).

### Decisões desta sessão (2026-06-22)
- **Fonte dos vitais:** **simulados no device** (gerador local). Smartband BLE é uma
  fatia futura dedicada — ortogonal ao backend.
- **Fonte do GPS:** **real via `expo-location`** (decisão 2 = GPS do celular), com
  fallback gracioso pro `USER_LOCATION` mock quando não há GPS (web/simulador/permissão).
- **Escopo:** **vertical completa** — schema + providers + telemetria (batch/downsample)
  + wiring das telas + estados-vazios. Pins de OUTROS workers ficam mock (dado agregado/admin).
- **Estados dos dados:** primeira-classe (loading/empty/stale/error), pensados pra
  produção desde já — o mock simula cada cenário pra serem vistos e testados (não
  descobertos quebrados em produção).
- **Abordagem A** (provider-por-concern + lib de batch pura), não um TelemetryProvider único.

## Seção 1 — Modelo de dados (backend-as-code, `swi-backend`)

Dois models novos em `amplify/data/resource.ts`, owner-scoped:
- **`VitalsSample`** — `workerId`, `recordedAt`, `heartRate`, `bloodPressureSys`/`Dia`,
  `oxygenation`, `caloriesPerHour`, `steps`, `distanceKm`, `effortPct`, `fatiguePct`,
  `fatigueEtaMin`, `status` (`good`/`alert`/`low`), `expiresAt` (epoch, TTL).
- **`LocationSample`** — `workerId`, `recordedAt`, `lat`, `lng`, `accuracy?`, `expiresAt`.
- **Auth:** `allow.owner().to(['create','read'])` + `allow.group('admin').to(['read'])`.
- **TTL (mitigador de custo):** dado bruto expira rápido. O Amplify Gen 2 não expõe TTL
  no `a.model()` → o `backend.ts` adiciona um override CDK (`TimeToLiveSpecification` →
  `expiresAt`) nas tabelas. Backend-as-code, typecheck-ável, deploy-gated. Rollup de
  agregados de longo prazo é refinamento futuro (YAGNI — o downsample no device é o
  controle primário).

## Seção 2 — Vitais: simulador + provider + status

- **`services/vitals/types.ts`** — `Vitals`, `WorkerStatus` (`good`/`alert`/`low`/`unknown`),
  `VitalsBackend` (`getCurrent(): Promise<Vitals>`).
- **`mockVitalsBackend`** — simulador. Baseline = valores do Figma (67 BPM, 12/8, 92,2%
  SpO₂, 145 kcal/h, 8975 passos, 62,5% esforço, 74% fadiga). Deriva = **função pura
  `nextVitals(prev, rng)`** (random-walk limitado), testável com rng determinístico.
  Também simula os cenários de estado (Seção 5).
- **`amplifyVitalsBackend`** — lê o `VitalsSample` mais recente do AppSync (typecheck-only).
- **`deriveStatus(vitals): WorkerStatus`** — pura, com thresholds; retorna `unknown` quando
  não há dado/stale (ver Seção 5 — segurança). Testada.
- **`VitalsProvider` / `useVitals()`** — guarda fase + `{ vitals, status, lastUpdated }`
  + histórico curto em memória (pro gráfico de calorias).
- **Cadência display ≠ telemetria:** display atualiza ~4s (demo "respira"); amostragem/
  upload roda a cada 1-5 min (decisão 1). Independentes e configuráveis.

## Seção 3 — Localização: GPS real (`expo-location`)

- Dep nova: `expo-location`.
- **`LocationProvider` / `useLocation()`** — pede permissão, `watchPositionAsync`, expõe
  `{ coords: [lng,lat], source: 'gps' | 'fallback', permission }`. **Fallback** pro
  `USER_LOCATION` mock quando permissão negada / web sem geolocation / simulador / erro.
- **Consumo:** pin do usuário no `map` usa `coords` real; pins de outros workers seguem
  `WORKER_LOCATIONS` mock. `map` já é gated por `isFeatureEnabled('maps')` (prod build).

## Seção 4 — Telemetria: batch/downsample + sink

- **`lib/telemetry/batch.ts` (funções puras, testadas):** `downsample(samples, intervalMs)`,
  `aggregate(window)` (avg/min/max — pro rollup futuro), `shouldFlush(buffer, maxSize, maxAgeMs)`.
- **`services/telemetry/` — sink flag-driven:** `TelemetrySink` (`uploadVitals`, `uploadLocation`);
  `mockTelemetrySink` (no-op + log em memória pros testes) e `amplifyTelemetrySink`
  (`client.models.VitalsSample/LocationSample.create`, typecheck-only). `getTelemetrySink()`
  escolhe pela flag.
- **`useTelemetrySampler()` (montado no root):** a cada 1-5 min pega `vitals` + `coords`,
  monta o sample (`expiresAt = agora + TTL`), passa pelo buffer/`downsample`, `flush` no sink.
  No mock só loga; virar a flag liga o upload real.
- **Custo materializado:** amostra 1×/intervalo (não contínuo), batch antes de subir, bruto
  com TTL — exatamente o mitigador da memória.

## Seção 5 — Estados dos dados (loading / empty / stale / error) — produção-ready

Pensado pra não shippar UI que assume dado. Aterrissado no DS v0.1.112.
- **Provider expõe FASE:** `{ phase: 'loading'|'ready'|'empty'|'stale'|'error', vitals?, status, lastUpdated? }`.
- **Segurança (crítico num app de monitoramento):** `status = 'unknown'` em empty/stale —
  **nunca finge `good`**. Mostrar "tudo bem" sem leitura real seria perigoso.
- **UI por estado, mapeada ao DS:**
  - **loading** → `ActivityIndicator` (primitivo RN, já usado no spinner do CEP). Sem bump.
  - **empty** (worker novo / sem leitura) → layout composto de DS (`Title`/`Text`/`Icon`/`Button`)
    + `SmartbandStatus` ("conecte sua smartband / sem leituras ainda"). Composição page-level (permitida).
  - **stale** → valores esmaecidos (opacity) + `TimeStamp` ("atualizado há Xmin") + status neutro.
  - **error** → `Toast` + botão "tentar de novo".
  - **status neutro:** map pin → `LocationPin status="offline"` (✓ DS já tem). Dashboard/my-stats
    heart badge → DS **não** tem condição neutra (`HeartrateStatus`/`HeartStatus`/`StatusChart` só
    têm `check/good/alert/low`) → **BUMP DO DS preferido** (adicionar condição neutra/`unknown` cinza,
    coerente com o `offline` do `LocationPin`). **Fallback sem bump** (se o repo do DS não estiver
    acessível neste ciclo): no stale, esconder o heart badge e mostrar só placeholder + `TimeStamp`.
- **O mock simula cada cenário** (seletor `empty | loading | stale | error | streaming`) → ligamos
  e VEMOS cada UI vazia no demo/dev. Ponto central da preocupação do usuário.
- **"stale"** = sem amostra dentro de ~2× o intervalo de telemetria.

## Seção 6 — Wiring das telas (state-aware)

- **my-stats** — `useVitals()` → renderiza por fase (ready=valores reais incl. donuts/fadiga/
  série de calorias do histórico; empty=placeholder; loading=spinner; stale=esmaecido+TimeStamp).
  Alergias/histórico médico/exames ficam mock (profile/health-data, fora de escopo).
- **dashboard** — heart badge + BPM + fadiga por `status`/fase (neutro quando unknown).
- **map** — pin do usuário = `useLocation()` coords + `useVitals().status` (→ `offline` sem dado);
  outros workers seguem mock.
- Providers (`VitalsProvider` + `LocationProvider`) montados no `_layout` (dentro dos existentes);
  `useTelemetrySampler` inicia no mount.

## Seção 7 — Testes & não-objetivos

**Testes (jest):** `nextVitals` (drift limitado), `deriveStatus` (inclui `unknown` em empty/stale),
`downsample`/`aggregate`/`shouldFlush`, seleção de sink por flag, fallback de location, e a
**máquina de fases** (loading→ready→stale). `tsc` (mobile + backend) sem erros novos.

**Bump do DS (se aprovado/possível):** condição neutra no `HeartrateStatus`/`HeartStatus`/
`StatusChart` (no repo swi-design-system → build dist → novo `.tgz` vendorizado → bump em
`mobile/package.json`). Fallback documentado na Seção 5 se o repo não estiver acessível.

**Não-objetivos:** smartband BLE, upload real (deploy-gated), rollup de agregados, pins de
outros workers ao vivo, heatmap, alergias/histórico médico, séries históricas além do buffer
curto em memória.

## Placement & branch
Toca `swi-backend/` (2 models + TTL override) + `mobile/` (services/vitals, services/location,
services/telemetry, lib/telemetry, wiring das 3 telas, `_layout`) + possivelmente o DS (bump).
Branch `feat/backend-vitals-gps` saindo de `feat/mobile-login`. Docs são temporários (deletar
quando o backend inteiro estiver pronto — decisão do usuário).
