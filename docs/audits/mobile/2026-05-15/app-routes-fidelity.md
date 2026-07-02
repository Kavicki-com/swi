# (app) Routes — Figma Fidelity Audit (2026-05-15)

**Scope:** authenticated `(app)/*` routes in `mobile/`.
**Figma reference:** file `bzDUuPdSiKgl5xucBH0IYE` ("SWI - UI").
**Stack:** React Native + Expo Router + `@kavicki/swi-design-system` v0.1.44 + `useTheme()`.
**Mode:** read-only — fixes to be executed in a follow-up session.

Audit method: per-route review of the source file (`// Figma X:Y` anchors in code map directly to Figma node IDs). DS-vs-bespoke patterns, hardcoded color/font/dimension literals, missing copy/icons, wiring stubs, and already-documented deferrals are surfaced for each screen.

> **Recurring patterns observed across the whole `(app)` tree** — these will be called out per-route as well but are worth flagging up front because they affect almost every screen:
>
> 1. **`<RNText style={{ fontFamily: theme.fontFamily.X, fontWeight: theme.fontWeight.Y, fontSize: theme.fontSize.Z, color: theme.content.W }}>`** is used in place of DS `<Text>`/`<Title>`. Tokens are still wired, but the DS primitive is bypassed. Repeated in `alert-instructions`, `notifications`, `journey/*`, `reports/*`, `evacuation*`, `settings/health-data`, `settings/preferences`, `settings/privacy`, `map`, and `chat/[userId]`.
> 2. **Chat FAB / Home FAB are duplicated inline in 11 screens** (dashboard, alert-instructions, my-stats, notifications, map, map-weather, evacuation, evacuation-ongoing, journey/index, journey/ongoing, journey/pause, reports/index, settings/*). Same `<Button shape="pill" size="xlarge" backgroundColor={theme.content.dark} borderWidth={10} …>` block copy-pasted. Strong candidate for a `ChatFab` / `HomeFab` compose-local pair or DS primitive.
> 3. **Pagination block** (4 ghost number buttons + ghost `...` + contained chevron-right) is duplicated verbatim in `reports/index.tsx` and `settings/faq.tsx` with identical 7.4×12 icon dimensions. Same: extract.
> 4. **Bespoke radio "circle" affordance** (`width:16 height:16 borderRadius:8 borderWidth:1.5 borderColor:theme.content.dark` + optional inner dot) is duplicated in `journey/index.tsx`, `journey/ongoing.tsx`, and `journey/pause.tsx` — DS `RadioGroup`/`Radio` should be used or the affordance promoted.
> 5. **`shadowColor: '#1D1D1D'`** is repeated raw across `notifications.tsx`, `map.tsx`, `map-weather.tsx`, and `evacuation.tsx` as part of a card-elevation shadow style. The hex matches `theme.content.dark` (Inter dark token) — should be `theme.content.dark`.

---

## Dashboard & alert flow

### `app/(app)/dashboard.tsx` — Figma 245:23280 + 385:29138

**DS usage**
- `StatCol`, `Divider`, `BadgedButton` are local helpers that compose DS primitives (`Icon`, `Text`, `Button`). Documented as "compose-local" by the file header — acceptable until DS ships an equivalent. `Divider` SVG with gradient is a custom artwork node (Figma 295:1585), reasonable as compose-local.

**Hardcoded tokens**
- `BG_DECOR_PATH` decorative SVG hardcodes `#3BC958` (top) and `#1E652C` (bottom) — direct Figma colors, not in `theme.*`. Documented intent: "vertical linear gradient from #3BC958 to #1E652C" (Figma 304:2430). MEDIUM (theme lacks these brand variants).
- `Divider` SVG hardcodes `#171717` and `#62BB81` (Figma 295:1585 gradient stops). Same story.
- Status dot for camera uses `borderWidth: 2` raw (line 226). Minor.
- Stat columns use raw `width={41}`, `{65}`, `{55}` per Figma — acceptable, derived from Figma column widths.
- Bottom action row uses raw `gap: 41` (line 319) — Figma constant, not a theme gap token. LOW.

**Missing fields**
- None apparent vs Figma 245:23280; 385:29138 (alert-active) variant is **not implemented as a state of this file** — alert flow lives in `alert-instructions.tsx` separately. If 385:29138 should be a state of `/dashboard` (red banner / different chart), it is **missing**. CRITICAL if alert state must be reachable from `/dashboard`.

**Layout deviation**
- The whole layout uses an absolute letterbox transform `scale(canvasScale)` on a fixed 360×800 canvas. Documented in code; intentional Phase 1 strategy. Watch for: blur/anti-alias on larger devices, but functional.

**Wiring gaps**
- Camera button is demo-only: `setCameraActive((on) => !on)` toggles the green dot but has no real wire (documented). LOW.

**Deferred gaps (already documented)**
- `dashboard.tsx:27-29` — "TODO: bump DS Avatar to accept `source: ImageSourcePropType` to remove this workaround" (uses `Asset.fromModule().uri`).
- `dashboard.tsx:60-61` — "Demo-only: camera starts on; tapping the camera button toggles the green status dot."
- `dashboard.tsx:292-298` — fatigue progress quirk: `value={74}` instead of `74.4` to avoid Fabric HostFunction precision error (DS v0.1.34 ProgressBar Gap H).

---

### `app/(app)/alert-instructions.tsx` — Figma 385:29591

**DS usage**
- All weather data rows are `<RNText style={{ fontFamily: theme.fontFamily.* … }}>` — should be DS `<Text>` / `<Title>`. ~14 RNText blocks total in this file. MEDIUM.
- Step circles are bespoke `<View>` 20×20 + radius 10 + `theme.surface.primary` (line 24-34); fine as compose-local.
- "Aprox. 7 minutos" chip in step 3 is bespoke `<View>` with manual border/padding. Could be DS `Chip` or `StatusTag`. MEDIUM.

**Hardcoded tokens**
- Step circle `marginTop: 2` (line 32) — eyeball offset, not a theme gap. LOW.
- Vertical step line `top: 10, bottom: 10, width: 1` (lines 142-148) — raw constants. LOW.
- Step rows `gap: 19` (lines 152, 186, 202, 239) — raw Figma constant, not a theme gap. MEDIUM.
- Step 4 inner gap `gap: 12` (line 241). LOW.
- Confirmation block `gap: 15` (line 266). LOW.
- Chat FAB icon `width={25.714} height={25.714}` and Home FAB icon `width={28.286} height={25.458}` — Figma-exact dims, fine.

**Missing fields**
- Wind-speed row uses a 24×24 empty `<View>` placeholder because `wind_speed` icon isn't in DS v0.1.44 (line 379, TODO comment). MEDIUM — visible empty slot.
- Temperature up/down arrows use `keyboard_arrow_up` / `_down` instead of triangular arrows per Figma (file header comment notes this). LOW.

**Layout deviation**
- Title is `Title variant="title.xs"` (Montserrat Bold 16) but Figma 385:29591 title node may be larger — needs Figma cross-ref. Comment claims fidelity, so trust unless visual diff says otherwise.

**Wiring gaps**
- None — all 4 step CTAs wire to real routes (`/evacuation`, `/reports/new`, `/dashboard`, `/chat/inbox`).

**Deferred gaps (already documented)**
- `alert-instructions.tsx:15-16` — "Gaps deferidos pra DS v0.1.7: `wind-speed` (linha de vento omite ícone) e setas triangulares de temperatura (usado `keyboard_arrow_up/down`)."
- `alert-instructions.tsx:105` — "TODO(DS v0.1.7 wind-speed): substituir placeholder por ícone real"
- `alert-instructions.tsx:378` — "TODO(DS v0.1.7): substituir por `<Icon name=\"wind_speed\" />`"

---

### `app/(app)/my-stats.tsx` — Figma 342:9419

**DS usage**
- "Vital signs" 3-column block is fully composed inline (lines 126-232) with raw `<Icon>` + `<Title>` + `<Text>` per column. Same pattern as dashboard's `StatCol` helper — should be deduped (compose-local or DS primitive). MEDIUM.
- Vertical dividers between vital-signs columns are bespoke `<View width:1 height:106 bg:theme.content.medium>` (lines 159-165 + 196-202) — dashboard uses a SVG gradient divider, my-stats uses a flat one. Inconsistent. MEDIUM.
- "Alergias" Editar button uses `Button variant="outline"` with manual `borderWidth="m"`, `backgroundColor=surface.standard`. Fine but verbose.

**Hardcoded tokens**
- `gap: 10` in "Gasto calórico" section (line 366). LOW.
- Vital signs column widths 41 / 65 / 55 — Figma constants, OK.
- Divider height `106` — Figma constant.

**Missing fields**
- "HIstórico Médico" title typo (line 434) — `HIstórico` should be `Histórico`. LOW (typo).

**Layout deviation**
- Donut grid uses `flexWrap: 'wrap'` with `gap.m=16` — Figma expects 156+16+156 = 328 width which matches container. OK.
- Home FAB sits absolute at center of donut grid (`top: 50% / marginTop: -46 / marginLeft: -46`). Intentional per Figma 348:10334. OK.

**Wiring gaps**
- "Editar alergias" button: `onPress={() => { /* TODO: open edit-alergias sheet */ }}` (lines 414-416). MEDIUM (dead button).
- `ExamInfoCard.onActionPress`: `/* TODO: trigger download */` (lines 446-448). MEDIUM.
- `ImageUploader.onPickFile`: `/* TODO: open file picker */` (lines 457-459). MEDIUM.

**Deferred gaps (already documented)**
- `my-stats.tsx:415` — "TODO: open edit-alergias sheet"
- `my-stats.tsx:447` — "TODO: trigger download"
- `my-stats.tsx:458` — "TODO: open file picker"

---

### `app/(app)/notifications.tsx` — Figma 401:30469

**DS usage**
- Notification cards are fully bespoke `Pressable` with manual title/body `<RNText>` (lines 96-147). File header explicitly says "compose-local (DS HorizontalCard sem description)". DS gap. MEDIUM.
- `more_vert` action icon has no menu / sheet wiring (line 138-145). LOW.

**Hardcoded tokens**
- `shadowColor: '#1D1D1D'` (line 108) — should be `theme.content.dark`. MEDIUM.
- `shadowOpacity: 0.08`, `shadowRadius: 8`, `elevation: 2` — raw shadow constants; consider DS elevation token. LOW.
- Body RNText `fontFamily: theme.fontFamily.body` is tokenized but the wrapper RNText should be DS `Text`. MEDIUM.

**Missing fields**
- No empty-state, no read/unread distinction visually — Figma shows all 12 as cards (matches code). OK.

**Wiring gaps**
- Card `onPress={() => {}}` (line 98) — every notification card is a dead button. CRITICAL for demo polish (12 dead taps).
- `more_vert` `onPress={() => {}}` (line 139) — dead. MEDIUM.

**Deferred gaps (already documented)**
- `notifications.tsx:6-8` — "Demo phase: cards estáticos, more_vert icon sem menu real."

---

## Map & evacuation

### `app/(app)/map.tsx` — Figma 385:28757

**DS usage**
- 3 map controls (employee/heatmap/cameras) are bespoke `<Pressable>` with manual `backgroundColor: theme.surface.high` + `borderRadius: theme.border.radius.m` + shadow (lines 151-196). Could be DS `IconButton` or compose-local helper. MEDIUM.
- 5KM / 10KM chips are bespoke `<View>` with `backgroundColor: theme.surface.primary` + raw RNText (lines 73-94, 109-131). Could be DS `Chip` / `StatusTag`. MEDIUM.

**Hardcoded tokens**
- `borderColor: 'rgba(245,245,245,0.5)'` — concentric ring borders (lines 69, 103). Raw rgba (light-surface @ 50%). MEDIUM (theme has no `light + alpha` helper).
- `shadowColor: '#1D1D1D'` (line 24) — should be `theme.content.dark`. MEDIUM.
- Ring geometry: `width: 648`, `width: 396`, `borderRadius: 324`, `borderRadius: 198`, chip `top: 633 / 508 / left: 295` — all Figma constants. Acceptable.
- Chip `paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4` (lines 79-82) — raw constants. LOW.
- Chip RNText uses `fontFamily: theme.fontFamily.body, fontWeight: theme.fontWeight.regular, fontSize: theme.fontSize.m, color: theme.content.light` — should be DS `<Text variant="body.m" color={theme.content.light}>`. MEDIUM.

**Missing fields**
- No basemap label overlays for known landmarks (Figma 385:28757 has a few text labels on roads). LOW — basemap.png is a raster, labels baked in.

**Wiring gaps**
- 3 map controls all `onPress={() => {}}` (lines 152, 167, 182). MEDIUM (dead toggles, documented as demo).

**Deferred gaps (already documented)**
- `map.tsx:14-17` — "Demo phase: basemap estático (basemap.png); sem MapLibre/MapBox real no mobile (no admin sim). Map controls são no-op toggles visuais."

---

### `app/(app)/map-weather.tsx` — Figma 385:21840

**DS usage**
- Same 3-button map-control row as `map.tsx`, fully duplicated (lines 87-140). Strong dedup target.
- 11 pins use DS `LocationPin variant="badge"` — DS usage correct.

**Hardcoded tokens**
- `shadowColor: '#1D1D1D'` (line 43) — should be `theme.content.dark`. MEDIUM.
- Pin offsets are raw px values from a magic origin (lines 27-40). Documented; OK for demo.

**Missing fields**
- File header explicitly: "basemap.png como background (weather-radar artwork do Figma deferred — bytes não disponíveis no asset bundle)" — the actual weather-radar overlay (heatmap of rain) is MISSING. Should be a translucent rasterized overlay. MEDIUM (visible deviation vs Figma 385:21840).

**Layout deviation**
- Pin clustering is hand-tuned; pin positions don't match Figma 1:1. LOW (demo phase, looks plausible).

**Wiring gaps**
- "Empregados no mapa" + "Câmeras" controls `onPress={() => {}}` (lines 96, 126). MEDIUM.
- "Heatmap" control wires to `/(app)/map` (the general map, not a heatmap state) — semantically odd. MEDIUM.

**Deferred gaps (already documented)**
- `map-weather.tsx:14-17` — "Demo phase: basemap.png como background (weather-radar artwork do Figma deferred — bytes não disponíveis no asset bundle)."

---

### `app/(app)/evacuation.tsx` — Figma 385:30193

**DS usage**
- Instruction card is bespoke `<View>` with `width: 259`, manual padding, manual shadow (lines 119-176). Should be DS `Card` or compose-local helper. MEDIUM.
- Time chips ("6 minutos" / "17 minutos") are bespoke `<View>` + `<RNText>` (lines 71-117). Could be DS `Chip` / `StatusTag`. MEDIUM.

**Hardcoded tokens**
- `shadowColor: '#1D1D1D'`, `shadowOpacity: 0.16`, `shadowRadius: 8`, `elevation: 4` (lines 136-140) — duplicated shadow. MEDIUM.
- Card `borderRadius: 16` — raw constant; should be `theme.border.radius.m` (likely 16). LOW.
- Card `width: 259` (line 130) — Figma constant.
- Instruction title uses `color: theme.content.success` (line 149) — `content.success` may not be the canonical green for headers; cross-check with Figma. LOW.
- 3 RNText blocks with manual font/weight/size — should be DS `Text`/`Title`. MEDIUM.
- Pin/chip positions `top: '55%' / left: '40%' / translateX: -20 / translateY: -20` — magic numbers; documented as demo placement.

**Missing fields**
- File header: "route line SVG omitida (Phase 2)" — the green dotted route between start and destination pins is **missing**. HIGH visibility per Figma 385:30193 (line is the central visual cue of the screen).

**Wiring gaps**
- None — "Continuar" wires to `/evacuation-ongoing` correctly.

**Deferred gaps (already documented)**
- `evacuation.tsx:12-17` — "Demo phase: basemap.png como background; route line SVG omitida (Phase 2). Continuar → /evacuation-ongoing."

---

### `app/(app)/evacuation-ongoing.tsx` — Figma 385:30336

**DS usage**
- Identical chip pattern to `evacuation.tsx`. Same compose-local opportunity.

**Hardcoded tokens**
- Same time-chip RNText with manual font/weight (lines 57-90). MEDIUM.

**Missing fields**
- File header: "route line + navigation arrow (vector8/navigation assets) deferidos pra Phase 2." Both the green route line **and** the navigation chevron pointing toward the destination are **missing**. HIGH visibility per Figma 385:30336.
- No "Você chegou" / completion state — code is single-state.

**Wiring gaps**
- None apparent.

**Deferred gaps (already documented)**
- `evacuation-ongoing.tsx:11-15` — "Demo phase: basemap.png como background; route line + navigation arrow (vector8/navigation assets) deferidos pra Phase 2."

---

## Journey

### `app/(app)/journey/index.tsx` — Figma 364:16378

**DS usage**
- Task cards are bespoke `Pressable` with manual title/description `<RNText>` (lines 150-201). File header: "compose local porque DS HorizontalCard só tem label single-line (gap diferido)". DS gap (HorizontalCard description). MEDIUM.
- Header section uses raw RNText for "Hoje" (32px), date, Romulo Cardoso name, and role (lines 83-128). Should be DS Title/Text variants. MEDIUM.
- The radio "circle" affordance (lines 165-173: `width:16 height:16 borderRadius:8 borderWidth:1.5 borderColor:theme.content.dark`) is bespoke; not a DS Radio. MEDIUM.

**Hardcoded tokens**
- "Hoje" RNText `fontSize: 32` (line 87) — raw, theme doesn't expose this size. MEDIUM.
- Radio circle width/height/border constants (lines 167-172). LOW.

**Missing fields**
- None vs Figma 364:16378.

**Wiring gaps**
- None — "Iniciar Jornada" wires to `/journey/ongoing`, task cards push to `/journey/task/[id]`.

**Deferred gaps (already documented)**
- `journey/index.tsx:146-148` — "DS HorizontalCard só tem label single-line (gap diferido: estender DS com `description` quando houver mais consumers desse pattern)."

---

### `app/(app)/journey/ongoing.tsx` — Figma 364:17609

**DS usage**
- Identical task-card pattern duplicated from `journey/index.tsx` (lines 149-211 for active task, 220-276 for upcoming). Same DS gap. MEDIUM.
- Active task radio is a filled radio (outer ring + inner green dot, lines 167-186); bespoke. MEDIUM.

**Hardcoded tokens**
- Same `fontSize: 32` for "Hoje" (line 89). MEDIUM.
- "Fazer pausa" button uses `theme.surface.accent` for border and label (lines 293-294) — orange. Confirm `surface.accent` is the brand orange per Figma. LOW.

**Missing fields**
- None vs Figma 364:17609.

**Wiring gaps**
- "Finalizar Jornada" wires to `/journey` (the planner) — should likely route to a finalization screen or modal. MEDIUM (Figma might not have a finalization screen; if not, this is fine).

**Deferred gaps (already documented)**
- `journey/ongoing.tsx:14-19` — "Demo phase: active task hardcoded como 'inspecao'; outros tasks permanecem na fila pra navegar pra /journey/task/[id]."

---

### `app/(app)/journey/pause.tsx` — Figma 364:17766

**DS usage**
- Carbon copy of `journey/ongoing.tsx` structure — same task-card + radio-circle patterns duplicated. DS gap.

**Hardcoded tokens**
- Same `fontSize: 32` for "Hoje" (line 89). MEDIUM.

**Missing fields**
- No visual "paused" state indicator on the active task other than the DonutChart label change (lines 134-141). Figma 364:17766 might show a paused icon (pause glyph overlay). LOW.

**Wiring gaps**
- "Finalizar Jornada" is `disabled` (correct per Figma).
- "Retomar" wires to `/journey/ongoing` — correct.

**Deferred gaps (already documented)**
- `journey/pause.tsx:14-17` — "Demo phase: hardcoded paused task."

---

### `app/(app)/journey/task/[id].tsx` — Figma 364:17126 (phase 1) + 364:17434 (phase 2 via `?state`)

**DS usage**
- Breadcrumb is bespoke `<Pressable>` + raw `<RNText>` (lines 91-131). Should be DS `Breadcrumb` / `Link`. MEDIUM.
- Task summary card is a manual `<View>` with `backgroundColor: theme.surface.standard, borderRadius: theme.border.radius.m` (lines 134-165) — same as journey list cards. DS gap.
- 5 photo placeholders 56×56 are inline `<View>` with `theme.surface.medium` (lines 199-209). Could be a DS `ImagePlaceholder` primitive but acceptable. LOW.
- Section bodies use raw `<RNText>` with manual fontFamily / weight / size (multiple). MEDIUM.

**Hardcoded tokens**
- Breadcrumb `gap: 5` and `flexShrink: 1` constants. LOW.
- `lineHeight` not used here — could affect readability of long description.
- Photo placeholder `56×56` width/height — Figma constants, OK.

**Missing fields**
- None apparent vs Figma 364:17126 / 17434. Phase-1 vs phase-2 differs only in the CTA group, which is wired correctly.

**Wiring gaps**
- "Finalizar tarefa" wires to `/journey` (back to planner) — should likely return to `/journey/ongoing`. MEDIUM.
- "Cancelar tarefa" wires to `/journey` — same. MEDIUM.
- The button group for phase 1 ("Iniciar Jornada e começar tarefa") routes the same `[id]` with `state: 'ongoing'` — correct.

**Deferred gaps (already documented)**
- `journey/task/[id].tsx:14-17` — "Demo phase: tasks são mock keyed by [id] route param."

---

## Reports

### `app/(app)/reports/index.tsx` — Figma 364:18596

**DS usage**
- ReportCard from DS — correct usage.
- Pagination is fully bespoke (lines 191-233) using 6 inline `<Button>` slots in a flex row. Same block duplicated in `settings/faq.tsx`. MEDIUM (extract).

**Hardcoded tokens**
- Pagination chevron icon `width={7.4} height={12}` — Figma-exact, OK.
- Pagination outer `gap: 10` (line 196) — raw constant. LOW.

**Missing fields**
- Empty-state (no reports found) — N/A for demo phase.
- Search filter doesn't filter (line 124, `search` state never read). LOW (demo).

**Wiring gaps**
- Pagination `...` button is `onPress={() => {}}` (line 214). LOW.
- Pagination next-page button increments `currentPage` but the list never reacts. LOW (demo).
- "Novo relatório" wires to `/reports/new` — correct.
- Report cards wire to `/reports/[id]` — correct.

**Deferred gaps (already documented)**
- `reports/index.tsx:15-18` — "Demo phase: 10 mock reports keyed by id, todos navegam pra /reports/[id] (stub Phase 2)."

---

### `app/(app)/reports/[id].tsx` — Figma 364:20304

**DS usage**
- Activities cards (lines 230-286) are bespoke `<View>` cards with manual title/sector RNText + inline ProgressBar + AvatarGroup. Could be a DS `ActivityCard` primitive. MEDIUM.
- DETAIL_TEXT is rendered as raw `<RNText>` with manual fontFamily/weight/size + `lineHeight: theme.fontSize.m * 1.4` (lines 192-202). Should be DS `Text variant="body.m"`. MEDIUM.

**Hardcoded tokens**
- `width: 196, height: 196` for photo placeholders (lines 215-222) — Figma constants, OK.
- `width: 119` for progressbar (line 273) — Figma constant.
- Activity color mapping uses inline `'primary' | 'warning' | 'error'` enum + manual theme lookup (lines 232-237) — fine.
- Multiple RNText with full font-style spec — replace with DS `Text`. MEDIUM.

**Missing fields**
- Comment list (existing comments before the input) — Figma 364:20304 might show prior comments. Code only has the empty add-comment input. MEDIUM if Figma shows a comments thread.

**Wiring gaps**
- "Fazer comentário" outline button (line 153) — `onPress={() => {}}`. MEDIUM.
- "Revisar relatório" outline button (line 166) — `onPress={() => {}}`. MEDIUM.
- "Fazer comentário" CTA at bottom only clears the input (line 305). LOW (demo).

**Deferred gaps (already documented)**
- `reports/[id].tsx:21-24` — "Demo phase: mock report data keyed by [id]; sem persistência."

---

### `app/(app)/reports/new.tsx` — Figma 372:21297

**DS usage**
- All inputs use DS `Input`, `Combobox`, `Title`, `Button`, `ImageUploader`. Clean.
- 4 photo placeholders (lines 117-129) are inline `<View>` 156×132 — same pattern as task/[id].tsx (56×56). LOW.

**Hardcoded tokens**
- Placeholder text on "Título do relatório" reads "Nome completo do novo administrador" (line 82) — **wrong placeholder, copy-pasted from admins screen**. MEDIUM bug.
- 156×132 photo placeholder dims — Figma constants, OK.

**Missing fields**
- No client-side validation feedback (all 3 inputs always allow save).
- No `accessibilityLabel` on Salvar/Cancelar — DS Button defaults accessibilityLabel to `label`, so OK.

**Wiring gaps**
- "Salvar relatório" just `router.back()` (line 30) — no persistence (documented as demo).
- "Atribuir responsáveis" wires to `/reports/responsibles` — correct.

**Deferred gaps (already documented)**
- `reports/new.tsx:14-18` — "Demo phase: useState efêmero, sem persistência."

---

### `app/(app)/reports/responsibles.tsx` — Figma 364:18017

**DS usage**
- Admin rows are bespoke `<Pressable>` with manual Avatar + RNText + Checkbox (lines 109-167). DS gap: could be a DS `UserSelectCard`. MEDIUM.
- Helper text and admin name/age/blood-type are raw `<RNText>` with manual fontFamily/weight/size. MEDIUM.

**Hardcoded tokens**
- Modal backdrop `backgroundColor: 'rgba(0,0,0,0.4)'` (line 59) — raw rgba. MEDIUM (no `theme.overlay`).
- 6 RNText blocks with full style spec — replace with DS `Text`. MEDIUM.
- `maxHeight: '85%'` (line 76) — raw percentage. LOW.

**Missing fields**
- Search input doesn't filter the list (state never read). LOW (demo).
- 5 admins is the full list — no pagination, no "show more". OK for demo.

**Wiring gaps**
- "Continuar" CTA just closes the modal without returning selected ids (line 187). MEDIUM (no state hand-off to `/reports/new`).
- "Cancelar" also closes. OK.

**Deferred gaps (already documented)**
- `reports/responsibles.tsx:14-19` — "Demo phase: useState pra selected set; sem persistência."

---

## Settings

### `app/(app)/settings/index.tsx` — Figma 348:10615

**DS usage**
- Hub uses DS `Avatar`, `HorizontalCard`, `Button`, `Text`. Clean.
- "Política de privacidade" and "Sair" ghost links are bespoke `<Pressable>` with `<Text>` inside (lines 92-141). File header line 90: "Gap K: DS lacks Button variant=\"ghost\" / label.s text variant." MEDIUM (documented).

**Hardcoded tokens**
- Sair Pressable `paddingHorizontal: 12, paddingVertical: 8` (lines 122-123) — raw constants, should use `theme.padding.*`. LOW.
- Ghost link `height: 41` (line 96, 120) — raw. LOW.

**Missing fields**
- None — every Figma 348:10615 menu item is present.

**Wiring gaps**
- All 6 cards wire to real routes; ghost links wire to `/settings/privacy` and `/(auth)/login` correctly.

**Deferred gaps (already documented)**
- `settings/index.tsx:90-91` — "Gap K: DS lacks Button variant=\"ghost\" / label.s text variant."
- Also referenced in prior audit `fidelity-notes-2026-05-14.md` Phase 2 deferrals.

---

### `app/(app)/settings/personal-data.tsx` — Figma 353:11560

**DS usage**
- Uses DS `Input`, `Combobox`, `Title`, `TopBar`, `Button`. Clean.

**Hardcoded tokens**
- UF input `width: 77` (line 104) — Figma constant.
- All fields use DS `Input` with theme-driven styles. Clean.

**Missing fields**
- "Dados da cadastro" section title (line 74) — likely a typo for "Dados de cadastro" or "Dados do cadastro". LOW (copy typo).
- 3 Comboboxes (`profissao`, `setor`, `funcao`, `gerente`) have `options={[]}` — no list to pick from. MEDIUM (will appear broken if user taps).

**Wiring gaps**
- "Salvar alterações" just `router.back()` (line 158). Demo-correct.

**Deferred gaps (already documented)**
- `settings/personal-data.tsx:18-19` — "Pre-populated com Figma example values; demo phase, sem persistência (Salvar = router.back())."

---

### `app/(app)/settings/health-data.tsx` — Figma 353:12057

**DS usage**
- Uses DS `Input`, `Combobox`, `Title`, `TopBar`, `Button`, `ExamInfoCard`, `ImageUploader`. Clean.
- "Histórico Médico" title is a raw `<RNText>` (lines 114-123). Should be DS `<Title variant="title.xs">` like other settings sections. MEDIUM.

**Hardcoded tokens**
- 1 raw RNText for the section title (lines 114-123). MEDIUM.

**Missing fields**
- Tipo sanguíneo + Gênero Comboboxes have `options={[]}` — same issue as personal-data. MEDIUM.

**Wiring gaps**
- ExamInfoCard onActionPress is `() => {}` (line 135). MEDIUM.
- ImageUploader onPickFile is `() => {}` (line 144). MEDIUM.
- Salvar just `router.back()`. OK demo.

**Deferred gaps (already documented)**
- `settings/health-data.tsx:18-20` — "Demo phase: useState only, sem persistência, sem upload real."

---

### `app/(app)/settings/change-password.tsx` — Figma 353:12228

**DS usage**
- Uses DS `Input`, `Title`, `Toast`, `TopBar`, `Button`. Clean.
- Visibility toggle is a local helper using DS `Icon`. OK.

**Hardcoded tokens**
- Toast title is a multiline string with `\n` separators (line 112-113) — should likely use a structured DS list / bullets but Toast accepts only `title` prop in v0.1.44. LOW (DS gap, not file fault).

**Missing fields**
- No "forgot current password" link.
- No client-side validation feedback (Toast shows requirements but no real-time check).

**Wiring gaps**
- Salvar `router.back()` — demo correct.

**Deferred gaps (already documented)**
- `settings/change-password.tsx:15-17` — "Demo phase: useState efêmero, sem persistência (Salvar → router.back())."
- `settings/change-password.tsx:118-120` — Salvar button is absolute-positioned above the Home FAB rather than in scroll content (intentional, documented).

---

### `app/(app)/settings/preferences.tsx` — Figma 357:12302

**DS usage**
- Uses DS `Toggle`, `Title`, `TopBar`, `Button`. Toggle labels are bespoke `<RNText>` (lines 82-91). File header notes: "Toggle DS sem `rightLabel` pra evitar o coloring active/medium que vincula label ao estado." DS gap. MEDIUM.

**Hardcoded tokens**
- 4 raw RNText labels with full style spec (lines 82-91). MEDIUM.

**Missing fields**
- No section helper / description text per Figma 357:12302 (if present). Cross-check unclear.

**Wiring gaps**
- All 4 toggles are state-only, no persistence (demo correct).

**Deferred gaps (already documented)**
- `settings/preferences.tsx:14-17` — "Demo phase: useState efêmero, sem persistência."
- `settings/preferences.tsx:65-68` — "Toggle DS sem `rightLabel` pra evitar o coloring active/medium que vincula label ao estado."

---

### `app/(app)/settings/faq.tsx` — Figma 361:12425

**DS usage**
- Uses DS `Accordion`, `SearchInput`, `Title`, `TopBar`, `Button`. Clean.
- Pagination block is the same bespoke pattern as `reports/index.tsx` (lines 97-139). MEDIUM (dedup target).

**Hardcoded tokens**
- Outer container `gap: 38` (line 70) — raw Figma constant. LOW.
- Pagination `gap: 10` (line 102), chevron `width={7.4} height={12}` — Figma constants.

**Missing fields**
- Search input doesn't filter accordions (state never read).
- No empty-state.

**Wiring gaps**
- Pagination `...` button `onPress={() => {}}` (line 120). LOW.
- Accordions have `showIconLeft={false}` and no `content` prop — so they render only the header. Figma 361:12425 probably has answer bodies inside the accordion. **CRITICAL if Figma shows expanded content for FAQs (the whole point of FAQ is to show answers).** Currently they expand to nothing visible.

**Deferred gaps (already documented)**
- `settings/faq.tsx:14-17` — "Demo phase: search e pagination não filtram nada."

---

### `app/(app)/settings/support.tsx` — Figma 348:10426

**DS usage**
- Uses DS `Combobox`, `Input`, `Title`, `Button`, `Icon`. Clean.

**Hardcoded tokens**
- Backdrop `backgroundColor: 'rgba(0,0,0,0.4)'` (line 38) — raw rgba. MEDIUM.
- Combobox `options={[]}` (line 79) — empty.

**Missing fields**
- Motivo combobox has no options (will be empty dropdown).

**Wiring gaps**
- Enviar just closes the modal (line 106). Demo correct.

**Deferred gaps (already documented)**
- `settings/support.tsx:14-18` — "Demo phase: useState efêmero, Enviar → router.back sem persistência."

---

### `app/(app)/settings/privacy.tsx` — Figma 348:10434

**DS usage**
- Uses DS `Title`, `Icon`. Body is raw `<RNText>` (lines 64-75). MEDIUM (long body text — could justifiably be DS Text variant).

**Hardcoded tokens**
- Backdrop `backgroundColor: 'rgba(0,0,0,0.4)'` (line 27). MEDIUM.
- Policy body RNText with manual `lineHeight: theme.fontSize.m * 1.4`. Should be DS `Text`. MEDIUM.

**Missing fields**
- None — single body text matches Figma.

**Wiring gaps**
- None.

**Deferred gaps (already documented)**
- None explicit, but the entire policy text is hardcoded as `POLICY` constant (line 10) — that's the design.

---

## Chat

### `app/(app)/chat/inbox.tsx` — Figma 336:8808

**DS usage**
- Uses DS `ChatUserCard`, `SearchInput`, `Button`. Clean.
- Custom scrollbar (lines 138-165) is bespoke `<View>` track/thumb — file header documents intent (Figma 332:8765 / 332:8766). DS gap (no `Scrollbar` primitive). LOW (intentional).

**Hardcoded tokens**
- Custom scrollbar `width: 8`, thumb min height `24` (lines 66, 147). LOW.
- Top section paddingTop literal `16` (line 103) — should be `theme.padding.m`. LOW.
- Bottom section `paddingBottom: insets.bottom + 16` (line 170) — raw. LOW.

**Missing fields**
- File header line 102: "Manual layout (vs DS ChatSection wrapper) so the 'Novo Chat' button can stick to the viewport bottom." OK.
- Sections / grouping by sector — Figma might show grouping (`Setor Leste` header). Code shows flat list with subtitle per row. LOW (matches Figma if it's a flat list).

**Wiring gaps**
- "Novo Chat" outline button `onPress={() => { /* TODO: route to '/(app)/chat/new' */ }}` (lines 177-179). MEDIUM. `/(app)/chat/new` route does NOT exist.

**Deferred gaps (already documented)**
- `chat/inbox.tsx:178` — "TODO: route to '/(app)/chat/new'"
- Unused `useRef` import (line 1) — dead import. LOW.

---

### `app/(app)/chat/[userId].tsx` — Figma 332:8580

**DS usage**
- Uses DS `Avatar`, `ChatBubble`, `Button`, `Text`, `Icon`. Clean.
- Chat input is bespoke `<View>` wrapping a raw `<TextInput>` + `<Icon>` attach + DS `Button` send (lines 192-245). DS gap (no `ChatInput` primitive). MEDIUM.

**Hardcoded tokens**
- TextInput `fontSize: 14` (line 219) — raw, should be `theme.fontSize.sm`. MEDIUM.
- TextInput placeholderTextColor `theme.content.dark` — using a dark color for placeholder reduces hierarchy contrast vs Figma which likely uses `content.medium`. LOW.
- `paddingTop: 16` literal (line 142). LOW.

**Missing fields**
- No "typing" indicator / read-receipt / online status badge.
- No keyboard-avoiding wrapper — input may be covered by keyboard on iOS. MEDIUM (mobile UX hazard, not strictly a Figma gap).
- Date separator only inserted for `idx === 1` (line 167) — only one separator possible, not data-driven. LOW (demo).

**Wiring gaps**
- ChatBubble onMenuPress is `() => {}` (line 185). LOW.
- Send button onPress is `() => {}` (line 243). LOW (demo).

**Deferred gaps (already documented)**
- `chat/[userId].tsx:32-37` — naming convention comment for `me`/`them` and DS ChatBubble `position` prop semantics.
- `chat/[userId].tsx:46-54` — older history bubbles for cropping effect documented.

---

### `app/(app)/chat/user-info.tsx` — Figma 336:8891

**DS usage**
- Uses DS `Avatar`, `Button`, `ProgressBar`, `Text`, `Title`, `Icon`. Clean.
- Custom triangle pin marker uses raw `<Svg><Path>` (lines 121-124) — bespoke artwork, acceptable.
- Complementary data card (lines 187-256) uses DS `Text variant="subtitle.m"` with `style={{ fontWeight: '700' }}` overrides — should use a DS subtitle.bold variant if one exists, else acceptable. LOW.

**Hardcoded tokens**
- Mini-map `height: 140` (line 77) — raw constant (documented as deliberate +16 over Figma 124 to fit button cleanly). LOW.
- Triangle path `M0 0 L9 0 L4.5 8 Z` (line 122) — bespoke SVG. OK.
- Pin offsets `marginLeft: -12, marginTop: -16` and `marginLeft: -4.5, marginTop: 8` (lines 99-100, 117-118) — magic numbers from Figma. OK.
- Camera button position `top: 12, right: 12` (line 127) — raw. LOW.
- Camera icon `width={20} height={16}` (line 137-138) — Figma-exact.
- Several `<Text style={{ fontWeight: '700' }}>` overrides (lines 201-202, 207-208, 220-221, 232-233, 246-247). MEDIUM (should be a bold subtitle variant from DS).

**Missing fields**
- Gender symbol uses literal `♂` glyph instead of a DS Icon (line 210). LOW.
- Blood type uses `humidity_mid` icon for the drop (line 239) — semantically wrong; should be a `blood_drop` icon or the existing `blood_pressure`. MEDIUM (Figma 336:8891 cross-ref needed).
- No "Iniciar conversa" or back-to-chat CTA — Figma 336:8891 may include one. LOW (modal-like UX, X-close is enough).

**Layout deviation**
- File header documents the intentional `124→140` height bump (line 73-74).

**Wiring gaps**
- Camera button onPress is `() => {}` (line 142). LOW.

**Deferred gaps (already documented)**
- `chat/user-info.tsx:73-74` — "Increased to 140px tall to fit the 'Ver mapa completo' button cleanly (Figma 124px clipped it)."
- `chat/user-info.tsx:163-167` — gradient stops "auto-distributes stops evenly across the array, close enough to Figma at this width."

---

## Severity Summary

### CRITICAL (blocks demo)
- `dashboard.tsx` — Figma node **385:29138 (alert state)** is referenced in the brief but **not implemented as a dashboard state**. Only `alert-instructions.tsx` exists. If the alert state of `/dashboard` must be reachable for the demo (red banner, modified chart, etc.), this is missing.
- `notifications.tsx` — every one of the 12 notification cards has `onPress={() => {}}`. Tapping any notification card is a no-op. Demo-blocking if tapped during walkthrough.
- `settings/faq.tsx` — Accordions are configured with `showIconLeft={false}` and no `content` prop. They are visually heading-only and don't reveal answers. If the demo opens an FAQ accordion, it shows nothing. **Demo-blocking** for the FAQ screen flow.

### HIGH (visibly off vs Figma)
- `evacuation.tsx` — central green dotted route line between start and destination pins is omitted (Phase 2 defer). This is the dominant visual element of Figma 385:30193.
- `evacuation-ongoing.tsx` — same: route line AND the navigation chevron pointing toward destination are both missing. Figma 385:30336 looks half-empty in code.
- `map-weather.tsx` — the actual weather radar overlay (heatmap of rain on the basemap) is missing per file header. Pins float on plain basemap.
- `reports/new.tsx` line 82 — placeholder text on "Título do relatório" reads `"Nome completo do novo administrador"` (copy-pasted from admins screen). Visible copy bug.
- `my-stats.tsx` line 434 — section title typo `"HIstórico Médico"` (capital `H` + capital `I`). Visible copy bug.
- `settings/personal-data.tsx` line 74 — `"Dados da cadastro"` likely should be `"Dados de cadastro"` or `"Dados do cadastro"`. Visible copy bug.

### MEDIUM (token violations, DS-gap workarounds, broken/dead wiring)
**Token violations (replace raw with theme):**
- Repeated `shadowColor: '#1D1D1D'` in `notifications.tsx`, `map.tsx`, `map-weather.tsx`, `evacuation.tsx` → should be `theme.content.dark`.
- Repeated `backgroundColor: 'rgba(0,0,0,0.4)'` modal backdrops in `reports/responsibles.tsx`, `settings/support.tsx`, `settings/privacy.tsx` → consider a `theme.overlay` token (DS gap).
- Repeated `borderColor: 'rgba(245,245,245,0.5)'` ring borders in `map.tsx`.
- `dashboard.tsx` decorative SVG hex `#3BC958` / `#1E652C` and divider hex `#171717` / `#62BB81` (acceptable as Figma-exact artwork tokens, but worth promoting to DS asset colors).
- `journey/index.tsx`, `ongoing.tsx`, `pause.tsx` — header "Hoje" uses raw `fontSize: 32` not exposed via `theme.fontSize.*`.
- `chat/[userId].tsx` line 219 — TextInput `fontSize: 14` raw.

**DS-bypass `<RNText>` with manual fontFamily/weight/size** (should use DS `<Text>`/`<Title>`):
- `alert-instructions.tsx` — ~14 instances.
- `evacuation.tsx`, `evacuation-ongoing.tsx` — time chips and instruction card body.
- `journey/index.tsx`, `journey/ongoing.tsx`, `journey/pause.tsx` — header block (Hoje, date, name, role), task cards (title + description).
- `journey/task/[id].tsx` — breadcrumb, summary card, objetivo, tempo, interessados.
- `notifications.tsx` — every card title/body.
- `map.tsx` — 5KM / 10KM chips.
- `reports/index.tsx` is clean of this pattern (uses DS components).
- `reports/[id].tsx` — DETAIL_TEXT body, activity cards.
- `reports/responsibles.tsx` — helper text, admin rows.
- `settings/health-data.tsx` — "Histórico Médico" section title.
- `settings/preferences.tsx` — 4 toggle labels.
- `settings/privacy.tsx` — policy body.

**Compose-local opportunities (DS gaps to bump):**
- ChatFab / HomeFab — duplicated FAB block across 11 screens.
- Pagination block — duplicated in `reports/index.tsx` + `settings/faq.tsx`.
- Bespoke radio circle — duplicated in 3 journey files.
- HorizontalCard with description — needed by `journey/*`, `notifications.tsx` (file headers already document this as DS gap).
- Time chip / status chip — needed by `evacuation*`, `map.tsx`.
- Map control icon button — duplicated in `map.tsx` and `map-weather.tsx`.
- ChatInput composite — `chat/[userId].tsx` bespoke wrapper around TextInput + attach icon + send button.
- UserSelectCard — `reports/responsibles.tsx` bespoke row.
- ActivityCard — `reports/[id].tsx` bespoke row.
- Wind speed icon (`wind_speed`) and triangular arrow icons in DS — `alert-instructions.tsx` defers.

**Dead/incorrect wiring:**
- `my-stats.tsx` — `Editar alergias` TODO, ExamInfoCard download TODO, ImageUploader pick TODO.
- `notifications.tsx` — every card and every `more_vert` icon is dead.
- `map.tsx` + `map-weather.tsx` — 3 map controls all dead toggles.
- `map-weather.tsx` "Heatmap" control routes to `/(app)/map` instead of toggling a heatmap overlay — semantically misleading.
- `reports/[id].tsx` — "Fazer comentário" outline + "Revisar relatório" outline both dead.
- `reports/responsibles.tsx` — "Continuar" closes modal without returning selection.
- `chat/inbox.tsx` "Novo Chat" — routes to non-existent `/(app)/chat/new`.
- `journey/task/[id].tsx` — "Finalizar tarefa" + "Cancelar tarefa" route back to `/journey` (planner) instead of `/journey/ongoing`.
- `settings/personal-data.tsx` — 4 Comboboxes have `options={[]}`.
- `settings/health-data.tsx` — 2 Comboboxes have `options={[]}` + ExamInfoCard download dead + ImageUploader pick dead.
- `settings/support.tsx` — Motivo Combobox has `options={[]}`.
- `chat/user-info.tsx` — `humidity_mid` icon used for blood-type drop (semantically wrong); camera button dead.
- `dashboard.tsx` — camera toggle is demo-only.

### LOW (nits / polish / documented deferrals)
- `dashboard.tsx` — `gap: 41` Figma constant in bottom action row.
- `alert-instructions.tsx` — wind-speed empty 24×24 placeholder; triangle arrows replaced with `keyboard_arrow_up/down`.
- `my-stats.tsx` — divider style inconsistency vs dashboard (flat vs SVG gradient).
- `evacuation.tsx` — `borderRadius: 16` literal (should be `theme.border.radius.m`); instruction title color uses `theme.content.success`.
- `journey/pause.tsx` — no visual pause-glyph overlay on active task.
- `reports/index.tsx` — search filter doesn't filter; pagination `...` button dead; pagination next button non-reactive.
- `settings/index.tsx` — Sair Pressable raw `paddingHorizontal: 12, paddingVertical: 8`.
- `settings/faq.tsx` — outer `gap: 38` raw.
- `chat/inbox.tsx` — unused `useRef` import; raw `16` paddings.
- `chat/[userId].tsx` — placeholderTextColor too dark vs Figma; no keyboard-avoiding wrapper (UX hazard not strictly Figma).
- `chat/user-info.tsx` — `♂` glyph instead of icon; multiple `style={{ fontWeight: '700' }}` overrides on Text.
- All Avatar usages — DS Avatar requires `uri` string; multiple files use `Asset.fromModule().uri` workaround (documented in `dashboard.tsx`).

---

## Cross-cutting recommendations (out of scope, FYI for next session)

1. Build a `<ChatHomeFabs>` compose-local component to dedupe the 11-screen FAB duplication and consolidate the duplicated `width={28.286} height={25.458}` home-icon dimensions.
2. Build a `<PaginationControls currentPage onPageChange totalPages>` compose-local for `reports/index.tsx` + `settings/faq.tsx`.
3. Promote bespoke `<RNText style={{ fontFamily: theme.fontFamily.* … }}>` to DS `<Text>` / `<Title>` calls — at least 50+ instances across the (app) tree.
4. DS bumps needed (already partially tracked in code TODOs): `wind_speed` icon, triangular `arrow_up_filled` / `arrow_down_filled`, `Toggle.rightLabel` neutral mode, `HorizontalCard.description` prop, `Title.accessibilityRole` override (per the prior settings audit).
5. The Figma 385:29138 dashboard-alert state needs a routing/state decision: either a separate file (`dashboard-alert.tsx`) or a `?state=alert` param on `dashboard.tsx`.
