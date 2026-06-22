# SWI Mobile — Visual Regression 2026-05-15

## Setup

- **Worktree**: `C:\Users\Gabriel\Documents\SWI-mobile\mobile\` (branch `feat/mobile-login`, uncommitted Sprint 1-4 diff in working tree).
- **Dev server**: Expo Metro started cleanly (`npx expo start --web --port 8081`). Probed `http://localhost:8081/` → HTTP 200; `http://localhost:8081/login` → HTTP 200; `http://localhost:8081/dashboard` → HTTP 200. Background task `bhd79q1dl` still running.
- **Auth gate**: `app/(app)/_layout.tsx` redirects unauthenticated to `/(auth)/login` (`Redirect href="/(auth)/login"`). Demo `AuthProvider` is in-memory, so cold-start of any `(app)/*` route bounces back. Live navigation through `Entrar` button in login would walk through the gate.
- **Viewport target**: 360×800 (Figma canvas). Comparisons assume that viewport.

### CRITICAL CONSTRAINT — Live screenshots not captured

The spec assumed `mcp__playwright__browser_*` tools would be available; they are not present in this MCP environment (only Figma, Supabase, Google Drive, Exa, web-fetch tools loaded). No Playwright, Puppeteer, Chrome DevTools, or any browser-automation surface was discoverable via `ToolSearch`. The dev server is up and would respond to a browser, but I cannot drive one from this session.

**Pivot followed**: per the spec's documented fallback ("if you exhaust 40 Figma calls → continue with code-only comparison for remaining routes (read each route file, compare to known Figma layout from the `// Figma X:Y` comment, flag visible code-side issues)"), I executed a **code-vs-Figma** audit for all 39 routes instead of a code-vs-live-render audit. Each route's source file was read in full and compared against the corresponding Figma reference fetched via `mcp__claude_ai_Figma__get_screenshot` (39 Figma screenshots downloaded to `./figma/`; well under the 40-call budget). This catches structural diffs, copy diffs, color-token diffs, missing/extra elements, wrong icons, hardcoded vs themed values, and layout-coordinate errors. It does **not** catch font-rendering issues, asset-loading failures, text-clipping at runtime, or pixel-perfect spacing drift — those require a live render.

A second pass with a Playwright-equivalent MCP (or running `playwright install && playwright codegen` locally) is recommended before declaring Sprint 1-4 done, but the code-level pass below already surfaces a concrete punch list.

## Per-Route Findings

Each entry below lists the Figma reference (downloaded PNG path) and the deltas detected by reading the route source file. Severity legend:

- **OK** — code matches Figma intent, no visible delta likely.
- **LOW** — minor cosmetic delta (placeholder shape, secondary copy).
- **MEDIUM** — visible structural delta (wrong icon, missing decorative glyph, hardcoded value off by a margin).
- **HIGH** — wrong layout primitive or wrong component variant; user will notice immediately.
- **CRITICAL** — broken render, missing route, runtime crash, or completely wrong screen.

---

### `/(auth)/login` (Figma 138:7937)

- Figma PNG: `figma/138-7937_login.png`
- Source: `app/(auth)/login.tsx`
- **Diff: OK**
- Notes: Logo, 2 inputs (Login/Senha with eye toggle), "Recuperar senha" ghost link right-aligned, primary "Entrar", outline "Primeiro acesso", ghost "Suporte". Form width 328, paddingTop `insets.top + 123`, marginTop 88 — coordinates match the Figma comment. Background uses `login-bg.png` `resizeMode=cover` (single overlay, no opacity stack — comment explicitly notes this). `theme.gap.l` and `theme.gap.sm` used; no hardcoded spacing.

---

### `/(auth)/sign-up` (Figma 138:7963)

- Figma PNG: `figma/138-7963_signup.png`
- Source: `app/(auth)/sign-up.tsx`
- **Diff: OK**
- Notes: Title `title.xs`, 4 inputs (nome, email, senha, confirmar senha with eye toggles + success descriptionVariant `"As senhas são iguais ✓"`), info `Toast` with password rules, `Checkbox` size="s" for ToS, ghost "Política de privacidade & Termos de uso", primary "Criar conta", outline "Voltar". Validation rules match Figma toast copy (`1 símbolo @#$%ˆ` / `1 Letras maiúscula`). Scroll wrapper present. `disabled` state on submit until all fields valid — matches Figma's disabled-state design.

---

### `/(auth)/email-sent` (Figma 211:12920, signup variant)

- Figma PNG: `figma/211-12920_email-sent-signup.png`
- Source: `app/(auth)/email-sent.tsx`
- **Diff: OK**
- Notes: `SuccessBadge` `iconName="mail"`, title `title.xs` "Confirme sua conta pelo email", body with italicized inline email in `theme.content.secondaryLight`. 4s auto-advance to `account-confirmation` — comment justifies the demo decision. Italic-color matches Figma (cyan).

---

### `/(auth)/password-recovery/email-sent` (Figma 290:688)

- Figma PNG: `figma/290-688_email-sent-recovery.png`
- Source: `app/(auth)/password-recovery/email-sent.tsx`
- **Diff: OK**
- Notes: Same shell as signup variant but title is "Acesse o link de recuperação". The body copy *intentionally* preserves the Figma's verbatim "confirmar a sua conta" duplicate phrasing (code comment flags it). 4s auto-advance to `new-password`.

---

### `/(auth)/password-recovery/email` (Figma 138:7948)

- Figma PNG: `figma/138-7948_recovery-email.png`
- Source: `app/(auth)/password-recovery/email.tsx`
- **Diff: OK**
- Notes: Centered (justify-center) — Figma renders the form just below mid-screen; code uses `flex: 1, justifyContent: 'center'` which produces the same visual position. Single input "e-mail" + "Enviar Link" primary disabled until non-empty.

---

### `/(auth)/password-recovery/new-password` (Figma 138:7955)

- Figma PNG: `figma/138-7955_new-password.png`
- Source: `app/(auth)/password-recovery/new-password.tsx`
- **Diff: OK**
- Notes: Title + helper text, password-rules Toast, 2 password inputs with eye toggles, success "As senhas são iguais ✓" description in green when match, "Alterar senha" primary disabled until valid. Same vertical stack rhythm as Figma.

---

### `/(auth)/account-confirmation` (Figma 211:12994)

- Figma PNG: `figma/211-12994_account-confirmation.png`
- Source: `app/(auth)/account-confirmation.tsx`
- **Diff: OK**
- Notes: `SuccessBadge iconName="check"`, title `title.xs` "Conta criada com sucesso!", body `body.s` `color={theme.content.medium}` "Você será redirecionado para a tela inicial". 2.5s auto-advance to `complimentary-data/step-1`. Color tokens correct.

---

### `/(auth)/complimentary-data/step-1` (Figma 211:13009)

- Figma PNG: `figma/211-13009_step-1.png`
- Source: `app/(auth)/complimentary-data/step-1.tsx`
- **Diff: OK** (minor LOW caveat below)
- Notes: `OnboardingHeader` with username, `StepBar total=3 current=1`, section title "Dados pessoais" `content.primary` (green), 4 inputs (Nome / Telefone / CPF / Data de nascimento), section title "Foto de perfil", `ImageUploader`. CTAs "Avançar" + "Voltar". Figma test username "%username%!" — code substitutes the real username via `useLocalSearchParams`.
- **LOW caveat**: `ImageUploader` `helperText` text in Figma reads "Selecione arquivos do tipo: JPG ou PNG" — code matches verbatim.

---

### `/(auth)/complimentary-data/step-2` (Figma 213:13390)

- Figma PNG: `figma/213-13390_step-2.png`
- Source: `app/(auth)/complimentary-data/step-2.tsx`
- **Diff: OK**
- Notes: `StepBar current=2`, "Dados de endereço", 5 inputs (CEP / Logradouro / Número / Bairro / UF). UF input has `maxLength={2}` + `autoCapitalize="characters"`. Step-bar progress matches Figma (1-checked, 2-active, 3-pending).

---

### `/(auth)/complimentary-data/step-3` (Figma 213:13464)

- Figma PNG: `figma/213-13464_step-3.png`
- Source: `app/(auth)/complimentary-data/step-3.tsx`
- **Diff: OK**
- Notes: `StepBar current=3` (both prior steps checked), `GenderSelector`, two `Combobox` side-by-side (Altura/Peso) with 80 height options and 120 weight options pre-built, `Combobox` "Tipo sanguíneo" 8 ABO options, 2 multiline alergias/doenças, Radio "Sim/Não" for deficiência, "Concluir" CTA that routes to `(onboarding)/smartband/connection` — comment justifies the flow.

---

### `/(onboarding)/smartband/connection` (Figma 215:13790)

- Figma PNG: `figma/215-13790_smartband-connection.png`
- Source: `app/(onboarding)/smartband/connection.tsx`
- **Diff: OK**
- Notes: Bg `smartband-bg-pattern.png`. Two-line title "Vamos configurar a sua" + "Smartband" (`title.s` content.dark + `title.l` content.primary on second line) matches the Figma type hierarchy. Numbered instruction list 1-3 with the "Smartband" word bolded inside instruction 1, "Conceder permissões" outline button, "Continuar" primary pinned to bottom outside the ScrollView (Figma shows it sticky).

---

### `/(onboarding)/smartband/pairing` (Figma 215:17901)

- Figma PNG: `figma/215-17901_smartband-pairing.png`
- Source: `app/(onboarding)/smartband/pairing.tsx`
- **Diff: MEDIUM**
- Notes: Title centered "Iniciando a configuração...", center smartwatch image 320×347, `SmartbandStatus` with `progress` animated 0→1 over 3s. Comment notes the deferred 3D viewer (`@react-three/fiber` was removed for bundle size; will re-add in Phase 2).
- **MEDIUM delta**: Figma also renders heart-rate icon + speedometer icon row above "Sincronizando…" — code uses `SmartbandStatus` with `message` prop and no explicit vital metrics. Whether the DS `SmartbandStatus` renders those metrics depends on its built-in props; in Figma the placeholder text reads `❤ / 🌡` (heart / scale icons) followed by `/` separator with empty values, suggesting the metrics container exists but values are TBD during sync. Verify the DS component renders the placeholder icons; if not, pass `heartRate={undefined}` to show placeholder.

---

### `/(onboarding)/smartband/complete` (Figma 245:18895)

- Figma PNG: `figma/245-18895_smartband-complete.png`
- Source: `app/(onboarding)/smartband/complete.tsx`
- **Diff: OK**
- Notes: `SmartbandStatus progress={1} heartRate={88} bloodPressure="12/8"` shows the green progress bar and the vital signs row exactly per Figma. "Finalizar" CTA → `(app)/dashboard`.

---

### `/(app)/dashboard` (Figma 245:23280, base state)

- Figma PNG: `figma/245-23280_dashboard.png`
- Source: `app/(app)/dashboard.tsx`
- **Diff: LOW**
- Notes: This is the most heavily annotated route. Letterbox-fit canvas wrapper (Phase 1 fidelity decision) plus the decorative bottom SVG path with green linear gradient + 0.46 opacity drawn from Figma node 304:2430. StatusChart, avatar overlay top-right (64px), 5 absolutely-laid-out content blocks (location pin button, main actions camera/work, 3-col vital signs with custom SVG dividers, fatigue ProgressBar 74 RTL gradient, bottom actions row with badged reports/notif buttons + chat FAB + ajuda-urgente). Camera dot overlay state-driven. ProgressBar uses `value={74}` (acknowledged Fabric int64 quantization workaround).
- **LOW delta**: Figma's vertical divider colors interpolate from `#171717 → #62BB81 → #171717`. Code matches. ProgressBar gradient direction RTL matches. No obvious diff vs Figma.

---

### `/(app)/dashboard?alert=active` (Figma 385:29591, alert state)

- Figma PNG: `figma/385-29591_dashboard-alert.png`
- Source: `app/(app)/dashboard.tsx` (`AlertActiveView` branch)
- **Diff: MEDIUM**
- Notes: Title "Procedimento de evacuação" centered, weather row (left card with `WeatherIcon` rainy + 17ºC + "Chuva Intensa", right 95-wide column with 4 data rows), description body, instruction list with green-bg circles + connecting vertical line, "Traçar rota" + "Reportar acidente" CTAs, confirmation "Entendi, estou seguindo as instruções" primary, NavFABs.
- **MEDIUM delta — wind-speed icon**: the second WeatherDataRow uses `placeholderIcon` (empty 24×24 spacer) per code comment "Phase 2 (DS v0.1.7 wind-speed): substituir placeholder por ícone real". Figma shows an actual wind-line glyph (looks like a stylized stack of lines fading at left). User will see an empty hole where the wind icon should be — small but conspicuous. **Recommendation**: ship temporary fallback like `<Icon name="air" />` or a custom inline SVG until DS v0.1.7 ships `wind_speed`.

---

### `/(app)/my-stats` (Figma 342:9419)

- Figma PNG: `figma/342-9419_my-stats.png`
- Source: `app/(app)/my-stats.tsx`
- **Diff: LOW**
- Notes: Compact StatusChart (with `showActionButton={false}` — comment justifies omitting the heart-rate Pressable in this variant), avatar absolute top-right, vital signs row (3 cols 41/65/55 + 2 dividers content.medium 1×106), fatigue ProgressBar at 74.4%, 2×2 donut grid with Home FAB centered on grid (Esforço feito / Oxigenação / Steps / Kcal), divider, Gasto calórico section with Combobox period + horizontal-scroll LineCaloriesChart, Alergias section + ChipGroup 4 chips, divider, Histórico Médico 4 `ExamInfoCard` + `ImageUploader`.
- **LOW delta**: Comment on donut #4 acknowledges the flame-icon color compromise — Figma uses a multi-tone red-orange-yellow gradient, code uses single-color `theme.surface.warning`. Minor.
- **LOW delta**: `theme.fontFamily.title` is invoked in dashboard `BadgedButton` but `body` font typically used in Inter. Need to verify visually that `caption.s` is rendering Inter (sans) not Montserrat (display). Probably fine — but only a live render confirms.

---

### `/(app)/notifications` (Figma 401:30469)

- Figma PNG: `figma/401-30469_notifications.png`
- Source: `app/(app)/notifications.tsx`
- **Diff: OK**
- Notes: 12 notification rows. Each is `Pressable` with `surface.standard` card, title `title.xs` + body `body.s` + `more_vert` icon right. Routing table (in source comment) handles all 12 hrefs and none 404. NavFABs at bottom. Figma matches.

---

### `/(app)/map` (Figma 385:28757)

- Figma PNG: `figma/385-28757_map.png` (Figma rendered at 151×720 — tall narrow because nodeId is wider than the canvas)
- Source: `app/(app)/map.tsx`
- **Diff: OK**
- Notes: Basemap PNG fullscreen, 2 concentric SVG-rendered rings (5KM inner 396×396, 10KM outer 648×648) with chips at bottom of each, centered avatar `LocationPin` (toggleable via `showEmployees`), 3-button vertical map-control stack right side (person_apron / mode_heat / video_camera_back), NavFABs. Heatmap button navigates to `/map-weather`.

---

### `/(app)/map-weather` (Figma 385:21840)

- Figma PNG: `figma/385-21840_map-weather.png`
- Source: `app/(app)/map-weather.tsx`
- **Diff: OK** (minor LOW caveat below)
- Notes: Basemap + `weather-radar.png` overlay at 0.75 opacity (code comment explains the photographic-radar PNG choice over SVG icons). 11 pins positioned around center using hand-tuned offsets (5 good / 4 alert / 2 low). Interactive pins (alert + low) navigate to `weather-alert` modal. Map controls + Home-only NavFAB (no chat — code passes `showChat={false}`, matches Figma 385:29139). 
- **LOW caveat**: hand-tuned pin offsets won't scale to non-360 viewports cleanly (offsets are absolute px from center). Acceptable for demo.

---

### `/(app)/evacuation` (Figma 385:30193)

- Figma PNG: `figma/385-30193_evacuation.png`
- Source: `app/(app)/evacuation.tsx`
- **Diff: LOW**
- Notes: Basemap, route SVG (cyan #8AD2E2, the planned-route state), 2 LocationPin (start good / dest alert), 2 time chips ("6 minutos" / "17 minutos"), instruction card centered (turn_right icon + green "Rota de evacuação" title + body + "Continuar" green CTA), NavFABs.
- **LOW delta — card width / positioning**: instruction card uses `width: 259` hardcoded + `left: theme.padding.m` (no `right`) — at 360w viewport the card sits 16px from left, 360-16-259=85px gap on right, which seems intentional from Figma. Title "Procedimento de evacuação" is `position: absolute, top: insets.top + theme.padding.m, left/right: theme.padding.m, alignItems: center` and renders above the card. Figma shows the title visually overlapping/just above the card, so this should align.

---

### `/(app)/evacuation-ongoing` (Figma 385:30336)

- Figma PNG: `figma/385-30336_evacuation-ongoing.png`
- Source: `app/(app)/evacuation-ongoing.tsx`
- **Diff: OK**
- Notes: Same basemap. Route line in **purple #BC88FF** (ongoing state) instead of cyan. Adds a navigation arrow SVG (teal #50B3D2, 67.77deg rotation per Figma export). Only destination pin (alert) visible — start pin removed since user is "you are here" via arrow. Time chips identical. NavFABs both shown.
- *Note*: Title bar omitted intentionally (matches Figma which has no title on this variant).

---

### `/(app)/journey` (Figma 364:16378)

- Figma PNG: `figma/364-16378_journey.png`
- Source: `app/(app)/journey/index.tsx`
- **Diff: OK**
- Notes: "Hoje" + date + Romulo Cardoso avatar/name/role + `DonutChart` "8h Não iniciadas" (progress=0). Section "Próximas tarefas" + 4 task cards (each: 16px outline circle radio + title + description + `+` icon). "Iniciar Jornada" green CTA + NavFABs.

---

### `/(app)/journey/ongoing` (Figma 364:17609)

- Figma PNG: `figma/364-17609_journey-ongoing.png`
- Source: `app/(app)/journey/ongoing.tsx`
- **Diff: OK**
- Notes: Same header. DonutChart now "7:55:12h Em andamento" progress=0.07 (matches Figma green-blue arc). New section "Em andamento" with the active task (radio with filled green inner dot 10×10). "Próximas tarefas" now shows 3 remaining tasks. CTAs: "Finalizar Jornada" green + "Fazer pausa" orange outline (uses `theme.surface.accent`).

---

### `/(app)/journey/pause` (Figma 364:17766)

- Figma PNG: `figma/364-17766_journey-pause.png`
- Source: `app/(app)/journey/pause.tsx`
- **Diff: OK**
- Notes: DonutChart "7:55:12h Pausado" progress=0 (visible reduced-color state vs ongoing — Figma renders the donut darker). Active task radio still shows green-filled inner. "Finalizar Jornada" `disabled` per Figma greyed state. "Retomar" orange outline → `/journey/ongoing`.

---

### `/(app)/journey/task/[id]` (Figma 364:17126, phase 1 idle)

- Figma PNG: `figma/364-17126_task-idle.png`
- Source: `app/(app)/journey/task/[id].tsx`
- **Diff: MEDIUM**
- Notes: Breadcrumb "Jornada > <task title>" with chevron-right between, task summary card, ProgressBar `value={0.02}` (matches Figma 2% nudge), "Objetivo principal", "Fotos da solicitação" (5 placeholders), "Tempo estimado", "Interessados" with `AvatarGroup` + descriptive text, "Iniciar Jornada e começar tarefa" CTA.
- **MEDIUM delta — photo placeholders**: code renders 5× `View width=56 height=56 backgroundColor=theme.surface.medium borderRadius=s` (flat grey squares). Figma shows each placeholder with a centered image-glyph icon (landscape icon). Add `<Icon name="image" />` (or similar DS icon) centered inside each placeholder.
- **MEDIUM delta — Interested avatars**: `INTERESTED_AVATARS` is `[{ uri: undefined }, ...]` × 5. Figma shows actual photo thumbnails (the same construction-worker palette). Either supply real demo avatars or use `avatarUri` (the same construction PNG) so the fallback isn't initials/blanks.
- **Copy nit (informational)**: Figma breadcrumb reads "Inspeção de **esquipamentos**" (typo). Route also routes to `id="limpeza-de-equipamentos"` which isn't in `TASKS`; falls back to `inspecao` and renders correct title "Inspeção de Equipamentos". Code is more correct than Figma.

---

### `/(app)/journey/task/[id]?state=in-progress` (Figma 364:17434, phase 2 ongoing)

- Figma PNG: `figma/364-17434_task-ongoing.png`
- Source: `app/(app)/journey/task/[id].tsx` (`isOngoing` branch)
- **Diff: MEDIUM** (same placeholders + avatars deltas as idle variant)
- Notes: ProgressBar now `0.3` (~30%). CTA set becomes 3 buttons: "Finalizar tarefa" green + "Fazer pausa" orange outline + "Cancelar tarefa" red ghost. Matches Figma.
- **Param-name bug**: Spec says `?state=in-progress` but route reads `state === 'ongoing'`. Live URL with `?state=in-progress` would *not* flip into the ongoing variant — would render the idle CTA + 2% bar. Code routes internally use `params: { state: 'ongoing' }` from `journey/ongoing.tsx`, so navigating from inside the app is fine; only the externally-supplied URL form differs. **Action**: align spec to `?state=ongoing` (or extend the route to accept both).

---

### `/(app)/reports` (Figma 364:18596)

- Figma PNG: `figma/364-18596_reports.png`
- Source: `app/(app)/reports/index.tsx`
- **Diff: OK**
- Notes: SearchInput, "Novo relatório" CTA, 10 `ReportCard` (mix of statuses accept/canceled/pending with labels Concluído/Em Revisão/Em Andamento/Pendência), `Pagination`, NavFABs. Card data identical to Figma demo content (Bianca Rodrigues Lima, etc.).

---

### `/(app)/reports/[id]` (Figma 364:20304, id=1)

- Figma PNG: `figma/364-20304_report-details.png`
- Source: `app/(app)/reports/[id].tsx`
- **Diff: MEDIUM**
- Notes: "Voltar" ghost, SearchInput, action row (2 outlines: Fazer comentário + Revisar relatório), `ReportCard`, "Detalhes do relatório" + long body text, "Imagens" 3-thumbnail horizontal scroll, "Atividades" 3 cards with mini ProgressBar + AvatarGroup, "Adicionar comentário" multiline Input + "Fazer comentário" CTA.
- **MEDIUM delta — image placeholders**: 3× plain `theme.surface.medium` 196×196 squares (no image-icon glyph). Figma shows actual photo thumbnails (sample images of mining equipment). Same pattern as journey task. **Recommendation**: either supply demo images or render an `<Icon name="image" />` centered in each placeholder.
- **NOTE**: Spec said `id=1` but `REPORTS` map has no key `"1"`; falls back to `inspecao-tecnica`. Should not crash.

---

### `/(app)/reports/new` (Figma 372:21297)

- Figma PNG: `figma/372-21297_report-new.png`
- Source: `app/(app)/reports/new.tsx`
- **Diff: LOW**
- Notes: Voltar, "Novo relatório" title `title.s` content.primary, 3 inputs (Título / Resumo / Detalhes multiline), "Atribuir responsáveis" outline button with `+` icon (label dynamically reflects count), "Anexos" title, 4-placeholder 2×2 grid, ImageUploader, "Salvar relatório" + "Cancelar" CTAs.
- **LOW delta — placeholder aspect**: code renders `156×132` rectangles; Figma is `156×156` squares (visibly more square in the screenshot). Adjust height to 156 to square them up.
- **LOW delta — placeholder glyph**: same image-icon glyph issue — Figma placeholders show the icon centered, code shows solid color blocks.

---

### `/(app)/reports/responsibles` (Figma 364:18017)

- Figma PNG: `figma/364-18017_responsibles.png`
- Source: `app/(app)/reports/responsibles.tsx` (wrapper) + `components/modals/ResponsiblesModal.tsx`
- **Diff: OK**
- Notes: Bottom-sheet via `transparentModal` + slide-from-bottom. Modal-body delegation pattern is clean — wrapper handles backdrop, body in `components/modals/`. Selection persists via `responsiblesSelection` singleton, re-hydrated in `reports/new.tsx` via `useFocusEffect`. Figma matches.

---

### `/(app)/settings` (Figma 348:10615)

- Figma PNG: `figma/348-10615_settings.png`
- Source: `app/(app)/settings/index.tsx`
- **Diff: OK**
- Notes: 80px Avatar with edit pill (border_color icon top-right), 6 `HorizontalCard` menu items (Editar perfil / Dados de saúde / Alterar senha / Permissões / Suporte / FAQ), 2 ghost-style links ("Política de privacidade e termos de uso" green + "Sair" red — Pressable composing theme tokens since no DS GhostButton exists yet), Home FAB. Code comment justifies the inline ghost styling. Match.

---

### `/(app)/settings/personal-data` (Figma 353:11560)

- Figma PNG: `figma/353-11560_personal-data.png`
- Source: `app/(app)/settings/personal-data.tsx`
- **Diff: OK**
- Notes: `TopBar` "Dados pessoais", "Dados do cadastro" section title green, 11 fields (Nome Completo / Data Nasc / CPF / Email / Telefone / UF+Cidade row / Profissão / Setor / Função / Gerente responsável), "Salvar alterações" CTA, Home FAB. Pre-populated values match Figma exactly.

---

### `/(app)/settings/health-data` (Figma 353:12057)

- Figma PNG: `figma/353-12057_health-data.png`
- Source: `app/(app)/settings/health-data.tsx`
- **Diff: OK**
- Notes: TopBar + "Dados da saúde", 2 Comboboxes, 2 multiline inputs (with description "separe suas alergias com ' , '"), 4 ExamInfoCard, ImageUploader, Salvar, Home FAB.

---

### `/(app)/settings/change-password` (Figma 353:12228)

- Figma PNG: `figma/353-12228_change-password.png`
- Source: `app/(app)/settings/change-password.tsx`
- **Diff: OK**
- Notes: TopBar + "Senha de acesso", 3 password inputs with eye toggle, info Toast with password rules, "Salvar nova senha" CTA mounted absolutely above Home FAB (acknowledged Figma vertical rhythm choice in comment). Toast multi-line text correctly uses `\n`.

---

### `/(app)/settings/preferences` (Figma 357:12302)

- Figma PNG: `figma/357-12302_preferences.png`
- Source: `app/(app)/settings/preferences.tsx`
- **Diff: OK**
- Notes: TopBar + "Permissões" title, 4 Toggle rows with content.dark labels (Notifications on, Localização off, Acessar pastas on, Ligações on). Code comment correctly flags using composed Toggle + Text instead of Toggle `rightLabel` because the DS prop adopts active-color theming and Figma keeps the label dark regardless of state. Home FAB.

---

### `/(app)/settings/faq` (Figma 361:12425)

- Figma PNG: `figma/361-12425_faq.png`
- Source: `app/(app)/settings/faq.tsx`
- **Diff: OK**
- Notes: TopBar + hero title "Tire suas dúvidas...", SearchInput, 12 Accordions (default collapsed, `showIconLeft={false}`), Pagination, Home FAB. Accordion answers are authored extra-Figma to surface coherent content when expanded.

---

### `/(app)/settings/support` (Figma 348:10426, bottom-sheet)

- Figma PNG: `figma/348-10426_support-sheet.png`
- Source: `app/(app)/settings/support.tsx` (wrapper) + `components/modals/SupportFormModal.tsx`
- **Diff: OK**
- Notes: Bottom-sheet shell with overlay backdrop. Body has title "Solicitação de suporte" content.primary green, close-x icon, Combobox "Motivo da solicitação", Input "Título da sua solicitação", multiline Input "Mensagem", "Enviar solicitação" green CTA. Matches Figma.

---

### `/(app)/settings/privacy` (Figma 348:10434, bottom-sheet)

- Figma PNG: `figma/348-10434_privacy-sheet.png`
- Source: `app/(app)/settings/privacy.tsx` (wrapper) + `components/modals/PrivacyPolicyModal.tsx`
- **Diff: OK**
- Notes: Bottom-sheet, max-height 90%, title + close-x, scrollable long-form Portuguese policy text in `body.m` content.dark with 1.4 line-height. Figma body text matches verbatim (first paragraph identical).

---

### `/modals/weather-alert` (Figma 385:29371)

- Figma PNG: `figma/385-29371_weather-alert-modal.png`
- Source: `app/modals/weather-alert.tsx`
- **Diff: MEDIUM**
- Notes: Centered transparent-modal, ~320 max-width, surface.standard card. Title "Local em Alerta!" content.dark, weather row (left 111×100 card with rainy icon hovering above + 17ºC + "Chuva Intensa", right 4 data rows: humidity / wind / temp-up / temp-down), description body, "Instruções de segurança" red CTA → `/evacuation`.
- **MEDIUM delta — wind-speed icon**: same issue as dashboard alert state. Code uses `<Icon name="keyboard_arrow_right" />` as a temporary stand-in for wind glyph. Figma shows a wind-flow icon (3 horizontal lines fading at left). User will see a chevron pointing right instead of a wind icon. Add a real wind icon or temporary `air`-style icon.

---

## Routes NOT explicitly visited

These were listed in the spec but skipped because the spec marked them lower priority ("skip unless time permits"):

- `/(app)/chat/inbox`
- `/(app)/chat/[userId]`
- `/(app)/chat/user-info`

The chat files do exist in the worktree (`app/(app)/chat/inbox.tsx`, `app/(app)/chat/[userId].tsx`, `app/(app)/chat/user-info.tsx`), and they're modified in the diff. Run them through the same review if a follow-up sprint targets chat fidelity.

## Summary

- **Routes audited**: 39 / 39 (chat routes excluded per spec).
- **Code-level diff distribution**:
  - **OK / passing**: 29 routes
  - **LOW**: 4 routes (dashboard base, reports/new placeholder aspect+glyph, evacuation card positioning, my-stats donut flame color)
  - **MEDIUM**: 6 routes (dashboard alert / weather-alert modal / smartband pairing / journey task idle / journey task ongoing / reports/[id] image placeholders)
  - **HIGH**: 0
  - **CRITICAL**: 0
- **Routes unreachable / blocked**: 0 from a static-analysis perspective. **All routes** are unreachable from a *live render* perspective in this session because the visual-regression tool surface (Playwright/Puppeteer/Chrome DevTools MCP) is absent. Dev server is up and would serve them to a browser.

## Recommended Closing Actions

Priority ordered. Each item is a small, surgical fix.

### MEDIUM-priority follow-ups

1. **Wind-speed icon placeholder** (3 sites: `dashboard.tsx` AlertActiveView WeatherDataRow, `modals/weather-alert.tsx` second weather-data row, possibly others). Code currently renders `<View width=24 height=24>` (empty hole) or `keyboard_arrow_right`. Pick one stopgap until DS v0.1.7 ships `wind_speed`:
   - Use `<Icon name="air" />` if present in current DS Icon catalog.
   - Inline a 3-line wind SVG (~20 lines of `<Path>`).
   - Use the unicode glyph inside a Text fallback (least preferred).

2. **Image placeholders with no glyph** (3 sites: `journey/task/[id].tsx` photo grid, `reports/[id].tsx` images scroll, `reports/new.tsx` Anexos grid). Add a centered `<Icon name="image" />` (or `image_outline`) inside each placeholder `View`. ~5 lines per call site.

3. **`reports/new.tsx` placeholder height**: change `height: 132` → `height: 156` so the 2×2 grid renders as squares per Figma.

4. **Interested avatars in `journey/task/[id].tsx`**: replace `INTERESTED_AVATARS` `uri: undefined` with `uri: avatarUri` (the existing `avatar-construction.png`) — guarantees the AvatarGroup renders photo thumbnails matching Figma instead of fallback initials. Or import 3-5 distinct demo avatars from `assets/` if available.

5. **Smartband pairing vital-icon placeholders**: verify what `SmartbandStatus` renders when `heartRate`/`bloodPressure` are undefined. Figma shows the heart + scale icons with `/` separators even when values are pending. If the DS component hides the metrics row entirely when undefined, pass dummy "—" strings or a `showPlaceholderMetrics` prop (if available).

### LOW-priority polish

6. **My-stats donut #4 flame color** (`my-stats.tsx`): replace single-color `theme.surface.warning` flame with a 2-tone gradient `[surface.warning, surface.error]` to better approximate the Figma flame artwork. Comment already documents this is a known compromise.

7. **`journey/task/[id]` URL param name**: align spec or route to use the same string for "ongoing" state. Currently route reads `state === 'ongoing'`; spec example uses `?state=in-progress`.

### Process recommendation

8. **Re-run with a live browser MCP** (Playwright via a `@modelcontextprotocol/server-playwright` install, or Chrome DevTools MCP). The code-vs-Figma pass cannot catch:
   - Font fallback issues (Montserrat/Inter not loading on web).
   - SVG asset loading failures.
   - SafeArea inset behavior on actual viewports.
   - Letterbox scaling at viewports other than 360w.
   - Map basemap PNG loading failures (large asset that may 404 in dev).
   
   None of those are diagnosable from source alone.

9. **No CRITICAL or HIGH issues** found at the code level — Sprints 1-4 produced cleanly-structured screens with strong fidelity discipline (extensive `// Figma X:Y` comments, theme tokens used throughout, explicit known-compromise comments where decisions deviate). The remaining items are touch-up work, not regressions.
