# SWI Mobile — Next-Session Handoff (2026-05-15)

This is the action plan for the next session to bring the mobile app to 100% Figma fidelity. Read [INDEX.md](./INDEX.md) first for cross-cutting context, then the 3 per-area reports for line-level findings.

---

## Resume Instructions

```
Worktree:    C:\Users\Gabriel\Documents\SWI-mobile\mobile\
Branch:      feat/mobile-login
Remote:      synced (last push commit ef718c1)
DS:          @kavicki/swi-design-system@v0.1.44
Figma file:  bzDUuPdSiKgl5xucBH0IYE
```

**Execution profile** (per user instruction 2026-05-15): this work runs in a **parallel session**, prioritizing **precision and TOTAL Figma fidelity**. That means, for every screen touched:

1. **Pull Figma `get_design_context` first** for the node id named in the file's `// Figma X:Y` comment. Read the screenshot inline and the metadata. Do NOT proceed from memory of how the screen "should" look.
2. **Cross-check every literal** (copy text, hex color, padding number, gap number, font size) against the Figma data. If the code has a number not present in Figma, that's a fidelity bug — fix it.
3. **DS-only**: never re-implement a DS primitive. If DS lacks the prop you need, **bump the DS** (precedent: 9 bumps already done this sprint — see commit history `git log --oneline @kavicki/swi-design-system`).
4. **Icons**: if DS doesn't have it, export SVG from Figma node (via `get_design_context` asset URLs) — never PNG, never invent path data.
5. **±0px tolerance** at 360-wide reference (revised from ±4px). Use `mcp__playwright__browser_take_screenshot` of the running app and compare visually with Figma screenshot at same dimensions.
6. **Tokens**: every `gap`, `padding`, `borderRadius`, `fontSize`, `fontWeight`, `color` from `useTheme()`. No exceptions. If a token is missing in the theme, bump DS to add it.
7. **No `// TODO(demo)` shortcuts** in this pass — wire every `onPress` to a real target. If the target is genuinely future work (e.g., camera live stream), comment it as `// Phase 2: <reason>` not TODO.

**Before any edit, present Fact-Forcing Gate facts** (callers of the file, Glob uniqueness, data shape, user instruction verbatim). The session has Fact-Forcing enabled.

**Do NOT use `git clean -fd`** — a prior session deleted `docs/` files this way. Stage selectively with `git add <path>`.

**Commits**: previous session was told "não precisa commitar nada ainda" for the audit docs. Confirm with user before committing audit + before committing sprint work. Default: ask after each Sprint completes.

---

## Sprint 1 — Demo Blockers (CRITICAL, do first)

Each item lists: file, finding, acceptance criteria.

### 1.1 — `settings/faq.tsx`: Accordions have no `content` prop
- **File**: `app/(app)/settings/faq.tsx`
- **Problem**: DS `Accordion` is used without a `content` slot → expanding shows nothing
- **Acceptance**: 5 Q&A pairs render with answers when expanded. If DS `Accordion` doesn't accept `content`, bump DS to add the prop (consistent with prior bumps).

### 1.2 — Wire all 12 notifications
- **File**: `app/(app)/notifications.tsx`
- **Problem**: 12 cards have `onPress={() => {}}`
- **Acceptance**: each card navigates to a relevant detail (e.g., alert → `/(app)/alert-instructions`, report → `/(app)/reports/:id`). For demo, any deterministic target is acceptable; document the routing table at top of file.

### 1.3 — Fix `smartband/connection.tsx` runtime crash
- **File**: `app/(onboarding)/smartband/connection.tsx`
- **Problem**: Uses `router.push(...)` but never declares `const router = useRouter()`
- **Acceptance**: import `useRouter` from `expo-router`, declare router, no runtime error on "Continuar".

### 1.4 — Resolve modal duplication via shared components (decided)
- **Files**: `app/modals/{support-form,privacy-policy,responsables}.tsx` + corresponding settings/reports impls
- **Problem**: 3 stub modals at `app/modals/*` shadow real impls under `(app)/`
- **Decision**: extract shared body components.
- **Acceptance**:
  1. Create `mobile/components/modals/SupportFormModal.tsx` (body: header + Combobox + Input + textarea Input + ContainedButton). Move logic from `(app)/settings/support.tsx`.
  2. Create `mobile/components/modals/PrivacyPolicyModal.tsx` (body: header + ScrollView with policy text). Move logic from `(app)/settings/privacy.tsx`.
  3. Create `mobile/components/modals/ResponsiblesModal.tsx` (body: header + SearchInput + avatar list + Checkbox + footer Cancel/Confirm). Move logic from `(app)/reports/responsibles.tsx`.
  4. Convert each `app/modals/*.tsx` and the original `(app)/settings/{support,privacy}.tsx` + `(app)/reports/responsibles.tsx` into thin wrappers that render the shared component inside the route's presentation envelope (bottom-sheet, transparentModal backdrop, safe area).
  5. `(auth)/login.tsx:99` and `(auth)/sign-up.tsx:165` keep pointing to `/modals/support-form` and `/modals/privacy-policy` respectively — those routes now render the shared body via the root `_layout.tsx` modal stack registration (which is already in place).
  6. Delete `app/modals/responsables.tsx` entry from root `_layout.tsx:63` only if zero callers remain (the shared component path replaces it). The route `(app)/reports/responsibles.tsx` remains as the canonical caller from `reports/new.tsx:107`.
  7. **Acceptance test**: open the same modal from auth and from settings — visually identical (one source of truth).

### 1.5 — Auth gate on `(app)/`
- **File**: `app/(app)/_layout.tsx` + `app/index.tsx` + `services/auth/AuthProvider.tsx`
- **Problem**: No guard — every authenticated route reachable via deep link
- **Acceptance**: `(app)/_layout.tsx` reads auth state and redirects to `/login` when unauthenticated. `app/index.tsx` checks auth state before redirecting (`/login` when out, `/(app)/dashboard` when in). `signOut()` is called by `settings/index.tsx` sign-out handler before `router.replace('/login')`. Persistence still in-memory for demo phase (do not block on AsyncStorage unless user asks).

### 1.6 — Unify dashboard alert state into single route (decided)
- **Files**: `app/(app)/dashboard.tsx` + `app/(app)/alert-instructions.tsx`
- **Decision**: fold both into `dashboard.tsx?alert=active`. Per Figma intent: both Figma frames `385:29138` and `385:29591` are named "dashboard-alert-active" → same screen, 2 states.
- **Acceptance**:
  1. In `dashboard.tsx`, read `useLocalSearchParams<{ alert?: string }>()`.
  2. When `alert === 'active'`, render the Procedimento de evacuação panel (weather card + 4 numbered steps + confirmation CTA) currently in `alert-instructions.tsx`. Header title becomes "Procedimento de evacuação".
  3. When `alert` is undefined or any other value, render the existing silhouette/stats dashboard (no behavioral change).
  4. Help button (currently → `/alert-instructions`) becomes `router.push('/(app)/dashboard?alert=active')`.
  5. CTA "Entendi, estou seguindo as instruções" navigates to `/(app)/dashboard` (no param) to return to base state.
  6. Delete `app/(app)/alert-instructions.tsx` (rota deixou de existir).
  7. **Pixel-fidelity test**: compare side-by-side with Figma `385:29591` at 360-wide — all spacing, font sizes, colors, copy verbatim.

---

## Sprint 2 — Visible Off (HIGH)

### 2.1 — Fix 3 copy typos
- `reports/new.tsx:82` → remove "Nome completo do novo administrador" placeholder copy
- `my-stats.tsx:434` → "HIstórico Médico" → "Histórico Médico"
- `settings/personal-data.tsx:74` → "Dados da cadastro" → "Dados do cadastro"

### 2.2 — Wire dead handlers (8 sites)
Listed in `app-routes-fidelity.md` Severity section. Includes camera toggles, map controls ("Empregados"/"Câmeras" no-ops), "Novo Chat" → nonexistent route, "Continuar" in responsibles modal doesn't return selection, journey/task "Finalizar/Cancelar" return wrong route.

### 2.3 — Add weather-alert callers
- **File**: `app/modals/weather-alert.tsx` is implemented but unreachable.
- **Acceptance**: trigger it from `map-weather.tsx` (alert pin tap) and/or from `dashboard.tsx` notification. Add one inbound nav site at minimum.

### 2.4 — Wire `map-weather.tsx` inbound nav
- **File**: `app/(app)/map.tsx` (map control) or `dashboard.tsx`
- **Problem**: Fully implemented screen with zero inbound nav
- **Acceptance**: at least one CTA in `map.tsx` or `dashboard.tsx` pushes to `/(app)/map-weather`.

### 2.5 — Evacuation route line + nav arrow (Phase 2)
- **Files**: `app/(app)/evacuation.tsx` + `evacuation-ongoing.tsx`
- **Problem**: SVG route line + navigation chevron deferred at first pass
- **Acceptance**: render the Figma route line vector (export SVG from node `385:30461` Vector8) + navigation arrow rotated per Figma transform. Use `react-native-svg` (already a transitive dep via DS or available — verify).

### 2.6 — `map-weather.tsx` radar overlay
- **File**: `app/(app)/map-weather.tsx`
- **Problem**: weather radar artwork deferred (bytes not in bundle)
- **Acceptance**: extract from Figma node `imgDashboardAlertActive` asset, save to `assets/`, render below pins.

### 2.7 — `OnboardingHeader` token bypass (highest leverage)
- **File**: `mobile/components/OnboardingHeader.tsx`
- **Problem**: raw `fontSize: 20` + `fontSize: 32` propagates to all 3 complimentary-data steps
- **Acceptance**: use DS `<Title variant="...">` + `<Text variant="...">`. Single fix fixes 3 screens.

---

## Sprint 3 — Token Cleanup (MEDIUM)

### 3.1 — Shadow color token
- **Sites**: `notifications.tsx`, `map.tsx`, `map-weather.tsx`, `evacuation.tsx` (+ `evacuation-ongoing.tsx` likely)
- **Pattern**: `shadowColor: '#1D1D1D'`
- **Fix**: bump DS to expose `theme.shadow.color` (or simpler: `theme.content.dark`). Replace 4–5 sites.

### 3.2 — Modal overlay token
- **Sites**: 3 modals using `rgba(0,0,0,0.4)` (or 0.5) backdrop
- **Fix**: add `theme.overlay` token in DS (`rgba(0,0,0,0.4)` default). Replace at all sites.

### 3.3 — `<RNText>` → DS `<Text>`/`<Title>` (~50+ occurrences)
- **Scope**: alert-instructions, journey/*, notifications, reports/[id], reports/responsibles, evacuation*, map, preferences, privacy, health-data, chat/[userId]
- **Fix**: replace each `<RNText style={{ fontFamily: theme.fontFamily.X, fontWeight: theme.fontWeight.Y, fontSize: theme.fontSize.Z, color: theme.content.W }}>` with the matching DS variant. Will require deriving the variant map; not all combinations have a direct DS equivalent — flag any that don't and bump DS variants if needed.

### 3.4 — Extract duplicated blocks
- **Chat + Home FAB block** (11 screens) → `<NavFABs>` shared component
- **Pagination block** (2 screens) → shared
- **Map controls vertical stack** (2 screens) → shared
- **Bespoke radio circle** (3 journey files) → DS bump or shared
- **Caution**: per CLAUDE.md "no premature abstraction" — only extract where the duplication is mechanical (FAB block fits this rule). For others, decide case-by-case.

### 3.5 — Three TS errors
- `dashboard.tsx:400` → use `title.m` or correct variant (check DS export)
- `my-stats.tsx:79` → wrap `<Image>` in `<View pointerEvents="none">`
- `reports/responsibles.tsx:126` → use a valid `AvatarSize`

### 3.6 — Smartband padding tokens
- 3 smartband screens use `paddingHorizontal: 16` raw → `theme.padding.m`

### 3.7 — `+not-found.tsx` hex
- `color="#62bb81"` → `theme.content.primary`

---

## Sprint 4 — Polish (LOW)

### 4.1 — Resolve open questions from INDEX.md §"Open Questions"
1. Auth-side modal strategy (a/b/c — recommend ask user)
2. `email-confirmation-message` Figma duplicate — clarify with user
3. Dashboard alert state architecture decision

### 4.2 — Unused 3D library dependencies
- `package.json` has `@react-three/fiber`, `@react-three/drei`, `three`, `expo-gl` with no usage. Remove unless planned for `my-stats` silhouette.

### 4.3 — Splash screen timeout / error recovery
- `app/_layout.tsx` `useFonts` has no timeout — if fonts fail, splash stays forever
- Add 5s fallback + error boundary

### 4.4 — Add password-recovery email-sent variant (decided)
- **Decision**: Figma `211:12920` (signup flow) and `290:688` (password-recovery flow) are distinct screens.
- **Acceptance**:
  1. Existing `(auth)/email-sent.tsx` covers Figma `211:12920` (signup confirmation message). Keep as-is; verify copy matches Figma node `211:12920`.
  2. Add `(auth)/password-recovery/email-sent.tsx` covering Figma `290:688` (recovery email sent — "enviamos link para resetar senha"). Pull Figma context for `290:688` to verify exact copy + layout before coding.
  3. Update `(auth)/password-recovery/email.tsx` submit handler to navigate to `/password-recovery/email-sent` (not the signup variant).

---

## Execution Order Recommendation

1. **Resolve open questions first** (no coding) — auth-modal strategy, dashboard-alert architecture, email-sent variants
2. **Sprint 1** (~5 fixes, ~2 hours)
3. **Sprint 2 token + RNText cleanup planning** — bulk-replace `<RNText>` is a single pass with `Grep` + sed-like edits; estimate before starting
4. **Sprint 2 fixes** (~7 items, ~3 hours)
5. **Sprint 3 cleanup** (~7 items, ~2 hours)
6. **Sprint 4 polish** (~4 items, ~1 hour)
7. **Final tsc clean + push** → commit per sprint, not bulk

After Sprint 2, run the app locally and screenshot every route to confirm fidelity vs Figma — generate a visual regression sheet at `docs/audits/mobile/2026-05-15-followup/screenshots/`.

---

## Acceptance Criteria for "100% Paired With Figma" (precision mode)

A route is considered paired when:
1. **All copy** matches Figma text content **verbatim** (Portuguese accents and capitalization included — diff against `get_design_context` text nodes)
2. **All icons** are DS-sourced or Figma-SVG-sourced (never PNG fallback, never invented path data)
3. **All tokens** come from `useTheme()` — no raw hex, no raw `fontFamily`, no raw `padding/gap/borderRadius/fontSize/fontWeight` (use `theme.padding.*`, `theme.gap.*`, `theme.border.radius.*`, `theme.fontSize.*`, `theme.fontWeight.*`). **Zero exceptions.**
4. **All DS components** used as-is (no local re-implementation, no override of internal styles). If DS lacks a prop, bump DS — do not paint around it.
5. **All `onPress`** handlers navigate to a real route. No `() => {}` and no `// TODO(demo)` shortcuts in this pass. Genuine future work marked `// Phase 2:` with reason.
6. **No pre-existing TS errors** on the file (the 3 baseline errors must be cleared as part of Sprint 3).
7. **Layout ±0px** at 360-wide reference. Visual diff using Playwright screenshot vs Figma `get_screenshot` at same `maxDimension`.
8. **No `<RNText>` with manual font props** — every text uses DS `<Text variant="..." />` or `<Title variant="..." />`.

When all 50 route files meet this, the audit is closed. Generate a closing report at `docs/audits/mobile/2026-05-15-followup/closing-report.md` with per-route pass/fail + screenshot links.

---

## Memory Updates (suggested)

After this session, the next agent should consider updating:
- `feedback_token_consumption.md` — extend with shadow/overlay token guidance
- `project_swi_mobile_scope.md` — note auth gate status (demo-phase decision)
- New memory: `feedback_modal_duplication_strategy.md` after open question 4.1.1 resolves
