# SWI Mobile — Full Audit 2026-05-15

Comprehensive code review of the SWI mobile app (`feat/mobile-login` branch) covering architecture, all routes, and Figma fidelity.

**Worktree audited**: `C:\Users\Gabriel\Documents\SWI-mobile\mobile\`
**Branch**: `feat/mobile-login`
**DS pin**: `@kavicki/swi-design-system@v0.1.44`
**Figma file**: `bzDUuPdSiKgl5xucBH0IYE` (page id `138:5997` — Mobile canvas, 37 frames)
**Routes audited**: 50 route files across `(app)/`, `(auth)/`, `(onboarding)/`, root + `modals/`

## Reports

| Report | Scope | Size |
|---|---|---|
| [architecture-review.md](./architecture-review.md) | Routing, layouts, modal duplication, auth gate, fonts, tsc baseline, hardcoding, nav graph | 21 KB |
| [auth-onboarding-fidelity.md](./auth-onboarding-fidelity.md) | 9 auth + 3 onboarding + 4 modal routes vs Figma | 28 KB |
| [app-routes-fidelity.md](./app-routes-fidelity.md) | 26 `(app)/*` routes (dashboard, map, journey, reports, settings, chat, etc.) vs Figma | 43 KB |

## Cross-cutting Findings

### 1. Auth gate is missing
`app/(app)/_layout.tsx` is a bare `<Stack />` with no guard. `app/index.tsx` unconditionally redirects to `/login`. `AuthProvider` is in-memory only (no persistence). **Any authenticated route is reachable via deep link without login**. Sign-out in `settings/index.tsx` calls `router.replace('/login')` but does not call `signOut()` — auth state pollutes across sessions.

### 2. Triple modal duplication
Three Figma modal nodes (`348:10426` support, `348:10434` privacy, `364:18017` responsibles) have **two implementations each**: a stub at `app/modals/*.tsx` and a full implementation at the actual route. The stubs at `app/modals/*` are 11-line placeholders. Callers:
- `(auth)/login.tsx:99` → stub `modals/support-form` ← needs real impl OR redirect strategy (pre-auth zone)
- `(auth)/sign-up.tsx:165` → stub `modals/privacy-policy` ← needs real impl OR redirect strategy (pre-auth zone)
- `modals/responsables` → **zero callers** (dead code)
- `(app)/settings/support.tsx`, `(app)/settings/privacy.tsx`, `(app)/reports/responsibles.tsx` are the real impls

### 3. `(app)/dashboard.tsx` does not handle the alert state
Figma `385:29138` (dashboard-alert-active) is a state of the dashboard but the current `dashboard.tsx` only implements `245:23280` (base). The alert state's red help button + alert-instructions wiring lives at `(app)/alert-instructions.tsx` instead — split is functionally correct but Figma intent is "same screen, two states". Decide if state-driven dashboard (`?alert=active`) is desired.

### 4. Compose-local debt is large but bounded
Two known DS gaps drive most code-side custom blocks:
- `HorizontalCard` has no description slot → 12 cards in `notifications.tsx:7` + task cards in `journey/index.tsx:146` built locally
- `Accordion` has no `content` prop → `settings/faq.tsx` accordions expand to nothing (CRITICAL — visible regression)

Plus heavy `RNText` with manual `fontFamily/fontWeight/fontSize` instead of DS `<Text>`/`<Title>` in **~50+ places** across alert-instructions, journey, notifications, reports, evacuation, map, settings forms, chat.

### 5. Wiring gaps
- `notifications.tsx` — all 12 cards have `onPress={() => {}}`
- 8 dead `onPress` handlers across `(app)/*` (camera toggles, map controls, "Novo Chat", "Continuar" in responsibles modal, journey/task "Finalizar/Cancelar")
- `(auth)/.../smartband/connection.tsx` references `router.push` but never declares `useRouter()` — runtime crash on Continuar
- `modals/weather-alert.tsx` — registered + fully implemented but **zero callers**
- `(app)/map-weather.tsx` — fully implemented but **no inbound navigation**

### 6. Hardcoded tokens (recurring)
- `shadowColor: '#1D1D1D'` raw hex in 4 files → should be `theme.content.dark` (or a new `theme.shadow.color`)
- `rgba(0,0,0,0.4)` raw modal backdrops in 3 modals → no `theme.overlay` token exists
- `paddingHorizontal: 16` raw in all 3 smartband screens → `theme.padding.m`
- `color="#62bb81"` raw in `+not-found.tsx` → `theme.content.primary`
- `fontSize: 20` / `fontSize: 32` in `OnboardingHeader.tsx` propagating to all 3 complimentary-data steps
- `weather-alert.tsx`: raw `fontSize: 32`, raw `rgba(0,0,0,0.5)`, heavy `RNText`

### 7. Three pre-existing TS errors (do not block tsc but propagate)
1. `dashboard.tsx:400` — `"title.l"` not in DS `TextVariant`
2. `my-stats.tsx:79` — `pointerEvents` on `<Image>` instead of wrapping `<View>`
3. `reports/responsibles.tsx:126` — `size="xl"` not in `AvatarSize`

### 8. Copy typos
- `reports/new.tsx:82` — placeholder copy from admins screen ("Nome completo do novo administrador")
- `my-stats.tsx:434` — "HIstórico Médico" (caps typo)
- `settings/personal-data.tsx:74` — "Dados da cadastro" (wrong article)

## Severity Counts

| | Architecture | Auth/Onboarding | App routes |
|---|---|---|---|
| CRITICAL | 1 | 5 | 3 |
| HIGH | 3 | 4+ | 5+ |
| MEDIUM | 5+ | 6+ | 12+ |
| LOW | 5+ | 4+ | 8+ |

See per-report severity sections for exact lists.

## Resolved Decisions (2026-05-15)

1. **Modal duplication strategy**: **Extract shared component**. Create `mobile/components/modals/<Name>Modal.tsx` containing the body (Combobox/Input/policy text). Both `app/modals/*` and `app/(app)/settings/*` become thin route wrappers that import the shared component. The auth zone can render the shared body too. `responsables` modal: shared component lives at `mobile/components/modals/ResponsiblesModal.tsx`, deleted from `app/modals/` (zero callers), kept at `app/(app)/reports/responsibles.tsx` as route wrapper.

2. **`email-confirmation-message` Figma duplicate**: **2 distinct screens** — `211:12920` is the **sign-up** flow ("verifique seu email pra ativar a conta"), `290:688` is the **password-recovery** flow ("enviamos link pra resetar senha"). Current single route `(auth)/email-sent.tsx` covers only one. Action: rename existing → `(auth)/email-sent-signup.tsx` (or keep as default for signup), add `(auth)/password-recovery/email-sent.tsx` for the recovery variant.

3. **Dashboard alert state**: **Unify into `dashboard.tsx?alert=active`**. Per Figma intent ("same screen, 2 states"). Action: fold `alert-instructions.tsx` body into `dashboard.tsx` behind `useLocalSearchParams<{ alert?: string }>()`. When `alert === 'active'`, render the Procedimento panel instead of the silhouette/stats. Delete `(app)/alert-instructions.tsx` and update the help-button to `router.push('/(app)/dashboard?alert=active')`.

## Next Session

See [HANDOFF.md](./HANDOFF.md) for the prioritized action plan to take into the next session.
