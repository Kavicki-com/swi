# swi-admin — Responsive system (tablet / desktop / wide)

**Date:** 2026-05-15
**Status:** Approved
**Author:** brainstorming session 2026-05-15
**Supersedes:** [2026-05-15-swi-admin-responsive-cap-design.md](./2026-05-15-swi-admin-responsive-cap-design.md)
**Reference Figma:**
- Tablet (Dashboard): `bzDUuPdSiKgl5xucBH0IYE` / node `1066:7990` (768 × 1937)
- Desktop wide (Dashboard): `bzDUuPdSiKgl5xucBH0IYE` / node `1060:7080` (1920 × 1080)

## Problem

The team expanded the responsiveness scope to cover **three viewport
classes**: tablet portrait (~768), desktop standard (~1366, the canonical
Figma canvas) and desktop wide (~1920+). The previous "cap at 1366" plan
contradicts this — wide viewports are now expected to *reorganise* content
into extra columns, and tablet is expected to *stack* everything in a
single column with a collapsed top bar. Today the app has no breakpoint
infrastructure: every page uses fixed pixel widths and the layout breaks
at both ends.

## Breakpoints

| Class | Range | Sidebar | Content reflow |
|---|---|---|---|
| `tablet` | `< 1024` | Hidden, replaced by top bar with Logo + hamburger drawer + BPM | Single column, full width, cards reflow naturally |
| `desktop` | `1024-1599` | 228 px fixed left (current Figma) | Existing layout |
| `wide` | `>= 1600` | 228 px fixed left | Multi-column rows where Figma 1920 specifies it (e.g. Dashboard top row puts Map / Charts / KPIs side-by-side) |

The boundary picks reflect Figma intent: 1024 is the natural cut where the
228 px sidebar stops fitting next to a usable content column, and 1600 is
the practical threshold where there is real room to add a column of
content beside the existing two-column rows.

## Goals

- Single source of truth for breakpoint detection (one hook).
- Sidebar collapses to top-bar drawer on tablet.
- Dashboard reflows fully across the three classes (proof of concept).
- The other admin pages reflow "well enough" by leaning on a CSS-first
  pattern (`flexWrap` + `flexGrow` instead of fixed widths). Pages that
  cannot be handled that way get explicit breakpoint switches.
- No design-system changes in the first pass — wrappers live in
  swi-admin. DS changes are a separate effort.
- Auth pages (Login, SignUp) untouched in Sprint 1.

## Non-goals

- Phone / portrait < 768 widths.
- DS bump or design-system component variants (deferred).
- Pixel-perfect parity with Figma on screens that were not specified by
  the team — heuristic fidelity only.

## Architecture

### `useBreakpoint()` hook

New file `swi-admin/src/hooks/useBreakpoint.ts`:

```ts
// Returns the current viewport class. Uses react-native's
// useWindowDimensions so it works under react-native-web in this project
// and stays consistent with the rest of the codebase.
export type Breakpoint = 'tablet' | 'desktop' | 'wide'

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions()
  if (width < 1024) return 'tablet'
  if (width < 1600) return 'desktop'
  return 'wide'
}
```

### `AppLayout` refactor

- `tablet`: render a **top bar** (Logo left, hamburger button, BPM right).
  The hamburger opens a drawer (`Modal` or absolutely-positioned panel)
  containing the seven nav items + the chat list.
- `desktop` + `wide`: keep the existing sidebar layout.
- Header `Pressable` for `/user/profile` is preserved in all classes.

### Per-page reflow strategy

- **CSS-first (90 % of pages):** replace `width: NNN` with
  `flexBasis: NNN`, `flexGrow: 1`, `flexShrink: 1` on every card / section
  that should grow at wider widths. Combine with the existing
  `flexDirection: 'row'` + `flexWrap: 'wrap'` containers so the cards
  reflow naturally as the viewport changes.
- **Breakpoint-explicit (10 %):** where reorganisation is structural —
  notably the Dashboard top row which goes from stacked (1366) to a single
  row of Map | Charts | KPIs (1920) — call `useBreakpoint()` and render
  variant JSX. Pages identified for the explicit treatment in Sprint 1:
  - `Dashboard.tsx` (full three-class implementation, as per Figma).

### Sprint plan

**Sprint 1 — Foundation + Dashboard proof of concept**

1. Add `useBreakpoint()` hook with unit tests for the three classes.
2. Refactor `AppLayout.tsx` to render tablet top-bar + drawer; verify
   sidebar mode still works exactly as today on desktop / wide.
3. Refactor `Dashboard.tsx` to the three-class Figma reflow.
4. Update / add `AppLayout.test.tsx` and `Dashboard.test.tsx` cases that
   mock viewport width to assert the right structure renders per class.

**Sprint 2 — Generalise to remaining admin pages**

- AdminsList, Admins/Details, EmployeesList, Employees/Details, Reports,
  ReportDetails, Alerts (List, RescueRoute, RescueRouteSelection),
  Monitoring, Maps (General, Cameras, Heatmap, etc.), Chat (Inbox).
- Apply the CSS-first pattern; flag pages that genuinely need a
  breakpoint switch and handle them individually.

**Sprint 3 — Polish + Auth pages**

- Visual sweep of every page at 768, 1366, 1920.
- Adjust the auth pages if visual gaps appear.
- Optional: explicit responsive tests for the worst offenders.

## Testing

- `useBreakpoint`: three small Vitest cases that stub `useWindowDimensions`
  and assert the returned class.
- `AppLayout`: extend existing five tests with three more — one per
  breakpoint class — asserting the right structural anchors render
  (sidebar present vs top-bar present + drawer toggle).
- `Dashboard`: one test per class asserting the row arrangement (count
  of children in the top-row container, or testIDs identifying each
  variant).
- Other pages: keep the existing smoke tests; visual verification only
  in Sprints 2 / 3.

## Risk

- "Generalising the Dashboard pattern" is heuristic, so some pages will
  look off after Sprint 2 and need a manual pass in Sprint 3.
- The DS-no-change rule forces local wrappers for some components. If a
  component truly cannot be coerced into the tablet layout without
  internal changes, that screen is deferred to a later DS-aware sprint
  and called out explicitly.
- A real Sprint 1 pass touches `AppLayout` and `Dashboard` — both already
  have uncommitted local changes today (header `Pressable`, etc.). To
  keep the worktree clean, all in-flight fixes get committed first and
  the responsive work happens on top.

## Rollback

Sprint 1 is a single feature branch. Rollback = `git revert` of the
Sprint 1 merge commit. The CSS-first reflow in Sprints 2 / 3 is
incremental — individual page reverts are cheap.
