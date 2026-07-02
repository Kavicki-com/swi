# SWI Backend — Fatia 3: Vitais + GPS — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @superpowers:executing-plans to implement this plan task-by-task. Use @superpowers:test-driven-development for every task that has a test. Design source: `docs/plans/2026-06-22-swi-backend-vitals-gps-design.md`.

**Goal:** Add device-simulated vitals + real GPS telemetry to the SWI worker app — backend-as-code (`VitalsSample`/`LocationSample` + TTL), flag-driven mobile providers, pure batch/downsample logic, production-ready empty/loading/stale/error states — all buildable/testable without an AWS account.

**Architecture:** Repeats the Fatia 1 "Approach A" seam (flag `AUTH_BACKEND`, mock default). `VitalsProvider` (simulated, phase state machine) + `LocationProvider` (`expo-location` + fallback) + `lib/telemetry` (pure batch) + flag-driven `TelemetrySink`. Screens (my-stats, dashboard, map) render by phase. Amplify implementations are typecheck-only (deploy-gated). DS-only UI; one DS bump (neutral heart-status) with a documented no-bump fallback.

**Tech Stack:** Amplify Gen 2 (`@aws-amplify/backend`), DynamoDB TTL via CDK override; mobile `aws-amplify` v6 data client, `expo-location`; `jest-expo`.

**Constraint reminders:**
- UI 100% `@kavicki/swi-design-system` + `useTheme()`. New empty/error layouts COMPOSE DS components (allowed); never reimplement a DS primitive. Loading uses RN `ActivityIndicator` (platform primitive, already used in `step-2.tsx`).
- Siblings isolated: mobile must NOT import from `swi-backend`. Local TS mirror types; untyped `generateClient()`.
- Mock demo must keep working; amplify path flag-gated.
- **Safety:** status is `unknown` (neutral) when data is absent/stale — NEVER fake `good`.
- Commit suggestions below are NOT pre-authorization — per project rule, confirm before each commit if unsure.

---

## Phase 0 — Setup

### Task 0.1: Branch + `expo-location` dep
- `git checkout -b feat/backend-vitals-gps` (off `feat/mobile-login`).
- `cd mobile && npx expo install expo-location` (use `expo install` so the version matches Expo SDK 54).
- Verify it resolves: `cd mobile && npx tsc --noEmit` should show only the known 8 pre-existing baseline errors (dashboard/map/map-weather/my-stats×2/MapHeatmapSource×2/Smartwatch3D), nothing new.
- Commit: `chore(mobile): add expo-location`.

---

## Phase 1 — Backend schema (`swi-backend`)

### Task 1.1: Add `VitalsSample` + `LocationSample` models

**Modify:** `swi-backend/amplify/data/resource.ts` — add to the `a.schema({ ... })` object (alongside `Profile`/`HealthData`):
```ts
  VitalsSample: a
    .model({
      workerId: a.string().required(),
      recordedAt: a.datetime().required(),
      heartRate: a.integer(),
      bloodPressureSys: a.integer(),
      bloodPressureDia: a.integer(),
      oxygenation: a.float(),
      caloriesPerHour: a.integer(),
      steps: a.integer(),
      distanceKm: a.float(),
      effortPct: a.float(),
      fatiguePct: a.float(),
      fatigueEtaMin: a.integer(),
      status: a.enum(['good', 'alert', 'low']),
      expiresAt: a.integer(), // epoch seconds — DynamoDB TTL (raw-data cost cap)
    })
    .authorization((allow) => [
      allow.owner().to(['create', 'read']),
      allow.group('admin').to(['read']),
    ]),

  LocationSample: a
    .model({
      workerId: a.string().required(),
      recordedAt: a.datetime().required(),
      lat: a.float().required(),
      lng: a.float().required(),
      accuracy: a.float(),
      expiresAt: a.integer(),
    })
    .authorization((allow) => [
      allow.owner().to(['create', 'read']),
      allow.group('admin').to(['read']),
    ]),
```
Verify each `a.*` builder + `a.enum` against the installed `@aws-amplify/backend@1.23.0` types if anything fails to compile (do not invent). Then `cd swi-backend && npx tsc --noEmit -p amplify` → clean.

### Task 1.2: TTL override in `backend.ts`

**Modify:** `swi-backend/amplify/backend.ts`:
```ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({ auth, data });

// DynamoDB TTL on raw telemetry (cost mitigation). Amplify Gen 2 has no
// schema-level TTL, so set it on the underlying CFN table. Verify the exact
// accessor against the installed @aws-amplify/backend version if it errors.
const tables = backend.data.resources.cfnResources.amplifyDynamoDbTables;
for (const name of ['VitalsSample', 'LocationSample']) {
  const t = tables[name];
  if (t) t.timeToLiveAttribute = { attributeName: 'expiresAt', enabled: true };
}
```
`cd swi-backend && npx tsc --noEmit -p amplify` → clean. If the `cfnResources.amplifyDynamoDbTables` accessor differs in this version, check `node_modules/@aws-amplify/backend` types and adjust; if TTL override truly isn't expressible, keep `expiresAt` as a field and leave a `// Phase 6 deploy: enable TTL` TODO.
- Commit: `feat(backend): VitalsSample + LocationSample models + TTL override`.

---

## Phase 2 — Vitals domain (mobile)

### Task 2.1: Types + flag for the mock scenario
**Create:** `mobile/services/vitals/types.ts`
```ts
export type WorkerStatus = 'good' | 'alert' | 'low' | 'unknown';

export interface Vitals {
  heartRate: number;
  bloodPressureSys: number;
  bloodPressureDia: number;
  oxygenation: number;
  caloriesPerHour: number;
  steps: number;
  distanceKm: number;
  effortPct: number;
  fatiguePct: number;
  fatigueEtaMin: number;
}

export type VitalsPhase = 'loading' | 'ready' | 'empty' | 'stale' | 'error';

/** getCurrent resolves null to mean "no data yet" (empty). Throwing = error. */
export interface VitalsBackend {
  getCurrent(): Promise<Vitals | null>;
}
```
**Modify:** `mobile/lib/featureFlags.ts` — append a dev-only scenario switch (default `'streaming'`):
```ts
// Dev-only: lets the mock vitals backend exercise the empty/loading/stale/error
// UIs that production will hit. 'streaming' = normal simulated data.
export type VitalsScenario = 'streaming' | 'empty' | 'loading' | 'stale' | 'error';
export const VITALS_SCENARIO: VitalsScenario = 'streaming';
```
- Commit: `feat(mobile): vitals types + VITALS_SCENARIO flag`.

### Task 2.2: Pure simulator `nextVitals` (TDD)
**Test:** `mobile/services/vitals/simulator.test.ts`
```ts
import { BASELINE_VITALS, nextVitals } from './simulator';

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

it('keeps every metric within sane bounds after many steps', () => {
  let v = BASELINE_VITALS;
  const rng = seq([0, 0.25, 0.5, 0.75, 0.999]); // deterministic
  for (let i = 0; i < 500; i++) v = nextVitals(v, rng);
  expect(v.heartRate).toBeGreaterThanOrEqual(40);
  expect(v.heartRate).toBeLessThanOrEqual(140);
  expect(v.oxygenation).toBeGreaterThanOrEqual(80);
  expect(v.oxygenation).toBeLessThanOrEqual(100);
  expect(v.fatiguePct).toBeGreaterThanOrEqual(0);
  expect(v.fatiguePct).toBeLessThanOrEqual(100);
});
```
Run → FAIL. **Create:** `mobile/services/vitals/simulator.ts`
```ts
import type { Vitals } from './types';

// Baseline = the Figma my-stats values (342:9419).
export const BASELINE_VITALS: Vitals = {
  heartRate: 67, bloodPressureSys: 12, bloodPressureDia: 8, oxygenation: 92.2,
  caloriesPerHour: 145, steps: 8975, distanceKm: 4.32, effortPct: 62.5,
  fatiguePct: 74, fatigueEtaMin: 105,
};

const clampDrift = (v: number, amp: number, min: number, max: number, rng: () => number) =>
  Math.min(max, Math.max(min, v + (rng() * 2 - 1) * amp));

/** Bounded random walk. rng() returns [0,1). Pure given rng. */
export function nextVitals(prev: Vitals, rng: () => number): Vitals {
  return {
    heartRate: Math.round(clampDrift(prev.heartRate, 3, 40, 140, rng)),
    bloodPressureSys: Math.round(clampDrift(prev.bloodPressureSys, 0.3, 9, 16, rng)),
    bloodPressureDia: Math.round(clampDrift(prev.bloodPressureDia, 0.3, 5, 11, rng)),
    oxygenation: Number(clampDrift(prev.oxygenation, 0.4, 80, 100, rng).toFixed(1)),
    caloriesPerHour: Math.round(clampDrift(prev.caloriesPerHour, 5, 60, 400, rng)),
    steps: Math.round(clampDrift(prev.steps, 20, 0, 30000, rng)),
    distanceKm: Number(clampDrift(prev.distanceKm, 0.02, 0, 20, rng).toFixed(2)),
    effortPct: Number(clampDrift(prev.effortPct, 1.5, 0, 100, rng).toFixed(1)),
    fatiguePct: Number(clampDrift(prev.fatiguePct, 1, 0, 100, rng).toFixed(1)),
    fatigueEtaMin: Math.max(0, Math.round(clampDrift(prev.fatigueEtaMin, 3, 0, 480, rng))),
  };
}
```
Run → PASS. Commit: `feat(mobile): pure vitals simulator (nextVitals)`.

### Task 2.3: Pure `deriveStatus` (TDD — covers `unknown`)
**Test:** `mobile/services/vitals/deriveStatus.test.ts`
```ts
import { deriveStatus } from './deriveStatus';
import { BASELINE_VITALS } from './simulator';

it('null vitals -> unknown (never fake good)', () => {
  expect(deriveStatus(null)).toBe('unknown');
});
it('baseline -> alert (fatigue 74)', () => {
  expect(deriveStatus(BASELINE_VITALS)).toBe('alert');
});
it('low oxygenation -> low', () => {
  expect(deriveStatus({ ...BASELINE_VITALS, fatiguePct: 10, oxygenation: 88 })).toBe('low');
});
it('healthy -> good', () => {
  expect(deriveStatus({ ...BASELINE_VITALS, fatiguePct: 20, oxygenation: 98, heartRate: 70 })).toBe('good');
});
```
Run → FAIL. **Create:** `mobile/services/vitals/deriveStatus.ts`
```ts
import type { Vitals, WorkerStatus } from './types';

// SAFETY: absent/stale data is 'unknown' (neutral), never 'good'.
export function deriveStatus(vitals: Vitals | null): WorkerStatus {
  if (!vitals) return 'unknown';
  if (vitals.oxygenation < 90 || vitals.heartRate > 110 || vitals.fatiguePct >= 90) return 'low';
  if (vitals.oxygenation < 94 || vitals.heartRate > 95 || vitals.fatiguePct >= 80) return 'alert';
  return 'good';
}
```
Run → PASS. Commit: `feat(mobile): deriveStatus (unknown for no/stale data)`.

### Task 2.4: Mock + amplify backends + selector (TDD on selector)
**Create:** `mobile/services/vitals/mockVitalsBackend.ts` — advances the simulator; honors `VITALS_SCENARIO`:
```ts
import { VITALS_SCENARIO } from '../../lib/featureFlags';
import type { Vitals, VitalsBackend } from './types';
import { BASELINE_VITALS, nextVitals } from './simulator';

let current: Vitals = BASELINE_VITALS;

export const mockVitalsBackend: VitalsBackend = {
  async getCurrent() {
    if (VITALS_SCENARIO === 'empty') return null;
    if (VITALS_SCENARIO === 'error') throw new Error('mock vitals error scenario');
    if (VITALS_SCENARIO === 'loading') return new Promise(() => null as never); // never resolves
    // 'stale' is driven by the provider's freshness check; here we still emit data.
    current = nextVitals(current, Math.random);
    return current;
  },
};
```
**Create:** `mobile/services/vitals/amplifyVitalsBackend.ts` (typecheck-only):
```ts
import { generateClient } from 'aws-amplify/data';
import type { Vitals, VitalsBackend } from './types';

const client = generateClient();

export const amplifyVitalsBackend: VitalsBackend = {
  async getCurrent() {
    const { data } = await (client as any).models.VitalsSample.list({ limit: 1 });
    const s = data?.[0];
    if (!s) return null;
    return {
      heartRate: s.heartRate, bloodPressureSys: s.bloodPressureSys, bloodPressureDia: s.bloodPressureDia,
      oxygenation: s.oxygenation, caloriesPerHour: s.caloriesPerHour, steps: s.steps,
      distanceKm: s.distanceKm, effortPct: s.effortPct, fatiguePct: s.fatiguePct,
      fatigueEtaMin: s.fatigueEtaMin,
    } as Vitals;
  },
};
```
**Create:** `mobile/services/vitals/getVitalsBackend.ts` + `getVitalsBackend.test.ts` (mirror `getAuthBackend`; mock the flag + stub `aws-amplify/data`). Commit: `feat(mobile): vitals backends (mock + amplify) + selector`.

### Task 2.5: `VitalsProvider` with phase state machine (TDD)
**Create:** `mobile/services/vitals/VitalsProvider.tsx` exposing `useVitals(): { phase, vitals, status, lastUpdated, history }`.
- Mount: `phase='loading'`. Poll `backend.getCurrent()` on a **display interval** (`DISPLAY_MS = 4000`). On resolve: `null` → `phase='empty'`, status `unknown`; value → `phase='ready'`, push to `history` (cap ~20), set `lastUpdated`. On throw → `phase='error'`.
- Freshness: a separate check marks `phase='stale'` (keeping last `vitals`) when `now - lastUpdated > STALE_MS` (= 2× telemetry interval). When stale/empty/error, `status = deriveStatus(null) = 'unknown'`.
- Use injectable timers/clock so it's testable. **Test:** `VitalsProvider.test.tsx` with fake timers + a stub backend: loading→ready on first value; →empty on null; →error on throw; →stale after STALE_MS with no new value. (Use `@testing-library/react-native` if present; else test the extracted reducer — prefer extracting a pure `vitalsReducer`/`computePhase` and unit-testing THAT to avoid RN render deps.)
- **Recommended:** extract `computePhase({ lastValue, lastUpdated, now, errored })` as a pure function in `vitals/phase.ts` and unit-test it; the provider just wires timers to it. Commit: `feat(mobile): VitalsProvider + pure phase logic`.

---

## Phase 3 — Location domain

### Task 3.1: `LocationProvider` (expo-location + fallback) (TDD on fallback)
**Create:** `mobile/services/location/types.ts` (`LocationState = { coords: [number,number]; source: 'gps'|'fallback'; permission: 'granted'|'denied'|'undetermined' }`) and a pure `mobile/services/location/resolveCoords.ts`:
```ts
import { USER_LOCATION } from '../../lib/mapMockData';

/** Pure: choose GPS coords or the mock fallback. */
export function resolveCoords(gps: [number, number] | null): { coords: [number, number]; source: 'gps' | 'fallback' } {
  return gps ? { coords: gps, source: 'gps' } : { coords: USER_LOCATION, source: 'fallback' };
}
```
**Test:** `resolveCoords.test.ts` — gps present → source gps; null → USER_LOCATION fallback.
**Create:** `mobile/services/location/LocationProvider.tsx` (`useLocation()`): requests `Location.requestForegroundPermissionsAsync()`; if granted, `Location.watchPositionAsync({ accuracy: Balanced, timeInterval: 5000, distanceInterval: 10 }, cb)` updating coords via `resolveCoords([lng,lat])`; on denied/error/web-without-permission, stays on `resolveCoords(null)` (fallback). Verify `expo-location` API names against the installed version. Commit: `feat(mobile): LocationProvider (real GPS + fallback)`.

---

## Phase 4 — Telemetry (batch + sink + sampler)

### Task 4.1: Pure batch lib (TDD)
**Test+Create:** `mobile/lib/telemetry/batch.test.ts` + `batch.ts`:
```ts
export interface Stamped { recordedAt: number; }
// keep at most one sample per intervalMs window
export function downsample<T extends Stamped>(samples: T[], intervalMs: number): T[] { /* ... */ }
// true when buffer is full OR oldest item older than maxAgeMs
export function shouldFlush(bufferLen: number, oldestTs: number | null, now: number, maxSize: number, maxAgeMs: number): boolean { /* ... */ }
// avg/min/max of a numeric field over a window
export function aggregate(values: number[]): { avg: number; min: number; max: number } { /* ... */ }
```
Write tests first (deterministic inputs/`now`), then implement. Commit: `feat(mobile): pure telemetry batch lib`.

### Task 4.2: Sink (mock + amplify) + selector + sampler
**Create:** `mobile/services/telemetry/types.ts` (`TelemetrySink { uploadVitals(s); uploadLocation(s) }`), `mockTelemetrySink.ts` (push to an in-memory `log[]` exported for tests), `amplifyTelemetrySink.ts` (`client.models.VitalsSample/LocationSample.create({...})`, typecheck-only), `getTelemetrySink.ts` (flag selector) + test.
**Create:** `mobile/services/telemetry/useTelemetrySampler.ts` — a hook taking `() => Vitals|null` + `() => coords` ; on `TELEMETRY_MS` interval (default e.g. 60_000; configurable) builds a sample with `expiresAt = nowSec + TTL_SEC`, buffers, `downsample`s, and flushes to the sink. Mock sink only logs. **Test** the buffer/flush decision via the pure `shouldFlush` (already covered) + a small test asserting the mock sink received N samples over M fake-timer intervals. Commit: `feat(mobile): telemetry sink + sampler`.

---

## Phase 5 — Empty/loading/stale/error UI + DS neutral status

### Task 5.1: DS neutral heart-status — bump OR fallback (decide by repo availability)
- **Check** whether the `swi-design-system` repo is accessible on this machine (it's vendored as `mobile/vendor/...0.1.112.tgz`; the source repo may be elsewhere).
- **If accessible:** add a neutral/`unknown` condition to `HeartrateStatus`/`HeartStatus`/`StatusChart` (grey, no good/alert/low color), mirroring `LocationPin`'s existing `offline`. Build dist → produce `kavicki-swi-design-system-0.1.113.tgz` → vendor it → bump `mobile/package.json` → `npm install`. Commit as a DS bump.
- **If NOT accessible:** use the no-bump fallback (Task 6 renders the empty/stale states by hiding the heart badge + showing placeholder/`TimeStamp`), and record a `// DS bump TODO: neutral heart-status` so it's tracked. Do NOT build a local heart-status replacement (DS rule).

### Task 5.2: Reusable state views (DS composition, no new primitives)
**Create:** `mobile/components/vitals/VitalsEmptyState.tsx`, `VitalsLoadingState.tsx`, `VitalsErrorState.tsx` — page-level layouts composing DS `Title`/`Text`/`Icon`/`Button`/`SmartbandStatus`/`Toast` + RN `ActivityIndicator`. Props: `onRetry?`. No hardcoded tokens (`useTheme()` only). These ORCHESTRATE DS components (allowed), they don't replace any. (No test — pure presentational; covered by the visual smoke in Phase 7.)

---

## Phase 6 — Wire the screens (state-aware)

> After this phase `tsc` stays at the 8 pre-existing baseline errors (zero new). Mock demo (`VITALS_SCENARIO='streaming'`) behaves like today but with live-drifting numbers. Each task: read the file, apply, typecheck, commit.

### Task 6.1: Mount providers
**Modify:** `mobile/app/_layout.tsx` — wrap the Stack with `<VitalsProvider><LocationProvider>…</LocationProvider></VitalsProvider>` inside the existing providers; start `useTelemetrySampler(...)` from a small root child that reads `useVitals`/`useLocation` (sampler must be inside the providers). Commit.

### Task 6.2: `my-stats.tsx`
**Modify:** `mobile/app/(app)/my-stats.tsx` — `const { phase, vitals, status } = useVitals();`
- `phase==='loading'` → `<VitalsLoadingState/>`; `'empty'` → `<VitalsEmptyState/>`; `'error'` → `<VitalsErrorState onRetry=.../>`.
- `'ready'`/`'stale'` → render the existing layout but replace hardcoded values: `67`→`vitals.heartRate`, `12/8`→`vitals.bloodPressureSys/Dia`, the 4 donut values (`62,5%`/`92,2%`/`8975`+`4,32km`/`125`) → `effortPct`/`oxygenation`/`steps`+`distanceKm`/`caloriesPerHour`, fatigue `74`/`1h45m` → `fatiguePct`/`fatigueEtaMin` (format mins→`Xh Ym`), calories chart points → `history` (last 3). On `'stale'`: wrap the value block at reduced opacity + show a DS `TimeStamp` ("atualizado há…") and neutral status. Keep allergies/medical-history/exams as-is (out of scope).
- Numbers use `pt-BR` comma formatting where the Figma shows commas. Typecheck → clean. Commit.

### Task 6.3: `dashboard.tsx`
**Modify:** `mobile/app/(app)/dashboard.tsx` — drive the heart-status badge by `status` (neutral when `unknown` — via the DS bump condition, or hide-badge fallback), BPM by `vitals.heartRate`, fatigue bar by `vitals.fatiguePct`. loading/empty/error → the state views (or a compact inline variant). Typecheck → clean. Commit.

### Task 6.4: `map.tsx`
**Modify:** `mobile/app/(app)/map.tsx` — user pin uses `useLocation().coords` (instead of `USER_LOCATION`) and `useVitals().status` (→ `LocationPin status="offline"` when `unknown`). Center the map on the real coords. Other-worker pins (`WORKER_LOCATIONS`) + cameras + heatmap stay mock. Typecheck → clean. Commit.

---

## Phase 7 — Verify

### Task 7.1: tsc + jest + bundle
```bash
cd mobile && npx tsc --noEmit        # expect only the 8 pre-existing baseline errors
cd mobile && npx jest                # all pass (Fatia 1 + new vitals/telemetry/location tests)
cd swi-backend && npx tsc --noEmit -p amplify   # clean
cd mobile && npx expo export --platform web      # bundles OK
```

### Task 7.2: Mock-scenario visual smoke (the empty-states payoff)
- For each `VITALS_SCENARIO` value (`streaming`/`empty`/`loading`/`stale`/`error`), run `npx expo start --web`, open my-stats + dashboard, confirm the correct state UI renders (live numbers / placeholder / spinner / dimmed+timestamp / toast+retry). This is the verification that the empty states actually work — the core of the user's concern. Record which scenarios were eyeballed.

### Task 7.3: Update design doc status + commit
- Set the design doc `Status:` → implemented (mock path) + which scenarios were smoke-verified.

---

## Phase 8 — Deploy (folds into Fatia 1 Phase 6 runbook)
When the AWS account exists and the flag flips to `amplify`: the telemetry sink starts writing real `VitalsSample`/`LocationSample`; confirm the DynamoDB TTL is active on both tables; verify owner-scoped reads. Add to the Fatia 1 Phase 6 prerequisites: confirm TTL override deployed; validate the sampler cadence vs cost on a real device.

### Follow-ups surfaced by the final review (capture as tickets; none block the mock merge)
- **amplify `getCurrent` recency (deploy-blocker for the amplify path):** `amplifyVitalsBackend.getCurrent` uses `models.VitalsSample.list({ limit: 1 })`, which returns by primary key, NOT by recency — the deployed "current vitals" could be an arbitrary/old sample. Replace with a recency query (sort on `recordedAt` / a GSI) before flipping the flag.
- **DS neutral heart-status bump (deferred):** currently the hide-badge fallback (stale/unknown). Add a neutral condition to `HeartrateStatus`/`HeartStatus`/`StatusChart` in `swi-design-system` (repo at `C:/Users/Gabriel/Documents/swi-design-system`), then replace the fallback. This also removes the `StatusChart` ring's `unknown→good` decorative fallback.
- **Android background location:** `app.json` only has the iOS `whenInUse` string; if field-safety needs background GPS, add Android `ACCESS_FINE_LOCATION`/foreground-service config + the bg-location plugin option.
- **`lib/telemetry/batch.ts` `aggregate()` is dead code:** wire it into the flush (aggregate per window) or drop it until the rollup story lands.
- **`downsample` keeps earliest-per-window:** fine at 1 sample/window today; if the sampler ever ticks faster than its interval, "latest wins" is usually preferable for telemetry — revisit then.
- **`VitalsErrorState` retry is a no-op** (provider self-polls): wire a real retry or remove the button before production so it doesn't read as broken.
- **Stale "atualizado há…" label is frozen** (provider memo stops propagating once stale): acceptable, but a live counter needs a local 1s tick in my-stats if desired.

---

## Notes for the executor
- Prefer extracting pure functions (`nextVitals`, `deriveStatus`, `computePhase`, batch fns) and unit-testing those — avoids RN-render test deps and is where the real logic lives.
- `expo-location` / `aws-amplify` API names: verify against installed versions; don't guess.
- Keep `VITALS_SCENARIO='streaming'` as the committed default (the others are dev toggles).
- These docs (`2026-06-22-swi-backend-*`) are temporary — delete when the whole backend is done (user decision).
