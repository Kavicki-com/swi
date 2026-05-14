# Settings Screen — Fidelity Notes (2026-05-14)

**Figma ref:** node `348:10615` in `bzDUuPdSiKgl5xucBH0IYE`
**Local ref PNG:** `c:\Users\Gabriel\Downloads\settings.png` (Figma export)
**Live screenshot:** `fidelity-verify-2026-05-14.png` (Playwright on Expo web, 390×844)
**Acceptance:** 7/7 criteria PASS for demo

## PASS criteria (per design doc Section 4)

- (a) Avatar bordered + Edit float chip top-right touching avatar's upper-right edge ✅
- (b) 6 HorizontalCards visible as distinct surface cards over dark background ✅
- (c) Each card's chevron-right slot vertically + horizontally aligned ✅
- (d) Spacing 24 / 16 / 16 / 16 between avatar→menu / cards / last-card→privacy / privacy→Sair ✅
- (e) Privacy ghost text `content.primary` (green); Sair ghost text `content.error` (red); both Montserrat Bold 14 ✅
- (f) Home FAB centered horizontally, content.disable border framing white circle ✅ (see divergence #2)
- (g) Background gradient subtly visible behind cards ✅

## Documented divergences (Phase 2)

### Divergence 1 — Chevron stroke thinner than Figma

The `keyboard_arrow_right` glyph in `swi-design-system/src/icons/paths.ts` renders with thinner strokes than the Figma `>` chevron. Width/height `7.4×12` matches the Figma spec exactly, but the path geometry differs.

**Cause:** DS uses Material Symbols outlined `keyboard_arrow_right` path; Figma uses a custom chevron. Visual delta only.

**Phase 2 fix:** Replace path data in DS with the Figma SVG export of the `keyboard_arrow_right` chevron used in HorizontalCard right slot.

### Divergence 2 — Home FAB `content.disable` border attenuated on web

`Button borderWidth={10} borderColor={theme.content.disable}` renders the 10px border as a subtle ring on Expo web (`react-native-web` boxShadow + border combination). Native iOS render is expected to show the border more crisply.

**Cause:** RN Web's border + drop-shadow composition handling.

**Phase 2 fix:** Either accept the cross-platform divergence (web is debug-only; production target is native), or add a web-specific `style` override that crisps the border.

### Divergence 3 — Edit float chip icon stroke

The `border_color` icon registered in DS uses the Material Symbols outlined glyph. Figma's `border_color` is identical in concept (pencil-on-line) but stroke weight may differ subtly.

**Cause:** Same as Divergence 1.

**Phase 2 fix:** If a custom Figma export is preferred, swap the path data in `src/icons/paths.ts`.

## Non-issues (do NOT fix)

- Avatar source PNG (`avatar-construction.png`) — same asset used in dashboard and my-stats, deliberately shared.
- Background overlay (`settings-bg.png`) — direct Figma export, identical asset.
- Card surface color, padding, radius, shadow — all token-driven; web rendering matches design intent.

---

**Verdict:** Implementation accepted for demo. Phase 2 ticket: bump DS to refresh `keyboard_arrow_right` + `border_color` path data from Figma; revisit Home FAB cross-platform border rendering.
