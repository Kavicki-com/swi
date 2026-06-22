# Mobile Architecture Review — 2026-05-15

Codebase: `SWI-mobile/mobile/` | React Native 0.81.5 + Expo Router 6 | DS `@kavicki/swi-design-system@v0.1.44` (github pinned)

---

## 1. Route Group Layout

### Layout file inventory

| File | Stack options | Notes |
|---|---|---|
| `app/_layout.tsx` | `headerShown: false` | Root: SafeAreaProvider > SwiThemeProvider > AuthProvider > Stack. Declares 4 modal screens. |
| `app/(auth)/_layout.tsx` | `headerShown: false` | Bare Stack passthrough |
| `app/(auth)/complimentary-data/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(auth)/password-recovery/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(onboarding)/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(onboarding)/smartband/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(app)/_layout.tsx` | `headerShown: false` | Bare passthrough — no auth guard |
| `app/(app)/journey/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(app)/reports/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(app)/chat/_layout.tsx` | `headerShown: false` | Bare passthrough |
| `app/(app)/settings/_layout.tsx` | `headerShown: false` | Bare passthrough |

### Findings

- **All 11 layout files are structurally identical.** Each renders a single-line `<Stack screenOptions={{ headerShown: false }} />` with zero per-group customization. This is internally consistent but means group boundaries provide no behavioral differentiation — no gesture config, no per-group transition overrides, no shared header components.
- **Modal stack convention.** The root `_layout.tsx` declares four named modal screens:
  - `modals/support-form` — `presentation: modal` (full-sheet iOS card)
  - `modals/privacy-policy` — `presentation: modal` (full-sheet iOS card)
  - `modals/weather-alert` — `presentation: transparentModal`
  - `modals/responsables` — `presentation: modal` (full-sheet iOS card)
- **Mismatch with actual in-use files.** The two routes that carry real implementations — `(app)/settings/support.tsx` and `(app)/settings/privacy.tsx` — both self-declare `presentation: transparentModal` via an inline `<Stack.Screen options={...}>` inside the component body. They open as transparent bottom-sheets from inside the `(app)` group, not from the root modals stack. The `app/modals/` counterparts are stubs that are only called from pre-auth screens (see Section 2).
- **`(app)/_layout.tsx` has no auth guard.** Any route inside `(app)/` is reachable without a valid session (see Section 3).
---

## 2. Modal Duplications

### The six files

**Pair A — Support form (Figma 348:10426)**

| File | Implementation | Callers |
|---|---|---|
| `app/modals/support-form.tsx` | Placeholder — Title + two Text nodes, no form fields | `(auth)/login.tsx:99` via `router.push("/modals/support-form")` |
| `app/(app)/settings/support.tsx` | Full — Combobox + 2 Input + Button, transparent bottom-sheet with backdrop | `(app)/settings/index.tsx:86` via `go("/(app)/settings/support")` |

**Pair B — Privacy policy (Figma 348:10434)**

| File | Implementation | Callers |
|---|---|---|
| `app/modals/privacy-policy.tsx` | Placeholder — Title + two Text nodes, no policy content | `(auth)/sign-up.tsx:165` via `router.push("/modals/privacy-policy")` |
| `app/(app)/settings/privacy.tsx` | Full — 1 000-word POLICY string in ScrollView, transparent bottom-sheet with backdrop | `(app)/settings/index.tsx:93` via `go("/(app)/settings/privacy")` |

**Pair C — Responsibles picker (Figma 364:18017)**

| File | Implementation | Callers |
|---|---|---|
| `app/modals/responsables.tsx` | Placeholder — Title + two Text nodes, no picker | No callers anywhere in `app/**/*.tsx` |
| `app/(app)/reports/responsibles.tsx` | Full — SearchInput + avatar list + Checkbox multi-select + Cancelar/Continuar buttons | `(app)/reports/new.tsx:107` via `router.push("/(app)/reports/responsibles")` |

### Recommendation: delete all three placeholder modals

The three files in `app/modals/` are stubs scaffolded early and never upgraded. Their canonical Figma implementations live under `(app)/settings/` and `(app)/reports/`.

**Wiring impact:**

1. **`app/modals/support-form.tsx`** — Only caller is `(auth)/login.tsx:99`. Cannot be re-pointed to `/(app)/settings/support` because that route is inside the authenticated zone. Resolution: implement the real bottom-sheet directly in `app/modals/support-form.tsx` (mirroring or sharing logic from `settings/support.tsx`), OR extract the bottom-sheet into a shared component used by both. Do not simply redirect login to the authenticated route.

2. **`app/modals/privacy-policy.tsx`** — Only caller is `(auth)/sign-up.tsx:165`. Same cross-boundary constraint. Privacy policy is legitimately needed pre-auth during sign-up agreement. Resolution: implement real POLICY content in the modal file (or extract a shared PrivacyPolicySheet component).

3. **`app/modals/responsables.tsx`** — Zero callers. Safe to delete unconditionally. Also remove the `Stack.Screen name="modals/responsables"` declaration from `app/_layout.tsx:63`.

**Spelling note:** The modal file uses `responsables` (Spanish/ES spelling); the route uses `responsibles` (English). The route name is correct. This confirms the placeholder was named before the canonical route was established.
---

## 3. Routing Entry and Auth Gate

### Cold start path

```
app/index.tsx
  -> <Redirect href="/login" />   (unconditional — no auth check)
  -> (auth)/login.tsx
```

`app/index.tsx` has a single line: `<Redirect href="/login" />`. There is no inspection of auth state before redirecting. An already-authenticated user (once persistence is added) is always sent to login on every cold start.

### AuthProvider analysis

`services/auth/AuthProvider.tsx`:

- Stores `user: User | null` in `useState` — **ephemeral, in-memory only**. Every app restart resets user to null.
- `signIn(email)` sets a synthetic User object from the email string. No token, no server round-trip.
- `signOut()` sets user to null.
- No persistence layer — no AsyncStorage, no SecureStore, no JWT management.

**There is no auth guard anywhere.** The `(app)/_layout.tsx` does not call `useAuth()`. Any route inside `(app)/` is directly reachable via `router.push` or deep link without a session.

**Sign-out bug:** `(app)/settings/index.tsx:118` calls `router.replace("/(auth)/login")` without calling `signOut()`. The AuthContext `user` stays non-null in memory after the user navigates away. When AuthProvider gains persistence this will become a genuine session leak.

### Cold start behavior matrix

| Scenario | Behavior | Issue |
|---|---|---|
| Unauthenticated, fresh open | index -> /login -> handleLogin -> router.replace("/(app)/dashboard") | None for demo |
| Session active (app not killed) | Navigation works normally | None |
| App killed and reopened | index -> /login (state lost due to useState) | Acceptable for demo; not production-ready |
| Deep link to /(app)/dashboard | Dashboard opens with no login | Auth bypass — demo only; CRITICAL for production |
---

## 4. Font Setup

### Weights loaded in `app/_layout.tsx`

| Alias key | Font asset | Actual weight |
|---|---|---|
| `Inter` | Inter_400Regular | 400 Regular |
| `Inter-Medium` | Inter_500Medium | 500 Medium |
| `Inter-Bold` | Inter_700Bold | 700 Bold |
| `Montserrat` | Montserrat_700Bold | 700 Bold |
| `Montserrat-Regular` | Montserrat_400Regular | 400 Regular |
| `Montserrat-Medium` | Montserrat_500Medium | 500 Medium |

### DS token mapping

Per comment in `app/_layout.tsx`:
- `theme.fontFamily.body` resolves to `"Inter"` which maps to Inter_400Regular. Dominant DS body/subtitle/caption usage is Regular.
- `theme.fontFamily.title` resolves to `"Montserrat"` which maps to Montserrat_700Bold. DS uses Montserrat exclusively for titles and button labels at weight 700.

### Gaps and risks

- **Weight-aware bridging does not exist in React Native.** When a component emits `fontFamily: "Inter"` with `fontWeight: "700"`, RN does not automatically resolve this to the `Inter-Bold` alias. It either renders the 400 variant or applies synthetic bold (different rendering on Android). The weight aliases are registered but only useful if components explicitly reference them by alias name. The DS itself likely only emits `theme.fontFamily.body` (= `"Inter"`), so any bold body text rendered via fontWeight alone will be synthetic on Android.
- **Splash has no timeout or error recovery.** If font download stalls (offline first launch), `fontsLoaded` remains false, `SplashScreen.hideAsync()` is never called, and the app is indefinitely stuck on the splash screen. No timeout guard, no error branch.
- **`settings/privacy.tsx` passes `theme.fontWeight.regular` as the `fontWeight` prop on an `RNText` with `fontFamily: theme.fontFamily.body`.** On Android with custom fonts, `fontWeight` as a string requires the weight-specific alias to be registered under that exact name. Since no alias exists for automatic weight lookup, this will silently render at 400 regardless of the fontWeight value.
- **`@react-three/fiber` + `three` + `expo-gl` are in `dependencies`.** No usage was found in any `app/**/*.tsx` during this audit. If genuinely unused these inflate the JS bundle by several MB (three.js is 600KB+ minified). Verify before any production build and remove if unused.
---

## 5. Type-Check Baseline

Command: `npx tsc --noEmit` in `mobile/`

**3 pre-existing errors. Not fixed; enumerated only.**

| # | File:Line | Error | Diagnosis |
|---|---|---|---|
| 1 | `app/(app)/dashboard.tsx:400` | TS2322: `"title.l"` not assignable to `TextVariant` | DS `Title` component does not expose the `"title.l"` variant. Either the DS removed it in a recent version bump or the name is wrong. Caller must switch to a valid variant (e.g. `"title.m"` or `"title.xl"`). Renders incorrectly at runtime. |
| 2 | `app/(app)/my-stats.tsx:79` | TS2769: `pointerEvents` does not exist on `ImageProps` | `pointerEvents` is passed directly to RN `<Image>`. The correct pattern — used in `settings/index.tsx` and `map.tsx` — is to wrap in `<View pointerEvents="none">`. |
| 3 | `app/(app)/reports/responsibles.tsx:126` | TS2322: `"xl"` not assignable to `AvatarSize` | DS `Avatar` does not accept `size="xl"`. Must downgrade to the largest supported size value (likely `"l"`). Avatar renders at wrong size at runtime. |

No cascading errors; all three are isolated, self-contained type mismatches.
---

## 6. Compose-Local Debt

| File:Line | Comment | Deferred work |
|---|---|---|
| `app/(app)/notifications.tsx:7` | `compose-local (DS HorizontalCard sem description)` | 12 notification cards built from raw `Pressable + RNText` because DS `HorizontalCard` has no description sub-line slot. Migrate when DS adds that variant. |
| `app/(app)/journey/index.tsx:146` | `Task cards — compose local porque DS HorizontalCard so tem...` | Task list items are locally composed for the same reason — DS `HorizontalCard` lacks a multi-line / status-icon variant needed for journey tasks. |

Only two confirmed compose-local markers in the codebase. Both share the same root cause: DS `HorizontalCard` missing a description or multi-line variant.

---

## 7. Suspect Hardcoding

Six files spot-checked: `dashboard.tsx`, `map.tsx`, `(onboarding)/smartband/connection.tsx`, `(app)/settings/index.tsx`, `(app)/notifications.tsx`, `(auth)/sign-up.tsx`. Additional files surfaced by grep.

### Hardcoded color hex strings

| File:Line | Value | Assessment |
|---|---|---|
| `app/+not-found.tsx:12` | `color="#62bb81"` on Text | Should be `theme.content.primary` — #62BB81 is the DS green. Only file using raw hex for a DS semantic color. |
| `app/(app)/dashboard.tsx:104-105, 424-426` | SVG LinearGradient stops (#3BC958, #1E652C, #171717, #62BB81) | Inside raw SVG — DS has no gradient token API. Acceptable; Figma source documented in comment. |
| `app/(app)/notifications.tsx:108` | `shadowColor: "#1D1D1D"` | Should reference `theme.content.dark` or a dedicated shadow token. |
| `app/(app)/evacuation.tsx:136` | `shadowColor: "#1D1D1D"` | Same as above. |
| `app/(app)/map-weather.tsx:43` | `shadowColor: "#1D1D1D"` | Same — at least 4 files share this copy-pasted shadow constant. |
| `app/(app)/map.tsx:23` | `shadowColor: "#1D1D1D"` | Same. |

### Hardcoded padding and margin numbers

| File:Line | Value | Assessment |
|---|---|---|
| `app/(auth)/sign-up.tsx:70` | `paddingBottom: 48` | Should be `theme.padding.xxl` or equivalent. |
| `app/(onboarding)/smartband/connection.tsx:23, 74` | `paddingHorizontal: 16` | Should be `theme.padding.m`. Repeated twice in same file. |
| `app/(onboarding)/smartband/complete.tsx:24` | `paddingHorizontal: 16` | Same. |
| `app/(onboarding)/smartband/pairing.tsx:51` | `paddingHorizontal: 16` | Same — all three smartband screens share this raw value. |
| `app/(app)/settings/index.tsx:122-123` | `paddingHorizontal: 12`, `paddingVertical: 8` | Should be `theme.padding.sm` and `theme.padding.s`. |
| `app/(app)/chat/inbox.tsx:103`, `chat/[userId].tsx:142` | `paddingTop: 16` | Should be `theme.padding.m`. |
| `app/(app)/map.tsx:79-80, 116-117` | `paddingHorizontal: 6`, `paddingVertical: 2` | Sub-token micro-padding; DS may have no xxs equivalent. Acceptable if documented. |

### Hardcoded fontFamily strings

**None found.** All `fontFamily` references in the codebase go through `theme.fontFamily.body` or `theme.fontFamily.title`. Clean.
---

## 8. Navigation Graph Integrity

### Full target inventory (callers exist)

| Nav target | Resolving file | Status |
|---|---|---|
| `/login` | `app/(auth)/login.tsx` | OK |
| `/(auth)/sign-up` | `app/(auth)/sign-up.tsx` | OK |
| `/(auth)/password-recovery/email` | `app/(auth)/password-recovery/email.tsx` | OK |
| `/(auth)/password-recovery/new-password` | `app/(auth)/password-recovery/new-password.tsx` | OK |
| `/(auth)/email-sent` (params) | `app/(auth)/email-sent.tsx` | OK |
| `/(auth)/account-confirmation` (params) | `app/(auth)/account-confirmation.tsx` | OK |
| `/(auth)/complimentary-data/step-1` (params) | `app/(auth)/complimentary-data/step-1.tsx` | OK |
| `/(auth)/complimentary-data/step-2` (params) | `app/(auth)/complimentary-data/step-2.tsx` | OK |
| `/(auth)/complimentary-data/step-3` (params) | `app/(auth)/complimentary-data/step-3.tsx` | OK |
| `/(onboarding)/smartband/connection` | `app/(onboarding)/smartband/connection.tsx` | OK |
| `/(onboarding)/smartband/pairing` | `app/(onboarding)/smartband/pairing.tsx` | OK |
| `/(onboarding)/smartband/complete` | `app/(onboarding)/smartband/complete.tsx` | OK |
| `/(app)/dashboard` | `app/(app)/dashboard.tsx` | OK |
| `/(app)/my-stats` | `app/(app)/my-stats.tsx` | OK |
| `/(app)/map` | `app/(app)/map.tsx` | OK |
| `/(app)/journey` | `app/(app)/journey/index.tsx` | OK (index resolves) |
| `/(app)/journey/ongoing` | `app/(app)/journey/ongoing.tsx` | OK |
| `/(app)/journey/pause` | `app/(app)/journey/pause.tsx` | OK |
| `/(app)/journey/task/[id]` (params) | `app/(app)/journey/task/[id].tsx` | OK |
| `/(app)/reports` | `app/(app)/reports/index.tsx` | OK |
| `/(app)/reports/new` | `app/(app)/reports/new.tsx` | OK |
| `/(app)/reports/[id]` (params) | `app/(app)/reports/[id].tsx` | OK |
| `/(app)/reports/responsibles` | `app/(app)/reports/responsibles.tsx` | OK |
| `/(app)/chat/inbox` | `app/(app)/chat/inbox.tsx` | OK |
| `/(app)/chat/${u.id}` (dynamic) | `app/(app)/chat/[userId].tsx` | OK |
| `/(app)/chat/user-info` | `app/(app)/chat/user-info.tsx` | OK |
| `/(app)/settings/personal-data` | `app/(app)/settings/personal-data.tsx` | OK |
| `/(app)/settings/health-data` | `app/(app)/settings/health-data.tsx` | OK |
| `/(app)/settings/change-password` | `app/(app)/settings/change-password.tsx` | OK |
| `/(app)/settings/preferences` | `app/(app)/settings/preferences.tsx` | OK |
| `/(app)/settings/support` | `app/(app)/settings/support.tsx` | OK |
| `/(app)/settings/faq` | `app/(app)/settings/faq.tsx` | OK |
| `/(app)/settings/privacy` | `app/(app)/settings/privacy.tsx` | OK |
| `/(app)/notifications` | `app/(app)/notifications.tsx` | OK |
| `/(app)/alert-instructions` | `app/(app)/alert-instructions.tsx` | OK |
| `/(app)/evacuation` | `app/(app)/evacuation.tsx` | OK |
| `/(app)/evacuation-ongoing` | `app/(app)/evacuation-ongoing.tsx` | OK |
| `/modals/support-form` | `app/modals/support-form.tsx` | OK (placeholder — see Section 2) |
| `/modals/privacy-policy` | `app/modals/privacy-policy.tsx` | OK (placeholder — see Section 2) |

### Dangling routes (registered in layout, implemented, but no callers)

- **`modals/weather-alert`** — declared in `app/_layout.tsx:62` with `presentation: transparentModal`. The file `app/modals/weather-alert.tsx` exists and is fully implemented (weather condition card + metrics + CTA to `/(app)/evacuation`). Zero `router.push` calls reference this path anywhere in `app/**/*.tsx`. The modal cannot be triggered by any current UI action.

### Orphaned files (implemented, no inbound navigation)

- **`app/(app)/map-weather.tsx`** — fully implemented (Figma 385:21840, meteorological alert pin map). No `router.push("/(app)/map-weather")` call exists anywhere. Expo Router registers it as a valid route but the app provides no path to reach it.

### Result

All 38 explicit navigation targets that have callers resolve to real files. No dangling push targets. Two unreachability issues in the opposite direction:

1. `modals/weather-alert` — registered and implemented, never pushed to.
2. `(app)/map-weather.tsx` — implemented, never navigated to.
---

## Severity Summary

### CRITICAL

- **`(app)/_layout.tsx` has no auth guard.** All authenticated routes are reachable without login via `router.push` or deep link. Must add `useAuth().user` check in `(app)/_layout.tsx` with redirect to `/login` when null before this app goes beyond demo use.

### HIGH

- **`signOut()` not called on logout.** `(app)/settings/index.tsx:118` calls `router.replace("/(auth)/login")` without calling `signOut()`. Auth state stays polluted in memory; will become a genuine session leak once AuthProvider gains persistence.
- **`app/modals/support-form.tsx` and `app/modals/privacy-policy.tsx` are stubs serving real pre-auth entry points.** Deleting them without implementing real content breaks the Login Suporte button and the sign-up privacy policy link. Fix by implementing the real content in those modal files (or extracting a shared component). Do not redirect to the authenticated-zone routes.
- **`app/index.tsx` ignores auth state.** Once AuthProvider gains persistence, the unconditional `<Redirect href="/login">` will always bounce authenticated users to login on cold start. Add a check: if `user !== null`, redirect to `/(app)/dashboard` instead.

### MEDIUM

- **`modals/weather-alert` is unreachable.** Registered in layout, fully implemented, but zero callers. Determine the intended trigger (likely a dashboard weather/alert button) and wire the push, or remove the file and layout declaration.
- **`(app)/map-weather.tsx` is an orphan.** Fully implemented screen with no inbound navigation. Wire it (e.g., from a weather control in `map.tsx`) or delete it.
- **`app/modals/responsables.tsx` placeholder is registered but uncalled.** Remove `Stack.Screen name="modals/responsables"` from `app/_layout.tsx:63` and delete the file.
- **TS error: `dashboard.tsx:400` — `"title.l"` not in DS `TextVariant`.** Component renders incorrectly at runtime; no type error surfaced to the developer at compile time in the past.
- **TS error: `reports/responsibles.tsx:126` — `size="xl"` not in `AvatarSize`.** Avatar silently renders at wrong size.
- **`shadowColor: "#1D1D1D"` copy-pasted across 4 files** (`notifications.tsx`, `evacuation.tsx`, `map-weather.tsx`, `map.tsx`). Extract to a shared constant or use `theme.content.dark` if the DS token maps to the same value.

### LOW

- **TS error: `my-stats.tsx:79` — `pointerEvents` on `<Image>`.** Minor; the correct pattern (wrapping View) is already used in other files.
- **Smartband screens (`connection.tsx`, `complete.tsx`, `pairing.tsx`) use `paddingHorizontal: 16` raw.** Should be `theme.padding.m`.
- **`+not-found.tsx:12` uses `color="#62bb81"`.** The only file using a raw hex string for a DS semantic color.
- **`(app)/settings/index.tsx` sign-out `Pressable` uses raw padding values `12` and `8`.** Should be `theme.padding.sm` / `theme.padding.s`.
- **Splash screen has no timeout or error recovery.** If font loading stalls offline, the app is stuck on the splash indefinitely.
- **`@react-three/fiber`, `three`, and `expo-gl` are in `dependencies` with no usage found in any route file.** Verify before production build; remove if unused to avoid a multi-MB bundle regression.