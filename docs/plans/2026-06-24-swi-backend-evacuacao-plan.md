# Evacuação Backend Slice — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move evacuation routing server-side (2nd project Lambda, deploy-gated) and wire the two evacuation screens through a `services/evacuation` seam mirroring `services/weather`, with real loading/error states — no visual change to the route.

**Architecture:** Amplify Gen 2 "Abordagem A, deploy-gated". A `route` Lambda (Mapbox Directions, key via `secret`) is exposed as an Amplify Data **custom query** `getEvacuationRoute` (no DynamoDB model). The mobile app reads it through `services/evacuation` (pure `routeFormat`, canned `mock`, deploy-gated `amplify` stub, flag selector, lazy `EvacuationProvider` at `(app)/_layout`). The two screens consume `useEvacuation()`; `lib/api/osrm.ts` + `lib/evacuationRouteCache.ts` are deleted.

**Tech Stack:** TypeScript, Expo Router + React Native, `@maplibre`/`geojson`, Jest, Amplify Gen 2 (`@aws-amplify/backend`).

**Design doc:** `docs/plans/2026-06-24-swi-backend-evacuacao-design.md`

**Branch:** `feat/backend-evacuacao` (already created off `feat/mobile-login @ 6310cb9`; design doc committed at `87c62b4`).

**Verification commands (reference):**
- Mobile tests: `cd mobile && npx jest <path>` — full: `cd mobile && npx jest`
- Mobile types: `cd mobile && npx tsc --noEmit` (baseline = 8 pre-existing errors; target **0 new**)
- Backend types: `cd swi-backend && npx tsc --noEmit -p amplify` (tsconfig under `amplify/`, ESM)
- Web export: `cd mobile && npx expo export --platform web` (exit 0)

> ⚠️ Subagents: Bash cwd persists. Always `cd` explicitly (`cd mobile && …` / `cd swi-backend && …`). The repo root is `C:\Users\Gabriel\Documents\SWI-mobile`; there is no nested `.git`.

---

## Unit 1 — Backend (`swi-backend/amplify/`)

The 2nd Lambda, mirroring `functions/weather/`. Never invoked now (no AWS); exists so the backend is real, typechecked code.

### Task 1.1: Create the `route` Lambda (resource + handler)

**Files:**
- Create: `swi-backend/amplify/functions/route/resource.ts`
- Create: `swi-backend/amplify/functions/route/handler.ts`

**Step 1: Write `resource.ts`**

```ts
import { defineFunction, secret } from '@aws-amplify/backend';

// 2ª Lambda do projeto. Passagem deploy-gated p/ o Mapbox Directions (walking).
// O token vem de um secret (setado no deploy via `ampx sandbox secret`).
export const route = defineFunction({
  name: 'route',
  entry: './handler.ts',
  environment: {
    MAPBOX_TOKEN: secret('MAPBOX_TOKEN'),
  },
  timeoutSeconds: 15,
  runtime: 20,
});
```

**Step 2: Write `handler.ts`**

```ts
// Deploy-gated. Busca Mapbox Directions (walking) e mapeia → o shape RouteSnapshot
// devolvido pela custom query getEvacuationRoute (ver data/resource.ts). NUNCA roda
// agora (sem conta AWS); existe pra o backend ser código real + typechecked.

interface MapboxRoute {
  geometry?: { coordinates?: [number, number][] };
  duration?: number;
  distance?: number;
}
interface MapboxResponse { routes?: MapboxRoute[] }

export const handler = async (event: {
  arguments: { originLng: number; originLat: number; destLng: number; destLat: number };
}) => {
  const token = process.env.MAPBOX_TOKEN;
  const { originLng, originLat, destLng, destLat } = event.arguments;
  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status}`);
  const data = (await res.json()) as MapboxResponse;
  const r = data.routes?.[0];
  return {
    waypoints: r?.geometry?.coordinates ?? [],
    durationSec: r?.duration ?? 0,
    distanceM: r?.distance ?? 0,
    fetchedAt: new Date().toISOString(),
  };
};
```

**Step 3: Commit (after Task 1.4 verifies; do NOT verify yet — `data/resource.ts` references `route` next).**

---

### Task 1.2: Add `RouteSnapshot` customType + `getEvacuationRoute` query

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts` (import near line 2; add to `a.schema({ … })` after the Clima `getWeather` block, before the closing `})` at line ~225)

**Step 1: Add the import** (next to `import { weather } from '../functions/weather/resource';`)

```ts
import { route } from '../functions/route/resource';
```

**Step 2: Add to the schema**, immediately after the `getWeather` query block (currently ends ~line 224) and before the schema's closing `});`:

```ts
  // ---- Evacuação (fatia 6): passagem pro Mapbox Directions via Lambda, sem model ----
  RouteSnapshot: a.customType({
    waypoints: a.json(),         // [[lng,lat], …] — array de tuplas; json p/ aninhamento
    durationSec: a.float(),
    distanceM: a.float(),
    fetchedAt: a.datetime(),
  }),

  getEvacuationRoute: a
    .query()
    .arguments({
      originLng: a.float().required(),
      originLat: a.float().required(),
      destLng: a.float().required(),
      destLat: a.float().required(),
    })
    .returns(a.ref('RouteSnapshot'))
    .handler(a.handler.function(route))
    .authorization((allow) => [allow.authenticated()]),
```

> Note: `waypoints: a.json()` mirrors `Report.activities` / `Conversation.unreadByJson`. The flat→nested boundary coercion is a documented deploy-pendency.

---

### Task 1.3: Register `route` in `backend.ts`

**Files:**
- Modify: `swi-backend/amplify/backend.ts:5` (import) and `:10` (`defineBackend`)

**Step 1:** Add import after `import { weather } from './functions/weather/resource';`:

```ts
import { route } from './functions/route/resource';
```

**Step 2:** Change line 10:

```ts
const backend = defineBackend({ auth, data, storage, weather, route });
```

---

### Task 1.4: Verify backend typechecks, then commit Unit 1

**Step 1: Run**

`cd swi-backend && npx tsc --noEmit -p amplify`
Expected: **exit 0**, no output. (If `process` errors with TS2580, confirm `@types/node` is in `swi-backend/package.json` devDeps — it was added in the Clima slice.)

**Step 2: Commit**

```bash
cd "C:\Users\Gabriel\Documents\SWI-mobile"
git add swi-backend/amplify/functions/route swi-backend/amplify/data/resource.ts swi-backend/amplify/backend.ts
git commit -m "feat(evacuacao): route Lambda + getEvacuationRoute custom query (deploy-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Two-gate after this unit:** dispatch a spec-review + a code-quality-review subagent before moving on.

---

## Unit 2 — Service layer (`mobile/services/evacuation/`) — TDD

Mirrors `services/weather`. Pure helpers and mock are TDD.

### Task 2.1: Add `EVACUATION_SCENARIO` dev flag

**Files:**
- Modify: `mobile/lib/featureFlags.ts` (append after the `WEATHER_SCENARIO` block, line ~59)

**Step 1: Append**

```ts
// Dev-only: exercita os estados da fatia Evacuação no mock. 'normal' (default)
// traz a rota canned; 'loading' nunca resolve; 'error' rejeita.
export type EvacuationScenario = 'normal' | 'loading' | 'error';
export const EVACUATION_SCENARIO: EvacuationScenario = 'normal';
```

**Step 2: Verify types** — `cd mobile && npx tsc --noEmit` → 0 new errors.

---

### Task 2.2: Create `types.ts`

**Files:**
- Create: `mobile/services/evacuation/types.ts`

**Step 1: Write it**

```ts
// Local mirror do shape devolvido pela custom query getEvacuationRoute do swi-backend.
// Siblings isolados → NÃO importamos o Schema; após deploy, `ampx generate` pode
// substituir. Mirrors services/<domínio>/types.ts. Datas ISO.

export interface RouteSnapshot {
  waypoints: [number, number][];   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number;
  distanceM: number;
  fetchedAt: string;               // ISO datetime
}

export interface EvacuationBackend {
  // sem args: usa as constantes SITE_ROUTE (rota fixa do site).
  getRoute(): Promise<RouteSnapshot>;
}

// Rota fixa do site (piloto SP) — origem (local da obra) + destino (ponto de
// encontro designado), ambos [lng, lat]. Movido de lib/mapMockData.ts (onde eram
// EVACUATION_ORIGIN / EVACUATION_DESTINATION). Fonte da verdade de "de onde até
// onde" pra evacuação.
export const SITE_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
};
```

---

### Task 2.3: `routeFormat.ts` (pure helpers) — TDD

**Files:**
- Create: `mobile/services/evacuation/routeFormat.test.ts`
- Create: `mobile/services/evacuation/routeFormat.ts`

**Step 1: Write the failing test** (`routeFormat.test.ts`)

```ts
import { chipAnchors, navArrow, lineFeature, bearingDeg, straightLine } from './routeFormat';

type Pt = [number, number];
const line: Pt[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];

describe('routeFormat — chipAnchors', () => {
  it('ancora em ~35% e ~70% do array', () => {
    expect(chipAnchors(line)).toEqual({ a: [1, 0], b: [3, 0] }); // floor(5*0.35)=1, floor(5*0.7)=3
  });
  it('null pra array vazio', () => {
    expect(chipAnchors([])).toBeNull();
  });
  it('clampa em 1 waypoint sem crashar', () => {
    expect(chipAnchors([[9, 9]])).toEqual({ a: [9, 9], b: [9, 9] });
  });
});

describe('routeFormat — navArrow', () => {
  it('posiciona a ~30% apontando pro próximo waypoint (leste = 90°)', () => {
    const arrow = navArrow(line); // floor(5*0.3)=1 → at=[1,0], next=[2,0]
    expect(arrow?.at).toEqual([1, 0]);
    expect(arrow?.rotation).toBeCloseTo(90);
  });
  it('null quando <2 waypoints', () => {
    expect(navArrow([[0, 0]])).toBeNull();
    expect(navArrow([])).toBeNull();
  });
});

describe('routeFormat — lineFeature', () => {
  it('embrulha os waypoints num Feature<LineString>', () => {
    expect(lineFeature(line)?.geometry).toEqual({ type: 'LineString', coordinates: line });
  });
  it('null pra array vazio', () => {
    expect(lineFeature([])).toBeNull();
  });
});

describe('routeFormat — bearingDeg', () => {
  it('norte/leste/sul/oeste', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0);    // norte
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90);   // leste
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180); // sul
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270); // oeste
  });
});

describe('routeFormat — straightLine (fallback)', () => {
  it('gera n pontos reto origem→destino', () => {
    const pts = straightLine([0, 0], [4, 0], 5);
    expect(pts).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  });
});
```

**Step 2: Run → expect FAIL** (module not found)

`cd mobile && npx jest services/evacuation/routeFormat`
Expected: FAIL ("Cannot find module './routeFormat'").

**Step 3: Implement `routeFormat.ts`**

```ts
// Lógica PURA de geometria da rota de evacuação (âncoras das chips, seta de
// navegação, feature da linha, fallback reto). Sem efeitos. Espelha o estilo de
// weatherFormat.ts. Lifted das telas evacuation.tsx / evacuation-ongoing.tsx
// (DRY entre idle + ongoing).
import type { Feature, LineString } from 'geojson';

type Pt = [number, number];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Índices a 35% / 70% do array (onde as 2 time chips ancoram).
export function chipAnchors(waypoints: Pt[]): { a: Pt; b: Pt } | null {
  if (waypoints.length === 0) return null;
  const i1 = clamp(Math.floor(waypoints.length * 0.35), 0, waypoints.length - 1);
  const i2 = clamp(Math.floor(waypoints.length * 0.7), 0, waypoints.length - 1);
  return { a: waypoints[i1], b: waypoints[i2] };
}

// Seta de navegação a ~30% da rota, rotacionada pro próximo waypoint.
export function navArrow(waypoints: Pt[]): { at: Pt; rotation: number } | null {
  if (waypoints.length < 2) return null;
  const idx = clamp(Math.floor(waypoints.length * 0.3), 0, waypoints.length - 2);
  const at = waypoints[idx];
  const next = waypoints[idx + 1] ?? waypoints[idx];
  return { at, rotation: bearingDeg(at, next) };
}

export function lineFeature(waypoints: Pt[]): Feature<LineString> | null {
  if (waypoints.length === 0) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: waypoints } };
}

// Bearing bússola em graus de `a` pra `b`. Aproximação plana (erro desprezível na
// escala urbana ~1.5km). SVG aponta pra CIMA em rotation 0 (norte).
export function bearingDeg(a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angleEastFromX = (Math.atan2(dy, dx) * 180) / Math.PI;
  let deg = 90 - angleEastFromX;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

// Fallback reto origem→destino (n pontos) — usado quando a rota real falha, pra o
// mapa nunca renderizar vazio/quebrado. Porta do antigo fallback do osrm.ts.
export function straightLine(origin: Pt, destination: Pt, n = 5): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push([origin[0] + (destination[0] - origin[0]) * t, origin[1] + (destination[1] - origin[1]) * t]);
  }
  return pts;
}
```

**Step 4: Run → expect PASS**

`cd mobile && npx jest services/evacuation/routeFormat`
Expected: PASS (all describe blocks green).

---

### Task 2.4: `mockEvacuationBackend.ts` + test — TDD

**Files:**
- Create: `mobile/services/evacuation/mockEvacuationBackend.test.ts`
- Create: `mobile/services/evacuation/mockEvacuationBackend.ts`

**Step 1: Write the failing test**

```ts
jest.mock('../../lib/featureFlags', () => ({ EVACUATION_SCENARIO: 'normal' }));
import { mockEvacuationBackend } from './mockEvacuationBackend';
import { SITE_ROUTE } from './types';

describe('mockEvacuationBackend (scenario=normal)', () => {
  it('devolve a rota canned começando na origem e terminando no destino do site', async () => {
    const r = await mockEvacuationBackend.getRoute();
    expect(r.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(r.waypoints[0]).toEqual(SITE_ROUTE.origin);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual(SITE_ROUTE.destination);
    expect(r.durationSec).toBeGreaterThan(0);
    expect(r.distanceM).toBeGreaterThan(0);
  });
});
```

**Step 2: Run → expect FAIL** (`cd mobile && npx jest services/evacuation/mockEvacuationBackend`).

**Step 3: Implement `mockEvacuationBackend.ts`**

```ts
import type { EvacuationBackend, RouteSnapshot } from './types';
import { SITE_ROUTE } from './types';
import { EVACUATION_SCENARIO } from '../../lib/featureFlags';

// Backend demo in-memory pra fatia Evacuação. Rota canned (polyline curva crível
// entre origem e destino do site) batendo os ~6/17min do Figma. Determinística
// (sem rede). O cenário (flag EVACUATION_SCENARIO) exercita normal/loading/error.
const BASE = '2026-06-24T12:00:00.000Z';

// [lng, lat]. Começa em SITE_ROUTE.origin, termina em SITE_ROUTE.destination, com
// pontos intermediários que arqueiam (curva visível no grid urbano vs reta).
const CANNED_WAYPOINTS: [number, number][] = [
  SITE_ROUTE.origin,
  [-46.6295, -23.5505],
  [-46.627, -23.549],
  [-46.6242, -23.5472],
  SITE_ROUTE.destination,
];

function snapshot(): RouteSnapshot {
  return {
    waypoints: CANNED_WAYPOINTS,
    durationSec: 1380, // ~23 min (6 + 17 do Figma)
    distanceM: 1500,
    fetchedAt: BASE,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<RouteSnapshot>(() => {}); // 'loading' nunca resolve

export const mockEvacuationBackend: EvacuationBackend = {
  async getRoute() {
    if (EVACUATION_SCENARIO === 'loading') return never();
    await tick();
    if (EVACUATION_SCENARIO === 'error') throw new Error('mock evacuation error');
    return snapshot();
  },
};
```

**Step 4: Run → expect PASS.**

---

### Task 2.5: `amplifyEvacuationBackend.ts` (deploy-gated stub)

**Files:**
- Create: `mobile/services/evacuation/amplifyEvacuationBackend.ts`

**Step 1: Write it** (mirrors `amplifyWeatherBackend.ts`)

```ts
import { generateClient } from 'aws-amplify/data';
import type { EvacuationBackend, RouteSnapshot } from './types';
import { SITE_ROUTE } from './types';

const client = generateClient();
const NOT_READY = (op: string) => new Error(`amplifyEvacuationBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyEvacuationBackend: EvacuationBackend = {
  async getRoute(): Promise<RouteSnapshot> {
    // Deploy: const { data } = await client.queries.getEvacuationRoute({
    //   originLng: SITE_ROUTE.origin[0], originLat: SITE_ROUTE.origin[1],
    //   destLng: SITE_ROUTE.destination[0], destLat: SITE_ROUTE.destination[1],
    // }); → coage data.waypoints (json) → [number,number][].
    void client; void SITE_ROUTE;
    throw NOT_READY('getRoute');
  },
};
```

---

### Task 2.6: `getEvacuationBackend.ts` (flag selector) + test

**Files:**
- Create: `mobile/services/evacuation/getEvacuationBackend.test.ts`
- Create: `mobile/services/evacuation/getEvacuationBackend.ts`

**Step 1: Write the failing test**

```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock', EVACUATION_SCENARIO: 'normal' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getEvacuationBackend } from './getEvacuationBackend';
import { mockEvacuationBackend } from './mockEvacuationBackend';

describe('getEvacuationBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
});
```

**Step 2: Run → expect FAIL.**

**Step 3: Implement `getEvacuationBackend.ts`**

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { EvacuationBackend } from './types';
import { mockEvacuationBackend } from './mockEvacuationBackend';
import { amplifyEvacuationBackend } from './amplifyEvacuationBackend';

export function getEvacuationBackend(): EvacuationBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyEvacuationBackend : mockEvacuationBackend;
}
```

**Step 4: Run → expect PASS.**

---

### Task 2.7: `EvacuationProvider.tsx` (lazy, dedupe)

**Files:**
- Create: `mobile/services/evacuation/EvacuationProvider.tsx`

**Step 1: Write it.** Mirrors `WeatherProvider` (`.then(ok,err)`, no `.finally`) but is **lazy**: no auto-fetch on mount; `load()` triggers the first fetch and dedupes via refs.

```tsx
import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { RouteSnapshot } from './types';
import { getEvacuationBackend } from './getEvacuationBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface EvacuationContextValue {
  loadStatus: LoadStatus;
  route: RouteSnapshot | null;
  load: () => Promise<void>;   // lazy: busca só na 1ª chamada (telas chamam no mount)
  reload: () => Promise<void>; // força refetch
}

const EvacuationContext = createContext<EvacuationContextValue | null>(null);

export function EvacuationProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getEvacuationBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [route, setRoute] = useState<RouteSnapshot | null>(null);
  const started = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(() => {
    started.current = true;
    setLoadStatus('loading');
    const p = backend.getRoute().then(
      (r) => { setRoute(r); setLoadStatus('ready'); },
      () => { setLoadStatus('error'); }, // .then(ok,err), NÃO .finally (lição do Chat)
    );
    inFlight.current = p;
    return p;
  }, [backend]);

  // Lazy + dedupe: 1º load() dispara o fetch; chamadas seguintes reusam a promise
  // em voo (ou no-op se já carregou). Evacuação é tela rara → sem fetch no boot.
  const load = useCallback(() => {
    if (started.current) return inFlight.current ?? Promise.resolve();
    return reload();
  }, [reload]);

  const value = useMemo<EvacuationContextValue>(
    () => ({ loadStatus, route, load, reload }),
    [loadStatus, route, load, reload],
  );
  return <EvacuationContext.Provider value={value}>{children}</EvacuationContext.Provider>;
}

export function useEvacuation(): EvacuationContextValue {
  const ctx = useContext(EvacuationContext);
  if (!ctx) throw new Error('useEvacuation must be used inside EvacuationProvider');
  return ctx;
}
```

---

### Task 2.8: Verify Unit 2 + commit

**Step 1: Run all service tests**

`cd mobile && npx jest services/evacuation`
Expected: PASS (routeFormat + mock + getBackend — 3 suites).

**Step 2: Types**

`cd mobile && npx tsc --noEmit`
Expected: 8 baseline errors, **0 new**.

**Step 3: Commit**

```bash
cd "C:\Users\Gabriel\Documents\SWI-mobile"
git add mobile/lib/featureFlags.ts mobile/services/evacuation
git commit -m "feat(evacuacao): services/evacuation (routeFormat puro + mock/amplify + provider lazy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Two-gate after this unit:** spec-review + code-quality-review subagents.

---

## Unit 3 — Wiring (`mobile/app/`)

Repoint the two screens through the seam; delete the old client-side OSRM path.

### Task 3.1: Mount `EvacuationProvider` at `(app)/_layout.tsx`

**Files:**
- Modify: `mobile/app/(app)/_layout.tsx`

**Step 1:** Add import after the `JourneyProvider` import:

```tsx
import { EvacuationProvider } from '../../services/evacuation/EvacuationProvider';
```

**Step 2:** Nest it inside `JourneyProvider` (lazy → mounting is cheap; no fetch until a screen calls `load()`):

```tsx
  return (
    <JourneyProvider>
      <EvacuationProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      </EvacuationProvider>
    </JourneyProvider>
  );
```

**Step 3: Verify** `cd mobile && npx tsc --noEmit` → 0 new.

---

### Task 3.2: Rewire `evacuation.tsx` (idle)

**Files:**
- Modify: `mobile/app/(app)/evacuation.tsx`

**Step 1: Swap imports.** Remove:
```tsx
import { EVACUATION_DESTINATION, EVACUATION_ORIGIN } from '@/lib/mapMockData';
import { getEvacuationRoute } from '@/lib/evacuationRouteCache';
```
Add:
```tsx
import { SITE_ROUTE } from '@/services/evacuation/types';
import { useEvacuation } from '@/services/evacuation/EvacuationProvider';
import { chipAnchors, lineFeature, straightLine } from '@/services/evacuation/routeFormat';
```

**Step 2: Replace the data block** (current `useState`/`useEffect`/`lineShape`/`chipAnchors` `useMemo`s, ~lines 61–89) with:

```tsx
  const { route, loadStatus, load } = useEvacuation();

  useEffect(() => { load(); }, [load]);

  // ready → rota real; error → fallback reto (mapa nunca renderiza vazio);
  // loading/idle → null (só pinos, sem linha desenhada ainda).
  const waypoints = useMemo<[number, number][] | null>(() => {
    if (route) return route.waypoints;
    if (loadStatus === 'error') return straightLine(SITE_ROUTE.origin, SITE_ROUTE.destination);
    return null;
  }, [route, loadStatus]);

  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);
```

**Step 3: Update references in JSX:**
- `<MapView center={EVACUATION_ORIGIN} …>` → `center={SITE_ROUTE.origin}`
- origin marker `coordinate={EVACUATION_ORIGIN}` → `coordinate={SITE_ROUTE.origin}`
- destination marker `coordinate={EVACUATION_DESTINATION}` → `coordinate={SITE_ROUTE.destination}`
- the two chip markers: `chipAnchors.a/.b` → `anchors.a/.b` (and keep the `anchors &&` guard — already conditional).
- Delete the stale `// OSRM resilience: getEvacuationRoute() …` comment block (lines ~41–42).

**Step 4: Verify** `cd mobile && npx tsc --noEmit` → 0 new. (Keep only the still-used `react` hooks — `useState` is now unused; remove it from the `react` import to avoid a TS6133 unused error.)

---

### Task 3.3: Rewire `evacuation-ongoing.tsx` (navigating)

**Files:**
- Modify: `mobile/app/(app)/evacuation-ongoing.tsx`

**Step 1: Swap imports.** Remove:
```tsx
import { EVACUATION_DESTINATION, EVACUATION_ORIGIN } from '@/lib/mapMockData';
import { getEvacuationRoute } from '@/lib/evacuationRouteCache';
```
Add:
```tsx
import { SITE_ROUTE } from '@/services/evacuation/types';
import { useEvacuation } from '@/services/evacuation/EvacuationProvider';
import { chipAnchors, lineFeature, navArrow, straightLine } from '@/services/evacuation/routeFormat';
```

**Step 2: Delete the inline `bearingDeg` function** (lines ~71–78) — now provided by `routeFormat` (used internally by `navArrow`). **Keep** `NavArrowBody` (presentational SVG) and `midpoint` (camera centering).

**Step 3: Replace the data block** (`useState`/`useEffect`/`lineShape`/`navArrow`/`chipAnchors` `useMemo`s) with:

```tsx
  const { route, loadStatus, load } = useEvacuation();

  useEffect(() => { load(); }, [load]);

  const waypoints = useMemo<[number, number][] | null>(() => {
    if (route) return route.waypoints;
    if (loadStatus === 'error') return straightLine(SITE_ROUTE.origin, SITE_ROUTE.destination);
    return null;
  }, [route, loadStatus]);

  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const arrow = useMemo(() => navArrow(waypoints ?? []), [waypoints]);
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);
```

**Step 4: Update JSX references:**
- `center={midpoint(EVACUATION_ORIGIN, EVACUATION_DESTINATION)}` → `center={midpoint(SITE_ROUTE.origin, SITE_ROUTE.destination)}`
- destination marker `coordinate={EVACUATION_DESTINATION}` → `coordinate={SITE_ROUTE.destination}`
- nav-arrow marker: `navArrow.at` / `navArrow.rotation` → `arrow.at` / `arrow.rotation` (keep the `arrow &&` guard)
- chip markers: `chipAnchors.a/.b` → `anchors.a/.b`

**Step 5: Verify** `cd mobile && npx tsc --noEmit` → 0 new (remove now-unused `useState` from the `react` import if flagged).

---

### Task 3.4: Delete the old OSRM path + clean `mapMockData.ts`

**Files:**
- Delete: `mobile/lib/api/osrm.ts`
- Delete: `mobile/lib/evacuationRouteCache.ts`
- Modify: `mobile/lib/mapMockData.ts` (remove the `EVACUATION_ORIGIN`/`EVACUATION_DESTINATION` exports + the stale `fetchEvacuationRoute` comment, lines ~163–173)
- Modify: `mobile/lib/useMapLibre.ts:40` (comment references `evacuationRouteCache.ts` — update to not name a deleted file)

**Step 1: Delete the two files**

```bash
cd "C:\Users\Gabriel\Documents\SWI-mobile"
git rm mobile/lib/api/osrm.ts mobile/lib/evacuationRouteCache.ts
```

**Step 2:** In `mapMockData.ts`, remove the whole "Evacuation route" block (the `EVACUATION_ORIGIN`/`EVACUATION_DESTINATION` consts and the trailing comment about `fetchEvacuationRoute`). The `SITE_ROUTE` constant in `services/evacuation/types.ts` now owns these.

**Step 3:** In `useMapLibre.ts:40`, reword the comment (e.g. `// now mirrors the dedupe pattern in EvacuationProvider.`) — it's a comment only, no code dependency.

**Step 4: Verify nothing else imports the deleted symbols**

`cd mobile && npx tsc --noEmit`
Expected: 8 baseline, **0 new**. (A new error here means a missed importer — grep `EVACUATION_ORIGIN|evacuationRouteCache|api/osrm` and fix.)

---

### Task 3.5: Full-branch gate + commit Unit 3

**Step 1: Jest (everything)**

`cd mobile && npx jest`
Expected: all suites green (prior 96 + new evacuation suites).

**Step 2: Mobile types**

`cd mobile && npx tsc --noEmit`
Expected: 8 baseline errors, **0 new**.

**Step 3: Backend types**

`cd swi-backend && npx tsc --noEmit -p amplify`
Expected: **exit 0**.

**Step 4: Web export**

`cd mobile && npx expo export --platform web`
Expected: **exit 0** (bundles, no resolution errors from the deleted files).

**Step 5: Commit**

```bash
cd "C:\Users\Gabriel\Documents\SWI-mobile"
git add "mobile/app/(app)/_layout.tsx" "mobile/app/(app)/evacuation.tsx" "mobile/app/(app)/evacuation-ongoing.tsx" mobile/lib/mapMockData.ts mobile/lib/useMapLibre.ts
git commit -m "feat(evacuacao): wire evacuation screens to services/evacuation; delete client-side OSRM

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Two-gate after this unit:** spec-review + code-quality-review subagents.

---

## Holistic review + finish

1. **Holistic review** — dispatch `superpowers:code-reviewer` over the full branch diff (`git diff feat/mobile-login...feat/backend-evacuacao`) against the design doc. Fix findings + re-verify the full-branch gate.
2. **Finishing the branch** — use `superpowers:finishing-a-development-branch`. **Merge to `feat/mobile-login` ONLY with explicit user OK** (FF, per project rule). Then update `docs/plans/2026-06-22-swi-backend-roadmap-design.md` (mark fatia 6 implemented/merged) + the `project_swi_aws_backend` memory.

## Definition of done

- [ ] `route` Lambda + `getEvacuationRoute` custom query (no model); `tsc -p amplify` exit 0.
- [ ] `services/evacuation/*` complete; service jest suites green.
- [ ] Both screens consume `useEvacuation()` with loading/error states; visuals unchanged (chips static).
- [ ] `lib/api/osrm.ts` + `lib/evacuationRouteCache.ts` deleted; no dangling imports.
- [ ] Full-branch gate green (jest all, mobile tsc 0 new, backend tsc exit 0, expo export exit 0).
- [ ] Holistic review clean; merged only with explicit OK.
