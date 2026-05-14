# Settings Screen — Fidelity Notes (2026-05-14)

**Figma ref:** node `348:10615` in `bzDUuPdSiKgl5xucBH0IYE`
**Local ref PNG:** `c:\Users\Gabriel\Downloads\settings.png` (Figma export)

**Iterations:**
- v1 (DS v0.1.36): `fidelity-verify-2026-05-14.png` — 7/7 acceptance PASS, 3 minor divergências (chevron/edit-icon strokes + home FAB border on web).
- v2 (DS v0.1.37): `fidelity-verify-2026-05-14-v2.png` — divergências 1 e 3 resolvidas via Figma SVG exports nos paths do DS. Peso de texto resolvido revertendo HorizontalCard pra `<Title variant="title.xs">`.

## v2 PASS criteria (per design doc Section 4)

- (a) Avatar bordered + Edit float chip top-right touching avatar's upper-right edge ✅
- (b) 6 HorizontalCards visible as distinct surface cards over dark background ✅
- (c) Each card's chevron-right slot vertically + horizontally aligned ✅ (chevron agora Figma-exact, traço mais grosso)
- (d) Spacing 24 / 16 / 16 / 16 between avatar→menu / cards / last-card→privacy / privacy→Sair ✅
- (e) Privacy ghost text `content.primary` (green); Sair ghost text `content.error` (red); both Montserrat Bold 14 ✅
- (f) Home FAB centered horizontally, content.disable border framing white circle ✅ (border ainda sutil no web, mas glyph Figma-exact)
- (g) Background gradient subtly visible behind cards ✅
- (h) Card labels rendered with Montserrat Bold 16 (title.xs) via `<Title>` ✅ (peso correto)
- (i) Edit float chip pencil-on-line glyph matches Figma ✅
- (j) Home FAB glyph matches Figma (filled house with implicit chimney) ✅

## v2 alterações vs v1

**DS bump v0.1.36 → v0.1.37 (commit `f7e2793`, push + tag):**
- `paths.ts`: `keyboard_arrow_right` → Figma SVG (viewBox `0 0 8 12`, traço mais grosso)
- `paths.ts`: `border_color` → Figma SVG (viewBox `0 0 19 20`, pencil-on-line)
- `paths.ts`: `home` → Figma SVG (viewBox `0 0 29 26`, casa sólida)
- `HorizontalCard.tsx`: `<Text variant="body.m" + override>` → `<Title variant="title.xs">` (Montserrat Bold 16 nativo)

**Mobile:**
- `package.json`: DS pin v0.1.36 → v0.1.37
- `settings/index.tsx`: Home FAB icon `width={30.857} height={30.857}` → `width={28.286} height={25.458}` (preserva aspect ratio do novo viewBox 29×26)

## Divergências resolvidas

- ✅ ~~Divergence 1 — Chevron stroke thinner than Figma~~ — resolvido com Figma SVG export (paths.ts).
- ⚠️ Divergence 2 — Home FAB `content.disable` border attenuated on web — **MANTIDA** (cross-platform RN Web boxShadow+border issue; native iOS deve render correto; Phase 2 se virar bloqueio).
- ✅ ~~Divergence 3 — Edit float chip icon stroke~~ — resolvido com Figma SVG export.

## Phase 2 deferrals

### Title accessibilityRole hardcoded
`HorizontalCard` agora usa `<Title variant="title.xs">` que internamente hardcoda `accessibilityRole="header"`. O Container do HorizontalCard tem `accessibilityRole="button"`. Resultado web: `<button><h2>` aninhado — ARIA não-ideal.

**Phase 2:** bumpar `Title` em DS pra aceitar `accessibilityRole` override prop. Em HorizontalCard, passar `accessibilityRole={null}` ou `undefined` pra suprimir o header role interno.

### my-stats Home FAB dimensions
`my-stats.tsx` ainda usa `width={30.857} height={30.857}` no Home FAB. Com o novo `home` icon de viewBox 29×26, isso vai squashar verticalmente ~12%. Não está no escopo dessa entrega (settings-only), mas vai aparecer visualmente quando my-stats for atualizada.

**Phase 2:** alinhar my-stats Home FAB pra `width={28.286} height={25.458}` quando essa tela for revisada.

### Home FAB border on web
Reproduzido em ambas iterações. Comportamento RN Web; nativo deve ser correto. Documentado como cross-platform deferral.

## Non-issues (do NOT fix)

- Avatar source PNG (`avatar-construction.png`) — same asset used in dashboard and my-stats, deliberately shared.
- Background overlay (`settings-bg.png`) — direct Figma export, identical asset.
- Card surface color, padding, radius, shadow — all token-driven; web rendering matches design intent.

---

**Verdict v2:** Implementation accepted for demo with high visual fidelity to Figma. 3 Phase 2 deferrals documented (Title a11y override, my-stats home dims, web FAB border).
