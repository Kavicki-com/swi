# swi-admin — Responsive max-width cap (1366)

**Date:** 2026-05-15
**Status:** Superseded by [2026-05-15-swi-admin-responsive-system-design.md](./2026-05-15-swi-admin-responsive-system-design.md)
**Author:** brainstorming session 2026-05-15
**Scope:** swi-admin only (mobile/auth not affected)

> **Superseded note (same day):** the team later expanded scope to include
> tablet support and an *expanding* desktop-wide layout. Capping at 1366
> directly conflicts with that goal, so this plan is no longer active.
> See the responsive-system design doc for the replacement.

## Problem

Client reported the admin "ta enorme" (looks huge) on their monitor.

The swi-admin Figma canvas is 1366 px wide
(`40 padding + 228 sidebar + 16 gap + 1041 content + 41 padding`).
Today `AppLayout.tsx` has no width constraint: the content column uses
`flex: 1` and grows unbounded with the viewport. On a 1920 monitor the
content column expands to ~1595 px (53 % wider than the Figma design),
which stretches every list, card and chart horizontally and produces the
"enorme" feeling.

## Goal

- Keep the visual identity exactly as designed in Figma.
- Stop the content from stretching when the viewport exceeds the Figma
  canvas width.
- Target viewport range: **1366 → 1920+ desktop** only (no mobile/tablet).
- Zero changes to the design system, the auth pages, or any individual
  admin page.

## Non-goals

- Mobile or tablet responsiveness (separate, much larger initiative).
- Fluid scaling (CSS `zoom` or `transform: scale`).
- Replacing fixed-px widths inside individual pages with fluid units.
- Touching the auth pages (Login, SignUp) — their forms are fixed-width
  and already centre naturally on wide viewports.

## Design

**Single change**, in `swi-admin/src/app/AppLayout.tsx`:

1. Wrap the existing root `<View testID="app-layout">` in an outer
   container that covers the full viewport with `theme.background`.
2. Apply `maxWidth: 1366`, `marginHorizontal: 'auto'`, `width: '100%'`
   to the inner content so it caps at the Figma canvas width and centres
   on wider monitors.

Resulting behaviour:

| Viewport | Layout outcome |
|---|---|
| ≤ 1366 px | Edge-to-edge — identical to Figma. |
| 1367–1919 px | Content centred; up to ~277 px of dark space split between left and right edges (filled by `theme.background`). |
| ≥ 1920 px | Same as above; the dark margins are wider. |

Auth pages keep their existing layout — they use absolute-positioned
background layers (recently added) plus a flex-wrap form/logo that
already handles wide viewports gracefully.

## Tests

- The five existing `AppLayout.test.tsx` cases must continue to pass
  unchanged (they assert on rendered DOM, not viewport width).
- No new automated test is needed: the behaviour is purely visual.
- Manual visual verification on resize: 1366 → 1600 → 1920 should show
  the content centring with growing dark margins, while every internal
  element keeps its Figma-defined width.

## Risk

Minimal. Pure CSS layering, no component-level changes. Rollback is a
single-diff revert.
