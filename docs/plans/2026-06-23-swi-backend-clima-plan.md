# Clima Slice — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.
>
> **Commit rule (SWI):** per-unit commits land on the isolated branch `feat/backend-clima`; the FF-merge to `feat/mobile-login` happens **only with explicit user OK**.

**Goal:** Feed real weather (OpenWeather One Call 3.0, fetched server-side by a Lambda) into the dashboard's alert-active weather row + the WeatherAlertModal, behind the `AUTH_BACKEND` flag (mock now, amplify deploy-gated) — keeping everything jest+tsc green without deploying.

**Architecture:** First Lambda of the project (`swi-backend/amplify/functions/weather/`) wired as an **Amplify Data custom query** `getWeather → WeatherSnapshot` (no DynamoDB model — it's a pass-through to the external API). Mobile mirrors the established `services/<domain>` shape (`services/weather/`): types + pure `weatherFormat` + `mockWeatherBackend` + deploy-gated `amplifyWeatherBackend` + `getWeatherBackend` selector + `WeatherProvider` (root-mounted). Wiring touches `AlertActiveView` (dashboard) + `WeatherAlertModal`. Design: `docs/plans/2026-06-23-swi-backend-clima-design.md`.

**Tech Stack:** Expo Router + React Native, `@kavicki/swi-design-system` (tokens via `useTheme()`), AWS Amplify Gen 2 (`@aws-amplify/backend` ^1.23, `defineFunction`/`secret`/custom query, deploy-gated), OpenWeather One Call 3.0, Jest, TypeScript.

---

## Pre-flight

**Step 0.1 — Branch from the clean merge tip.** From repo root (on `feat/mobile-login @ 63ce40c`, tree clean):
```bash
git switch -c feat/backend-clima
```
Reference commands: mobile `cd mobile && npx jest <p>` / `npx tsc --noEmit` / `npx expo export --platform web`; backend `cd swi-backend && npx tsc --noEmit -p amplify`. Mobile `tsc` baseline = **8 pre-existing errors**; target **0 new**.

---

## Unit 1 — Backend (first Lambda + custom query)

### Task 1: Weather Lambda (`defineFunction` + handler)

**Files:**
- Create: `swi-backend/amplify/functions/weather/resource.ts`
- Create: `swi-backend/amplify/functions/weather/handler.ts`

**Step 1: `resource.ts`:**
```ts
import { defineFunction, secret } from '@aws-amplify/backend';

// 1ª Lambda do projeto. Passagem deploy-gated p/ a OpenWeather One Call 3.0.
// A chave vem de um secret (setado no deploy via `ampx sandbox secret`).
export const weather = defineFunction({
  name: 'weather',
  entry: './handler.ts',
  environment: {
    OPENWEATHER_API_KEY: secret('OPENWEATHER_API_KEY'),
  },
  timeoutSeconds: 15,
});
```

**Step 2: `handler.ts`** (deploy-gated — written + typechecked, never invoked until AWS exists; Node 18+ Lambda runtime provides global `fetch`/`process`):
```ts
// Deploy-gated. Busca OpenWeather One Call 3.0 e mapeia → o shape devolvido
// pela custom query getWeather (ver data/resource.ts). NUNCA roda agora (sem
// conta AWS); existe pra o backend ser código real + typechecked.

interface OneCallAlert { event?: string; description?: string; start?: number; end?: number; }
interface OneCall {
  current?: { temp?: number; humidity?: number; wind_speed?: number; weather?: { main?: string }[] };
  daily?: { temp?: { min?: number; max?: number } }[];
  alerts?: OneCallAlert[];
}

// Mapeia o `weather[0].main` da OpenWeather → o enum WeatherCondition do app.
function mapCondition(main: string | undefined): string {
  switch ((main ?? '').toLowerCase()) {
    case 'thunderstorm': return 'storm';
    case 'rain': case 'drizzle': return 'rain';
    case 'snow': return 'snow';
    case 'clouds': return 'clouds';
    case 'mist': case 'fog': case 'haze': return 'fog';
    default: return 'clear';
  }
}

export const handler = async (event: { arguments: { lat: number; lng: number } }) => {
  const key = process.env.OPENWEATHER_API_KEY;
  const { lat, lng } = event.arguments;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}&units=metric&exclude=minutely,hourly&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather ${res.status}`);
  const data = (await res.json()) as OneCall;

  const today = data.daily?.[0]?.temp;
  const nowIso = new Date().toISOString();
  return {
    tempC: data.current?.temp ?? 0,
    condition: mapCondition(data.current?.weather?.[0]?.main),
    humidityPct: data.current?.humidity ?? 0,
    windKmh: Math.round((data.current?.wind_speed ?? 0) * 3.6), // m/s → km/h
    minC: today?.min ?? 0,
    maxC: today?.max ?? 0,
    alerts: (data.alerts ?? []).map((a, i) => ({
      id: `wx-${i}`,
      event: a.event ?? 'Alerta meteorológico',
      description: a.description ?? '',
      startsAt: a.start ? new Date(a.start * 1000).toISOString() : nowIso,
      endsAt: a.end ? new Date(a.end * 1000).toISOString() : nowIso,
    })),
    fetchedAt: nowIso,
  };
};
```

**Step 3: Typecheck.** `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.
> CONTINGENCY: if tsc reports `Cannot find name 'fetch'`, the runtime has it but the lib doesn't — add `/// <reference lib="dom" />` as the FIRST line of `handler.ts` (file-scoped; do NOT add a `declare` that could duplicate `@types/node`'s global). Re-run.

(No commit yet — commit Unit 1 together after Task 3.)

### Task 2: Custom type + custom query in the schema

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts`

**Step 1:** At the top, import the function (after the existing import line):
```ts
import { weather } from '../functions/weather/resource';
```

**Step 2:** Inside `a.schema({ ... })`, after the `Notification` model, add the custom types + query (flattened wire shape — the mobile mirror re-nests at its boundary):
```ts
  // ---- Clima (fatia 5): passagem pra OpenWeather via Lambda, sem model ----
  WeatherAlertType: a.customType({
    id: a.string(),
    event: a.string(),
    description: a.string(),
    startsAt: a.datetime(),
    endsAt: a.datetime(),
  }),

  WeatherSnapshot: a.customType({
    tempC: a.float(),
    condition: a.string(),       // enum WeatherCondition no app
    humidityPct: a.integer(),
    windKmh: a.float(),
    minC: a.float(),
    maxC: a.float(),
    alerts: a.ref('WeatherAlertType').array(),
    fetchedAt: a.datetime(),
  }),

  getWeather: a
    .query()
    .arguments({ lat: a.float().required(), lng: a.float().required() })
    .returns(a.ref('WeatherSnapshot'))
    .handler(a.handler.function(weather))
    .authorization((allow) => [allow.authenticated()]),
```

**Step 3: Typecheck.** `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.

### Task 3: Register the function in the backend

**Files:**
- Modify: `swi-backend/amplify/backend.ts`

**Step 1:** Import + register:
```ts
import { weather } from './functions/weather/resource';
```
and change `defineBackend({ auth, data, storage })` → `defineBackend({ auth, data, storage, weather })`. Leave the TTL block unchanged.

**Step 2: Typecheck.** `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0.

**Step 3: Commit (Unit 1).**
```bash
git add swi-backend/amplify/functions swi-backend/amplify/data/resource.ts swi-backend/amplify/backend.ts
git commit -F - <<'EOF'
feat(clima): weather Lambda + getWeather custom query (deploy-gated, sem model)

1ª função do projeto. defineFunction weather (OpenWeather One Call 3.0, chave via
secret) + handler deploy-gated; customTypes WeatherSnapshot/WeatherAlertType +
custom query getWeather(lat,lng) com allow.authenticated(); registrada no
defineBackend. Pass-through externo — sem model DynamoDB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

> **Two-gate review (Unit 1):** spec reviewer (function + customTypes + query shape match design; auth `authenticated`; no model) + code-quality reviewer. Fix + re-run `tsc -p amplify`.

---

## Unit 2 — Service layer (`mobile/services/weather/`)

### Task 4: Domain types

**Files:** Create `mobile/services/weather/types.ts`
```ts
// Local mirror do shape devolvido pela custom query getWeather do swi-backend.
// Siblings isolados → NÃO importamos o Schema; após deploy, `ampx generate` pode
// substituir. Mirrors services/<domínio>/types.ts. Datas ISO.

export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog';

export interface WeatherCurrent {
  tempC: number;
  condition: WeatherCondition;
  humidityPct: number;
  windKmh: number;
}
export interface WeatherDaily { minC: number; maxC: number; }
export interface WeatherAlert {
  id: string;
  event: string;             // "Tempestade severa"
  description: string;
  startsAt: string;          // ISO datetime
  endsAt: string;            // ISO datetime
}
export interface WeatherSnapshot {
  current: WeatherCurrent;
  daily: WeatherDaily;
  alerts: WeatherAlert[];    // vazio = sem alerta ativo
  fetchedAt: string;         // ISO datetime
}

export interface WeatherBackend {
  // sem args: usa a constante SITE_LOCATION (clima do local fixo da obra).
  getWeather(): Promise<WeatherSnapshot>;
}

// Centroide do site (piloto SP) — mesmo valor do USER_LOCATION que o mapa
// centraliza. Fonte da verdade de "onde é a obra" pro clima. [lng, lat].
export const SITE_LOCATION: { lat: number; lng: number } = { lat: -23.55, lng: -46.63 };
```

### Task 5: Pure formatters + alert helper (TDD)

**Files:** Create `mobile/services/weather/weatherFormat.ts` + `.test.ts`

**Step 1: Failing test** (`weatherFormat.test.ts`):
```ts
import { formatTempC, formatHumidity, formatWind, conditionLabel, activeAlert } from './weatherFormat';
import type { WeatherSnapshot, WeatherAlert } from './types';

const snap = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 },
  daily: { minC: 19, maxC: 32 },
  alerts: [],
  fetchedAt: '2026-06-23T12:00:00.000Z',
  ...over,
});
const alert = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'a', event: 'Tempestade', description: 'desc',
  startsAt: '2026-06-23T10:00:00.000Z', endsAt: '2026-06-23T18:00:00.000Z', ...over,
});

describe('weatherFormat — formatters', () => {
  it('formata temp/umidade/vento com unidades', () => {
    expect(formatTempC(17)).toBe('17ºC');
    expect(formatTempC(17.6)).toBe('18ºC');      // arredonda
    expect(formatHumidity(65)).toBe('65%');
    expect(formatWind(65)).toBe('65km/h');
  });
  it('conditionLabel mapeia o enum pra PT-BR', () => {
    expect(conditionLabel('rain')).toBe('Chuva Intensa');
    expect(conditionLabel('clear')).toBe('Céu limpo');
  });
});

describe('weatherFormat — activeAlert', () => {
  const now = new Date('2026-06-23T12:00:00.000Z');
  it('devolve o alerta vigente', () => {
    expect(activeAlert(snap({ alerts: [alert()] }), now)?.event).toBe('Tempestade');
  });
  it('null quando não há alertas', () => {
    expect(activeAlert(snap({ alerts: [] }), now)).toBeNull();
  });
  it('ignora alerta expirado (endsAt < now)', () => {
    expect(activeAlert(snap({ alerts: [alert({ endsAt: '2026-06-23T11:00:00.000Z' })] }), now)).toBeNull();
  });
});
```
Run `cd mobile && npx jest weatherFormat` → FAIL.

**Step 2: Implement** (`weatherFormat.ts`):
```ts
// Lógica PURA do clima (formatters + seleção de alerta vigente). Sem efeitos;
// `now` é injetado pra testabilidade. Espelha o estilo de progress.ts.
import type { WeatherSnapshot, WeatherAlert, WeatherCondition } from './types';

export function formatTempC(c: number): string { return `${Math.round(c)}ºC`; }
export function formatHumidity(pct: number): string { return `${Math.round(pct)}%`; }
export function formatWind(kmh: number): string { return `${Math.round(kmh)}km/h`; }

const CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: 'Céu limpo',
  clouds: 'Nublado',
  rain: 'Chuva Intensa',
  storm: 'Tempestade',
  snow: 'Neve',
  fog: 'Névoa',
};
export function conditionLabel(c: WeatherCondition): string { return CONDITION_LABEL[c]; }

// O 1º alerta ainda vigente (endsAt >= now), ou null. `now` default = relógio real.
export function activeAlert(s: WeatherSnapshot, now: Date = new Date()): WeatherAlert | null {
  const t = now.getTime();
  return s.alerts.find((a) => new Date(a.endsAt).getTime() >= t) ?? null;
}
```
Run `cd mobile && npx jest weatherFormat` → PASS.

**Step 3: Commit.**
```bash
git add mobile/services/weather/types.ts mobile/services/weather/weatherFormat.ts mobile/services/weather/weatherFormat.test.ts
git commit -F - <<'EOF'
feat(clima): weather domain types + pure formatters/activeAlert (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

### Task 6: Mock backend + scenario flag (TDD)

**Files:** Modify `mobile/lib/featureFlags.ts`; Create `mobile/services/weather/mockWeatherBackend.ts` + `.test.ts`

**Step 1:** Add the scenario flag to `featureFlags.ts` (after `VITALS_SCENARIO`):
```ts
// Dev-only: exercita os estados da fatia Clima no mock. 'alert' (default) traz
// um alerta vigente; 'normal' sem alerta; 'loading' nunca resolve; 'error' rejeita.
export type WeatherScenario = 'alert' | 'normal' | 'loading' | 'error';
export const WEATHER_SCENARIO: WeatherScenario = 'alert';
```

**Step 2: Failing test** (`mockWeatherBackend.test.ts`):
```ts
jest.mock('../../lib/featureFlags', () => ({ WEATHER_SCENARIO: 'alert' }));
import { mockWeatherBackend } from './mockWeatherBackend';

describe('mockWeatherBackend (scenario=alert)', () => {
  it('devolve o snapshot canned com os valores do dashboard + 1 alerta', async () => {
    const s = await mockWeatherBackend.getWeather();
    expect(s.current).toEqual({ tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 });
    expect(s.daily).toEqual({ minC: 19, maxC: 32 });
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].description).toContain('desabamentos');
  });
});
```
Run `cd mobile && npx jest mockWeatherBackend` → FAIL.

**Step 3: Implement** (`mockWeatherBackend.ts`):
```ts
import type { WeatherBackend, WeatherSnapshot } from './types';
import { WEATHER_SCENARIO } from '../../lib/featureFlags';

// Backend demo in-memory pra fatia Clima. Snapshot canned batendo os valores
// que hoje estão hardcoded no dashboard alert-active + no WeatherAlertModal
// (17º atual, 32º/19º, 65%, 65km/h, chuva) pra continuidade visual. O cenário
// (flag WEATHER_SCENARIO) exercita alert/normal/loading/error.
const BASE = '2026-06-23T12:00:00.000Z';

function snapshot(withAlert: boolean): WeatherSnapshot {
  return {
    current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 },
    daily: { minC: 19, maxC: 32 },
    alerts: withAlert
      ? [{
          id: 'wx-0',
          event: 'Tempestade severa',
          description: 'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.',
          startsAt: BASE,
          endsAt: '2026-06-24T00:00:00.000Z',
        }]
      : [],
    fetchedAt: BASE,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<WeatherSnapshot>(() => {}); // 'loading' nunca resolve

export const mockWeatherBackend: WeatherBackend = {
  async getWeather() {
    if (WEATHER_SCENARIO === 'loading') return never();
    await tick();
    if (WEATHER_SCENARIO === 'error') throw new Error('mock weather error');
    return snapshot(WEATHER_SCENARIO !== 'normal'); // 'alert' (default) e qualquer outro → com alerta
  },
};
```
Run `cd mobile && npx jest mockWeatherBackend` → PASS.

**Step 4: Commit.**
```bash
git add mobile/lib/featureFlags.ts mobile/services/weather/mockWeatherBackend.ts mobile/services/weather/mockWeatherBackend.test.ts
git commit -F - <<'EOF'
feat(clima): mock weather backend + WEATHER_SCENARIO flag (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

### Task 7: Amplify stub + selector (TDD)

**Files:** Create `amplifyWeatherBackend.ts`, `getWeatherBackend.ts` + `.test.ts`

**Step 1: `amplifyWeatherBackend.ts`** (deploy-gated):
```ts
import { generateClient } from 'aws-amplify/data';
import type { WeatherBackend, WeatherSnapshot } from './types';
import { SITE_LOCATION } from './types';

const client = generateClient();
const NOT_READY = (op: string) => new Error(`amplifyWeatherBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyWeatherBackend: WeatherBackend = {
  async getWeather(): Promise<WeatherSnapshot> {
    // Deploy: const { data } = await client.queries.getWeather(SITE_LOCATION);
    //   → re-nest data (tempC/humidityPct/... ) no shape current/daily + coage alerts.
    void client; void SITE_LOCATION;
    throw NOT_READY('getWeather');
  },
};
```

**Step 2: Failing test** (`getWeatherBackend.test.ts`):
```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock', WEATHER_SCENARIO: 'alert' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getWeatherBackend } from './getWeatherBackend';
import { mockWeatherBackend } from './mockWeatherBackend';

describe('getWeatherBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
});
```
Run `cd mobile && npx jest getWeatherBackend` → FAIL.

**Step 3: `getWeatherBackend.ts`:**
```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { WeatherBackend } from './types';
import { mockWeatherBackend } from './mockWeatherBackend';
import { amplifyWeatherBackend } from './amplifyWeatherBackend';

export function getWeatherBackend(): WeatherBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyWeatherBackend : mockWeatherBackend;
}
```
Run `cd mobile && npx jest getWeatherBackend` → PASS.

**Step 4: Commit.**
```bash
git add mobile/services/weather/amplifyWeatherBackend.ts mobile/services/weather/getWeatherBackend.ts mobile/services/weather/getWeatherBackend.test.ts
git commit -F - <<'EOF'
feat(clima): amplify stub (deploy-gated) + flag selector (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

### Task 8: Provider

**Files:** Create `mobile/services/weather/WeatherProvider.tsx`
```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { WeatherSnapshot, WeatherAlert } from './types';
import { getWeatherBackend } from './getWeatherBackend';
import { activeAlert as pickActiveAlert } from './weatherFormat';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherContextValue {
  loadStatus: LoadStatus;
  snapshot: WeatherSnapshot | null;
  activeAlert: WeatherAlert | null;
  reload: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextValue | null>(null);

export function WeatherProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getWeatherBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);

  const reload = useCallback(() => {
    setLoadStatus('loading');
    return backend.getWeather().then(
      (s) => { setSnapshot(s); setLoadStatus('ready'); },
      () => { setLoadStatus('error'); },   // .then(ok,err), NÃO .finally (lição do Chat)
    );
  }, [backend]);

  useEffect(() => { reload(); }, [reload]);

  // Alerta vigente derivado do snapshot (filtra expirados).
  const activeAlert = useMemo(() => (snapshot ? pickActiveAlert(snapshot) : null), [snapshot]);

  const value = useMemo<WeatherContextValue>(
    () => ({ loadStatus, snapshot, activeAlert, reload }),
    [loadStatus, snapshot, activeAlert, reload],
  );
  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather(): WeatherContextValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather must be used inside WeatherProvider');
  return ctx;
}
```

**Step 1: Typecheck.** `cd mobile && npx tsc --noEmit` → 0 new errors.

**Step 2: Commit.**
```bash
git add mobile/services/weather/WeatherProvider.tsx
git commit -F - <<'EOF'
feat(clima): WeatherProvider (load/reload + derived activeAlert, reachable error)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

> **Two-gate review (Unit 2):** spec reviewer (interface ↔ design; mock values match the dashboard's hardcoded set; `.then(ok,err)`; SITE_LOCATION) + code-quality reviewer (DRY vs sibling services, no hardcoded values, test quality). Re-run `npx jest services/weather` + `tsc`.

---

## Unit 3 — Wiring

### Task 9: Mount `WeatherProvider` at the root layout

**Files:** Modify `mobile/app/_layout.tsx`

**Step 1:** Import alongside the other providers (near line 25-26):
```ts
import { WeatherProvider } from '../services/weather/WeatherProvider';
```
**Step 2:** Wrap the existing provider stack — add `<WeatherProvider>` just inside `<LocationProvider>` (so it covers the whole `<Stack>`, including the `modals/weather-alert` route). I.e. change:
```tsx
            <LocationProvider>
            {/* Feeds live vitals ... */}
            <TelemetryRoot />
            <View style={mobileFrameStyle}>
              <Stack ...>...</Stack>
            </View>
            </LocationProvider>
```
to wrap the `<View>`…`</View>` (the Stack container) in `<WeatherProvider>…</WeatherProvider>`. Keep `<TelemetryRoot />` where it is. Verify the opening/closing tags balance.

**Step 3: Typecheck.** `cd mobile && npx tsc --noEmit` → 0 new errors. (Commit with Task 11.)

### Task 10: Wire the dashboard alert-active weather row + description

**Files:** Modify `mobile/app/(app)/dashboard.tsx` (the `AlertActiveView` component — the weather row at ~973-1046 + the description at ~1038-1046)

**Step 1:** In `AlertActiveView`, consume the provider + formatters. Add imports at the top of `dashboard.tsx`:
```ts
import { useWeather } from '../../services/weather/WeatherProvider';
import { formatTempC, formatHumidity, formatWind, conditionLabel } from '../../services/weather/weatherFormat';
```
**Step 2:** Inside `AlertActiveView`, read the snapshot + alert and derive display values with **fallbacks to today's static copy** (so the safety screen never breaks on loading/error):
```tsx
const { snapshot, activeAlert } = useWeather();
const cur = snapshot?.current;
const day = snapshot?.daily;
const tempStr = cur ? formatTempC(cur.tempC) : '17ºC';
const condStr = cur ? conditionLabel(cur.condition) : 'Chuva Intensa';
const humStr = cur ? formatHumidity(cur.humidityPct) : '65%';
const windStr = cur ? formatWind(cur.windKmh) : '65km/h';
const maxStr = day ? formatTempC(day.maxC) : '32ºC';
const minStr = day ? formatTempC(day.minC) : '19ºC';
const alertDesc = activeAlert?.description
  ?? 'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.';
```
**Step 3:** Replace the hardcoded strings in the weather row + description with these vars:
- card `<Title>17ºC</Title>` → `{tempStr}`; `<Text>Chuva Intensa</Text>` → `{condStr}`
- the 4 `WeatherDataRow value=` props: `"65%"`→`{humStr}`, `"65km/h"`→`{windStr}`, `"32ºC"`→`{maxStr}`, `"19ºC"`→`{minStr}`
- the Description `<Text>` body → `{alertDesc}`
- Leave the rain icon (`weather-rainy.png`), layout, and all other steps UNCHANGED. (Condition→icon asset mapping is a deploy pendência — only the rain asset exists; the LABEL is wired, the glyph stays rain.)

**Step 4: Typecheck.** `cd mobile && npx tsc --noEmit` → 0 new errors.

### Task 11: Wire the WeatherAlertModal

**Files:** Modify `mobile/components/modals/WeatherAlertModal.tsx`

**Step 1:** Make the modal read the live snapshot/alert internally (it renders under the root `WeatherProvider` at all 3 call sites). Add imports:
```ts
import { useWeather } from '../../services/weather/WeatherProvider';
import { formatTempC, formatHumidity, formatWind, conditionLabel } from '../../services/weather/weatherFormat';
```
**Step 2:** Inside `WeatherAlertModal`, derive display values with the SAME static fallbacks as the dashboard (keeps today's copy when loading/error/no-alert):
```tsx
const { snapshot, activeAlert } = useWeather();
const cur = snapshot?.current;
const day = snapshot?.daily;
const tempStr = cur ? formatTempC(cur.tempC) : '17ºC';
const condStr = cur ? conditionLabel(cur.condition) : 'Chuva Intensa';
const humStr = cur ? formatHumidity(cur.humidityPct) : '65%';
const windStr = cur ? formatWind(cur.windKmh) : '65km/h';
const maxStr = day ? formatTempC(day.maxC) : '32ºC';
const minStr = day ? formatTempC(day.minC) : '19ºC';
const descStr = activeAlert?.description
  ?? 'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.';
```
**Step 3:** Replace the hardcoded `17ºC`/`Chuva Intensa`/`65%`/`65km/h`/`32ºC`/`19ºC` + the description `<Text>` with these vars (the `MetricRow value=` props + the condition card Title/Text + the description). Keep the SvgXml icons, layout, the CTA, and the rain image UNCHANGED.

**Step 4: Typecheck + bundle.** `cd mobile && npx tsc --noEmit` → 0 new; `cd mobile && npx expo export --platform web` → exit 0.

**Step 5: Commit (Unit 3).**
```bash
git add mobile/app/_layout.tsx "mobile/app/(app)/dashboard.tsx" mobile/components/modals/WeatherAlertModal.tsx
git commit -F - <<'EOF'
feat(clima): wire dashboard alert-active row + WeatherAlertModal to live weather

WeatherProvider montado no root layout (cobre as 3 entradas do modal incl. a rota
modals/). AlertActiveView e WeatherAlertModal leem useWeather(): temp/umidade/
vento/máx/mín reais + descrição do activeAlert, com fallback pro texto estático
de hoje em loading/error/sem-alerta (tela de segurança nunca quebra). Ícone de
chuva e layout intactos; mapa segue decorativo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

> **Two-gate review (Unit 3):** spec reviewer (provider mounted root; both surfaces wired with static fallbacks; map untouched; no call-site prop changes) + code-quality reviewer (DS tokens intact, no hardcoded values introduced, fallbacks sound).

---

## Full-branch verification

`cd mobile && npx jest` → all green (existing 87 + new weather suites). · `cd mobile && npx tsc --noEmit` → **8 baseline, 0 new**. · `cd swi-backend && npx tsc --noEmit -p amplify` → exit 0. · `cd mobile && npx expo export --platform web` → exit 0. Record exact numbers.

> **Holistic review:** dispatch `superpowers:code-reviewer` over the branch diff vs `feat/mobile-login` — design parity, the first-Lambda/custom-query correctness, the Chat-lesson checks (reachable error via `.then(ok,err)`, graceful fallback so the safety screen never breaks), DS-token compliance, no hardcoded values. Fix + re-verify.

## Finishing the branch

Use `superpowers:finishing-a-development-branch`. **Merge to `feat/mobile-login` only with explicit user OK.** On OK: FF-merge `feat/backend-clima` → `feat/mobile-login`, delete the slice branch, re-run jest, update `docs/plans/2026-06-22-...-roadmap-design.md` (mark fatia 5 implemented) + the `project_swi_aws_backend` memory.

## Deploy-time pendências (documented)
OpenWeather key as a real secret (`ampx sandbox secret set OPENWEATHER_API_KEY`); in-Lambda/DynamoDB+TTL cache (1 fetch/site, free tier); `client.queries.getWeather` re-nest + `ampx generate` return-shape parity; condition→icon asset set (only `weather-rainy.png` exists today — label is wired, glyph stays rain); coerce missing/expired alerts at the boundary; handler `fetch` lib contingency (see Task 1).
