# Auth, Onboarding & Modals — Figma Fidelity Audit

- **Date**: 2026-05-15
- **Scope**: `mobile/app/(auth)/*`, `mobile/app/(onboarding)/*`, `mobile/app/modals/*`
- **Reference**: Figma `bzDUuPdSiKgl5xucBH0IYE` ("SWI - UI")
- **Stack**: React Native + Expo Router + `@kavicki/swi-design-system` v0.1.44, tokens via `useTheme()`
- **Mode**: Read-only — no source modified. Next session executes fixes.

This audit lists per-route divergences relative to the Figma source. Each finding is categorized for severity in the summary at the end.

---

## Auth flow

### `app/(auth)/login.tsx` (Figma 138:7937)

- **DS usage**: clean — uses `Logo`, `Input`, `Button`, `Icon`. `Pressable` only wraps the eye-icon (acceptable).
- **Hardcoded tokens**:
  - `paddingTop: insets.top + 123` — magic 123. Figma references this as a derived value (123 + 64 + 88 = 275 form top) so it's intentional, but the literal isn't a token. Acceptable for a one-off composition.
  - `marginTop: 88`, `width: 328` — Figma-spec absolute values, fine for layout pin.
  - `size={22}` on the eye `Icon` — Inputs usually use 24px icons; DS `Input` likely renders icons inset at the standard size. Verify whether `iconRight` slot expects 24px; if so this is HIGH because it diverges from every other Input in the codebase.
- **Missing fields**: none — Login, Senha, Recuperar senha (ghost), Entrar, Primeiro acesso, Suporte all present.
- **Layout deviation**: form is centered with `alignItems: 'center'` and pinned at 275px from top. Figma frame uses the same composition. OK.
- **Wiring gaps**:
  - `handleLogin` calls `signIn(email)` and routes to `/(app)/dashboard` — does **not** route through smartband onboarding. Per the flow described in `account-confirmation.tsx`, sign-up users flow into `/(onboarding)/smartband/*`. Returning users skipping smartband is correct, but the demo expectation should be verified.
  - "Suporte" pushes `/modals/support-form` — which is currently a scaffold (see modals section). Demo-blocker for that path.
- **Deferred gaps (already documented)**: none.

### `app/(auth)/sign-up.tsx` (Figma 138:7963)

- **DS usage**: clean — uses `Title`, `Text`, `Input`, `Toast`, `Checkbox`, `Button`, `Icon`.
- **Hardcoded tokens**:
  - `width: 328`, `paddingTop: insets.top + 32`, `paddingBottom: 48` — explicit layout pins; acceptable but consider `theme.padding.xl`/`l` if values match.
  - `size={22}` on eye Icons (×2) — same concern as login. MEDIUM.
- **Missing fields**:
  - None for inputs. Toast carries password rules per Figma 211:12899 verbatim.
  - The `Toast` title currently reads "Sua senha precisa ter 8 caracteres incluindo letras e números" with body "1 símbolo @#$%ˆ\n1 Letras maiúscula". Figma uses an `info` variant — matches.
- **Layout deviation**: order is `Title → Text → fields → Toast → Checkbox → ghost Política link → Criar conta / Voltar`. Verify against Figma: the policy ghost button is positioned **after** the checkbox in code; in many designs the policy link is **inline inside** the checkbox label (e.g., "concordo com [Política de privacidade & Termos de uso]"). Current implementation puts a separate ghost button below. MEDIUM — possible structural mismatch; needs Figma confirmation against 138:7963.
- **Wiring gaps**: routes to `/(auth)/email-sent` on submit — correct per file comments. Política de privacidade button → `/modals/privacy-policy` (currently a scaffold).
- **Deferred gaps (already documented)**: none.

### `app/(auth)/email-sent.tsx` (Figma 211:12920 — variant question)

- **Variant handled**: This file uses `iconName="mail"` SuccessBadge with copy "Confirme sua conta pelo email" and an inline italic email address. That matches **either** variant depending on which Figma node 211:12920 vs 290:688 represents; both nodes are likely "email sent" success states. Without pulling Figma here, the code targets 211:12920 (per route audit map). **The other variant (290:688) is not represented in this file**.
- **Question to resolve in next session**: are 211:12920 and 290:688 different states (e.g., sign-up vs password-recovery email-sent) or copy variants? If they're separate, **a second screen is missing**. The current `password-recovery/email.tsx` skips an interstitial entirely (commented "skip the intermediate email-sent notice"), which may be the intentional collapse — but if Figma 290:688 IS a distinct screen, that decision should be documented.
- **DS usage**: clean — `SuccessBadge`, `Title`, `Text`.
- **Hardcoded tokens**: none aside from `width: 328`.
- **Missing fields**: per file comment "no extra 'Já confirmei' button there" — the demo auto-advances after 4s; no Figma button is missing per the comment.
- **Layout deviation**: centered vertically/horizontally with `gap: theme.gap.l`. The inline italic email uses `color: theme.content.secondaryLight` — verify in Figma the email accent color matches that token; could also be `content.primary`.
- **Wiring gaps**: auto-redirect to `/(auth)/account-confirmation` after 4s. OK.
- **Deferred gaps**: comment at top documents the 4s timing decision.

### `app/(auth)/account-confirmation.tsx` (Figma 211:12994)

- **DS usage**: clean — `SuccessBadge` (check icon), `Title`, `Text`.
- **Hardcoded tokens**: none aside from `width: 328`.
- **Missing fields**: none — copy "Conta criada com sucesso!" + "Você será redirecionado para a tela inicial" matches Figma description.
- **Layout deviation**: `Text` color is `theme.content.medium` — verify Figma uses medium (lighter) vs `content.dark` (same as title). Inconsistent with sibling screens (login/sign-up/email-sent use `content.dark` for body); could be intentional dimming. LOW.
- **Wiring gaps**: redirects to `/(auth)/complimentary-data/step-1` after 2.5s. OK.
- **Deferred gaps**: comment documents the 2.5s timing decision.

### `app/(auth)/password-recovery/email.tsx` (Figma 138:7948)

- **DS usage**: clean — `Title`, `Text`, `Input`, `Button`.
- **Hardcoded tokens**: `width: 328`. OK.
- **Missing fields**: none for the form itself. **Possible missing**: per the email-sent variant question (211:12920 vs 290:688), if 290:688 is a recovery-side email-sent confirmation, the current flow `email → new-password` (with a comment "skip the intermediate email-sent notice") **bypasses** a screen the design specifies. MEDIUM — flagged for review.
- **Layout deviation**: centered, single column. OK.
- **Wiring gaps**: routes directly to `/(auth)/password-recovery/new-password` on submit; in production should send email + show confirmation. Demo-acceptable per file comment.
- **Deferred gaps**: comment at handler documents the demo collapse.

### `app/(auth)/password-recovery/new-password.tsx` (Figma 138:7955)

- **DS usage**: clean — `Title`, `Text`, `Toast`, `Input`, `Icon`, `Button`.
- **Hardcoded tokens**: `width: 328`. `size={22}` on eye Icons (×2) — same MEDIUM concern as login/sign-up.
- **Missing fields**: Toast content matches Figma 138:7959 password rules.
- **Layout deviation**: order is `Title → Text → Toast → fields → button`. Figma layout typically places Toast/info near the field — verify the Toast position. Currently Toast is **above** the password fields. LOW.
- **Wiring gaps**: `handleSubmit` → `router.replace('/(auth)/login')` — file comment notes production would surface a "senha alterada" success screen first. Demo-acceptable.
- **Deferred gaps**: comment documents the missing success interstitial.

### `app/(auth)/complimentary-data/step-1.tsx` (Figma 211:13009)

- **DS usage**: uses `StepBar`, `Title`, `Input`, `ImageUploader`, `Button`. **Local `OnboardingHeader` component** (`components/OnboardingHeader.tsx`) renders the "Boas vindas {username}!" greeting via raw `<Text>` with two different inline font sizes (20px + 32px). This is a candidate for a DS primitive (e.g., `WelcomeHeader` or a `Title` variant supporting mixed-weight) — MEDIUM. See "DS-gap" below.
- **Hardcoded tokens**:
  - `OnboardingHeader.tsx` lines 31, 41: `fontSize: 20`, `fontSize: 32` — raw px values bypassing `theme.fontSize.*`. **HIGH** (these are core typography violations).
  - `paddingTop: insets.top + 26`, `paddingHorizontal: 16`, `paddingBottom: insets.bottom + 32` — magic 26/16/32. Could be `theme.padding.*` (16 ≈ `padding.m`).
- **Missing fields**: form has Nome completo, Telefone, CPF, Data de nascimento, Foto de perfil (with helper "Selecione arquivos do tipo: JPG ou PNG"). Matches Figma per the file structure.
- **Layout deviation**: `ImageUploader` shows two actions ("Tirar Foto" / "Enviar arquivo"). Verify Figma offers both — likely matches.
- **Wiring gaps**: `goNext` always navigates — no validation (intentional for demo).
  - `onTakePhoto` and `onPickFile` both set the same placeholder URI `demo://placeholder`. LOW.
- **Deferred gaps (already documented)**: `OnboardingHeader.tsx:1-4` comment notes "Page-level compose used by all 3 complimentary-data steps. Mirrors the `Header > Greeting + Description` group in Figma (211:13011, 213:13394, 213:13468)" — i.e., this IS a known compose-local; should likely be promoted to DS.

### `app/(auth)/complimentary-data/step-2.tsx` (Figma 213:13390)

- **DS usage**: same as step-1 — re-uses `OnboardingHeader` + DS primitives.
- **Hardcoded tokens**:
  - Inherits `OnboardingHeader` raw `fontSize: 20/32` issue. HIGH.
  - Same magic `26/16/32` paddings.
- **Missing fields**: CEP, Logradouro, Número, Bairro, UF. **Likely missing**: Cidade and Complemento fields. The Figma address form for Brazil typically includes Cidade (city). MEDIUM — verify against 213:13390.
- **Layout deviation**: Número is rendered as a full-width Input on its own row. Brazilian address forms usually pair `Número` and `Complemento` (or have `Logradouro | Número` side-by-side). Verify pattern. MEDIUM.
- **Wiring gaps**: `goNext` always navigates. OK for demo.
- **Deferred gaps**: none beyond the OnboardingHeader DS-gap.

### `app/(auth)/complimentary-data/step-3.tsx` (Figma 213:13464)

- **DS usage**: `GenderSelector`, `Combobox`, `Radio`, `Input`, `StepBar`, `Title`, `Text`, `Button`.
- **Hardcoded tokens**:
  - `OnboardingHeader` raw `fontSize: 20/32` (inherited). HIGH.
  - `numberOfLines={4}` on the multiline Inputs — verify whether `Input` supports `multiline` natively (DS uses `text-area` in Figma). MEDIUM — could need a dedicated `TextArea` if input is not styling correctly.
  - "Seu gênero" and "Pessoa com deficiência?" labels use bare `<Text variant="body.m" style={{ fontWeight: theme.fontWeight.bold }}>` — raw inline weight override instead of a DS label primitive. The same pattern is needed for input section labels — should be a `Label` or `FieldLabel` DS primitive. MEDIUM.
- **Missing fields**: gênero, altura, peso, tipo sanguíneo, alergias, doenças crônicas, deficiência. Matches Figma description.
- **Layout deviation**: Altura + Peso are side-by-side in a row (`flexDirection: 'row'`). OK. The two textarea Inputs ("alergias" and "doenças crônicas") have placeholder "(descreva aqui)" — verify Figma copy uses parentheses.
- **Wiring gaps**: `finish` routes to `/(onboarding)/smartband/connection` — bypasses any "Concluir" success state. Demo-acceptable.
- **Deferred gaps**: `OnboardingHeader` DS-gap (see step-1).

---

## Onboarding (smartband)

### `app/(onboarding)/smartband/pairing.tsx` (Figma 215:17901 — smartband-connection-start)

- **DS usage**: `SmartbandStatus`, `Title`, plus `Image` for the smartwatch graphic.
- **Hardcoded tokens**:
  - `paddingTop: insets.top + 26`, `paddingBottom: insets.bottom + 32`, `paddingHorizontal: 16` — same magic numbers as complimentary-data.
  - `Image` size `width: 320, height: 347` — Figma-spec px. OK as a one-off asset.
- **Missing fields**: file comment notes "3D Smartwatch3D temporarily reverted to a static PNG while we sort out three.js `import.meta` interop with Metro web". Figma 215:17901 ostensibly shows an animated 3D model; the static PNG is a known fallback. HIGH for production, but **deferred** per the documented blocker.
- **Layout deviation**: title is at top, watch centered, status pinned at bottom — matches Figma "smartband-connection-start".
- **Wiring gaps**: auto-progresses to `complete` after 3s sync animation. OK for demo.
- **Deferred gaps (already documented)**: file:6-8 — "3D Smartwatch3D temporarily reverted to a static PNG while we sort out three.js `import.meta` interop with Metro web. See components/Smartwatch3D.tsx for the working component once expo-gl native build is wired."

### `app/(onboarding)/smartband/connection.tsx` (Figma 215:13790)

- **DS usage**: `Title`, `Text`, `Button`.
- **Hardcoded tokens**: `paddingHorizontal: 16`, `paddingTop: insets.top + 26`. Magic 16/26.
- **Missing fields**: title "Vamos configurar a sua Smartband" + permissions list (bluetooth, localização, smartband no pulso) + "Conceder permissões" outline button + "Continuar" contained CTA. Matches Figma description.
- **Layout deviation**:
  - The Continuar button is rendered **outside** the ScrollView at the bottom in a separate View. Sticky footer is a common pattern — verify Figma also has it pinned vs inline at bottom of content. LOW (sticky is the safer mobile pattern).
  - `marginTop: theme.gap.l` on the inner instructions section — inline margin instead of relying on the parent's `gap: theme.gap.xl`. LOW.
- **Wiring gaps**:
  - "Conceder permissões" button is `onPress={() => { /* demo: no-op. Production triggers Permissions.request() */ }}`. **Wiring gap (intentional, documented)**. MEDIUM for production; demo-acceptable.
  - **CRITICAL runtime bug**: line 83 calls `router.push('/(onboarding)/smartband/pairing')` but `router` is never assigned — `useRouter` is imported on line 2 but `const router = useRouter()` is missing from the component body. The "Continuar" button will throw at runtime. (Verify against the file: `const theme = useTheme()` and `const insets = useSafeAreaInsets()` are present but no `const router = useRouter()`.)
- **Deferred gaps**: line 66 documents the no-op permission stub.

### `app/(onboarding)/smartband/complete.tsx` (Figma 245:18895)

- **DS usage**: `SmartbandStatus`, `Title`, `Button`, plus `Image`.
- **Hardcoded tokens**: magic 26/32/16 paddings + `width: 320, height: 347` watch image.
- **Missing fields**:
  - Shows `heartRate={88}` + `bloodPressure="12/8"` + `progress={1}` + completion message. The blood pressure value "12/8" is shorthand for 120/80 (Brazilian colloquial); verify Figma matches.
  - File comment: "3D Smartwatch3D temporarily reverted to a static PNG (see pairing.tsx note)" — same deferred 3D model.
- **Layout deviation**: title pinned top, watch centered, status + Finalizar button at bottom in a `View` with `gap: theme.gap.m`. Matches Figma description.
- **Wiring gaps**: `Finalizar` → `router.replace('/(app)/dashboard')`. OK.
- **Deferred gaps**: 3D fallback (same as pairing).

---

## Modals

### `app/modals/support-form.tsx` (Figma 213:13742 auth-side, 348:10426 settings-side)

- **CRITICAL — placeholder scaffold**. Current content is 11 lines: a `Surface` with literal text "support-form-modal" and the Figma IDs. **No real implementation.** Per Figma 213:13742, this should be a bottom-sheet with:
  - Title `Solicitação de suporte` (`content.primary` color, title/xs)
  - Close icon in header (X, top-right)
  - `Combobox` "Motivo da solicitação" with placeholder "Selecione aqui"
  - `Input` "Título da sua solicitação" with placeholder "Digite aqui"
  - Multi-line `Input` "Mensagem" with placeholder "Digite aqui a sua mensagem" (height ~169px)
  - Contained `Button` "Enviar solicitação" (full width, surface.primary)
  - Background `theme.background`, padded `padding.m` horizontal, `padding.2xl` (40px) bottom, `padding.m` top, rounded top corners.
- **Note**: the settings variant (348:10426) is **already implemented** as a full screen at `app/(app)/settings/support.tsx` (line 14: "Figma 348:10426 — bottom-sheet modal `Solicitação de suporte`"). The settings flow uses its own route, **not** this `/modals/support-form` modal. So this modal serves **only the auth side** (login screen → "Suporte" button).
- **DS usage**: needs `Title`, `Combobox`, `Input` (with multiline support), `Button`, `Icon` (for X close).
- **Hardcoded tokens**: N/A (rewrite needed).
- **Missing fields**: everything except the file shell.
- **Wiring gaps**: `Enviar solicitação` needs to dismiss + ideally surface a toast. Login screen's "Suporte" press currently routes here and lands on the scaffold.
- **Deferred gaps**: N/A — this is an unimplemented stub, not deferred.

### `app/modals/privacy-policy.tsx` (Figma 213:13750 auth-side, 348:10434 settings-side)

- **CRITICAL — placeholder scaffold**. Identical 11-line scaffold. Per Figma 213:13750, this should be a bottom-sheet with:
  - Title `Política de privacidade` (`content.primary`, title/xs)
  - Close icon (X, top-right)
  - Long scrollable policy text body (Inter Regular 14px / `body.m`, color `content.dark`). The full text is already inlined in the **settings** sibling at `app/(app)/settings/privacy.tsx` line 10 (constant `POLICY`) — that exact string should be reused (consider extracting to a shared module).
  - Background `theme.background`, padding `padding.m`, rounded top corners.
- **Note**: settings variant (348:10434) is already implemented at `app/(app)/settings/privacy.tsx`. This modal serves **only the auth side** (sign-up screen → "Política de privacidade & Termos de uso" ghost button).
- **DS usage**: needs `Title`, `Text`, `Icon`, `ScrollView` (RN primitive).
- **Hardcoded tokens**: N/A (rewrite needed).
- **Missing fields**: everything except the file shell.
- **Wiring gaps**: X icon press needs `router.back()`.
- **Deferred gaps**: N/A — unimplemented stub.

### `app/modals/responsables.tsx` (Figma 364:18017)

- **CRITICAL — placeholder scaffold**. Current content is 11 lines: same `Surface` placeholder. Per Figma 364:18017:
  - Surface `surface.standard` (`#1f1f1f`), padding `padding.m`, gap `gap.l`, rounded top corners.
  - Header: title "Selecionar responsáveis" (`content.dark`, title/xs) + helper "Atribua 1 ou mais responsáveis ao seu relatório, eles revisaram e farão comentários." (body/m).
  - `SearchInput` placeholder "Pesquisar" with search icon right.
  - Scrollable list of Admin Cards: Avatar (size xl, 64px) + name (bold 14) + age "32 anos" + blood-type (BloodIcon + value bold 16) + `Checkbox` on the right.
  - Action bar: outline `Cancelar` (`content.primary-light` border + label) + contained `Continuar` (`surface.primary` bg + `content.light` label + elevation lg).
- **Note**: A **full, working implementation already exists** at `app/(app)/reports/responsibles.tsx` (line 15-19: "Figma 364:18017 — responsables-modal (bottom-sheet) aberto a partir de /reports/new"). The `/modals/responsables` route is duplicated dead code unless it's intentionally serving a different entry point. **Recommendation**: either delete `/modals/responsables.tsx` and route everything to `/reports/responsibles`, or copy the implementation here. The duplication itself is a HIGH-severity inconsistency.
- **DS usage**: needs `Title`, `SearchInput`, `Avatar`, `Checkbox`, `Button`. The reports/responsibles version uses an inline `Pressable` row with `RNText` for name/age/blood — the same audit (mixed-weight name + age + blood-type in a single card body) is a **DS-gap** candidate: a `ResponsibleCard` or `UserSelectCard` primitive would clean it up.
- **Hardcoded tokens**: N/A (rewrite needed).
- **Wiring gaps**: every action.
- **Deferred gaps**: the existing reports version notes "Demo phase: useState pra selected set; sem persistência."

### `app/modals/weather-alert.tsx` (Figma 385:29371)

- **DS usage**: uses `Button`, `Icon`, `Title`, `WeatherIcon`, `useTheme`. Uses raw `RNText` for the temperature value "17ºC", "Chuva Intensa" label, humidity/wind/temp-max/temp-min metric values, and the body description. **Heavy raw-text usage** — these should use the DS `Text` primitive with variants. HIGH.
- **Hardcoded tokens**:
  - Line 51: `padding: theme.padding.m` on backdrop wrapper — OK.
  - Line 75-76: `width: 111, height: 100` weather-condition card — Figma-spec px (fine).
  - **Line 88**: `top: -28` — magic negative offset for the WeatherIcon overlap. OK if it matches Figma's exact overlap.
  - **Line 98**: `fontSize: 32` for the temperature — **raw px not via theme**. Should be a `title.s` or `title.m` variant. HIGH.
  - Lines 99, 107, 125, 138, 152, 166, 178: every RNText uses `fontFamily/fontWeight/fontSize` via theme tokens directly (NOT raw hex) — these are token-driven but still bypass the DS `Text` component which would handle them via `variant="body.m"`. MEDIUM/HIGH — should refactor to `<Text variant="body.m">…</Text>`.
  - Line 35: `backgroundColor: 'rgba(0,0,0,0.5)'` for the overlay — **raw rgba**, not via theme. The DS may not expose an "overlay" surface token; if not, this is a **DS-gap** (need `theme.surface.overlay` or `theme.overlay.default`). HIGH because it's the only raw color in this audit.
  - Line 147: `color: theme.surface.warning` for the up-arrow icon — using a `surface.*` token for **icon color**. Could be intentional (the warm-up color) but `surface.*` tokens are for backgrounds; should be `theme.content.warning` if such a token exists. MEDIUM.
  - Line 160: `color: theme.content.secondary` for the down-arrow — `content.secondary` is the blue brand; in the context of "temperatura mínima" downward arrow this is acceptable, but verify against Figma color spec.
- **Missing fields**: per Figma 385:29371 the modal includes title + weather card + metrics + body description + red CTA "Instruções de segurança". All present.
- **Layout deviation**:
  - The weather card metrics use a vertical stack with `Icon + value` rows. Figma shows the same — `gap.s` between rows. OK.
  - `Title` is `title.xs` color `content.dark`; Figma may use a different color for "Local em Alerta!" (red? warning?). LOW — verify.
- **Wiring gaps**: CTA → `/(app)/evacuation`. File comment line 14: "CTA → /evacuation (Phase 2)." If `/evacuation` route doesn't yet exist, this is a **demo-blocker** (CRITICAL for the alert flow but documented as Phase 2).
- **Deferred gaps (already documented)**:
  - Lines 11-14: "Demo phase: weather data hardcoded; CTA → /evacuation (Phase 2)."

---

## Severity Summary

### CRITICAL (blocks demo)

- **`app/modals/support-form.tsx`** — placeholder scaffold; login "Suporte" lands on it.
- **`app/modals/privacy-policy.tsx`** — placeholder scaffold; sign-up "Política de privacidade" lands on it.
- **`app/modals/responsables.tsx`** — placeholder scaffold (real impl exists at `reports/responsibles.tsx`; either delete this route or mirror the implementation).
- **`app/(onboarding)/smartband/connection.tsx`** — `router` reference (line 83 `onPress={() => router.push(...)}`) is never declared (`useRouter` imported but `const router = useRouter()` is missing). **Continuar button will crash at runtime.**
- **`app/modals/weather-alert.tsx`** — CTA targets `/(app)/evacuation` which is Phase 2; if exercised in demo, route does not exist.

### HIGH (visibly off, token violations on primary surfaces)

- **`components/OnboardingHeader.tsx`** — raw `fontSize: 20` and `fontSize: 32` (lines 31, 41) bypassing `theme.fontSize.*`. Used by all 3 complimentary-data steps. Also a DS-gap candidate (mixed-weight greeting should be a DS primitive).
- **`app/modals/weather-alert.tsx`** — raw `fontSize: 32` for temperature (line 98); raw `rgba(0,0,0,0.5)` overlay (line 35); heavy `RNText` usage instead of DS `Text` variants throughout.
- **`app/modals/responsables.tsx`** duplication with `app/(app)/reports/responsibles.tsx` — code drift risk; resolve before demo.
- **`app/(auth)/email-sent.tsx`** — variant ambiguity 211:12920 vs 290:688: if 290:688 represents a distinct recovery-side confirmation, the password-recovery flow is missing a screen.
- **`app/(auth)/login.tsx`**, **sign-up.tsx**, **password-recovery/new-password.tsx** — eye `Icon` rendered at `size={22}` instead of the standard 24; visible drift in Input icon alignment.
- **`app/(onboarding)/smartband/pairing.tsx`** & **complete.tsx** — static PNG fallback for the 3D smartwatch (documented; production-blocking but deferred).

### MEDIUM (token violations, copy/layout polish)

- **`app/(auth)/sign-up.tsx`** — verify policy link is a separate ghost button vs inline-in-checkbox label per Figma 138:7963.
- **`app/(auth)/complimentary-data/step-2.tsx`** — likely missing `Cidade` (and possibly `Complemento`) fields in the address form; `Número` likely should pair side-by-side with `Logradouro` or `Complemento`.
- **`app/(auth)/complimentary-data/step-3.tsx`** — bold `<Text>` used as field section labels ("Seu gênero", "Pessoa com deficiência?") — should be a `FieldLabel`/`SectionLabel` DS primitive. `Input multiline` for "alergias"/"doenças crônicas" — verify the DS Input renders a real text-area, otherwise need a dedicated `TextArea` component.
- **`OnboardingHeader.tsx`** — DS-gap: the mixed-size greeting ("Boas vindas {username}!") should likely be a DS primitive (e.g., `WelcomeTitle` or `Title variant="welcome"`).
- **`app/(auth)/password-recovery/email.tsx`** — possibly missing email-sent confirmation screen (collapsed per file comment; reconfirm with PM).
- **`app/(auth)/password-recovery/new-password.tsx`** — Toast position above fields; verify Figma places it adjacent to the password input instead.
- **`app/modals/weather-alert.tsx`** — icon colors using `surface.warning`/`content.secondary` for up/down temperature arrows; verify against Figma color spec; possibly want a dedicated `theme.content.warning`/`theme.content.info` token.
- **`app/(onboarding)/smartband/connection.tsx`** — "Conceder permissões" button is a documented no-op stub.
- **All complimentary-data + smartband screens** — magic paddings `+ 26`, `+ 32`, `paddingHorizontal: 16` should map to `theme.padding.*` for consistency.
- **`app/modals/responsables.tsx` (when implemented)** — the inline `Pressable` admin row in the reports version mixes DS `Avatar` + `RNText` (bold name, regular age, bold blood) — DS-gap candidate `ResponsibleCard`/`UserSelectCard`.

### LOW (nits)

- **`app/(auth)/email-sent.tsx`** — verify italic-email color token (`content.secondaryLight` vs `content.primary`).
- **`app/(auth)/account-confirmation.tsx`** — body text uses `content.medium` while siblings use `content.dark`; verify intentional.
- **`app/(auth)/password-recovery/new-password.tsx`** — see above for Toast placement.
- **`app/(auth)/complimentary-data/step-1.tsx`** — both photo actions write the same placeholder URI.
- **`app/(onboarding)/smartband/connection.tsx`** — inline `marginTop` on instructions wrapper instead of relying on parent gap; minor.
- **`app/modals/weather-alert.tsx`** — title color may be off vs Figma (`content.dark` vs warning).

---

## Notes for the next session

1. **Top priority fixes** are the four placeholder modals + the smartband connection runtime crash. Without those the auth/onboarding/modal demo path is broken end-to-end.
2. **`OnboardingHeader` DS-gap** affects three screens at once — fixing it as a DS primitive (or rewriting it to use `Title` variants + `theme.fontSize.*` if a primitive isn't justified) clears 3 HIGH findings.
3. **Variant 211:12920 vs 290:688** for `email-sent` needs a Figma pull next session (skipped to preserve the 3-call budget). If the variants are distinct, a new screen must be added.
4. **`responsables` duplication** — decide whether `/modals/responsables` exists (rewrite) or is dead code (delete + redirect).
5. **`/evacuation` route** — weather-alert CTA points to a Phase 2 route; either build the stub or redirect the CTA to an existing screen for the demo.
