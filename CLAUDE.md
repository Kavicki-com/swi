# Project rules — SWI

## Repo structure

This repo holds **two independent apps as sibling folders at the root**:

- `swi-admin/` — site (Vite + React, admin web app)
- `mobile/` — app (Expo Router + React Native)

They are deliberately **fully isolated**:

- Each has its own `package.json`, `node_modules/`, and lockfile.
- No shared root config, no monorepo workspaces, no turbo, no pnpm-workspace.
- Each app's `dev`/`build`/`test` is run from its own folder (`cd swi-admin && npm run dev`, `cd mobile && npx expo start`).

### Branch naming convention

Branches are namespaced by the app they touch so the branch list and PR list stay readable:

- `feat/admin-*`, `fix/admin-*`, `chore/admin-*` — work that touches `swi-admin/`
- `feat/mobile-*`, `fix/mobile-*`, `chore/mobile-*` — work that touches `mobile/`
- `feat/repo-*`, `chore/repo-*` — root-level changes (CLAUDE.md, docs/, .gitignore)

Pre-existing branches (`feat/s1.x-*`) are admin work — kept as-is for history; new branches follow the prefix rule.

A single branch should not touch both `swi-admin/` and `mobile/`. If a change feels like it spans both, stop and confirm with the user — that's a signal something is off (likely a coordinated DS bump that should be sequenced as two PRs).

### Working on both in parallel

To avoid branch conflicts when working on both at once, use git worktrees:

```bash
# Site stays on its branch in this checkout (e.g. feat/admin-s1.7-dashboard-fidelity)
# Spin up a separate worktree on a separate branch for mobile work:
git worktree add ../SWI-mobile feat/mobile-login
```

The remote is `https://github.com/Kavicki-com/swi.git` (renamed from `swi-admin` on 2026-05-10 to reflect the broader scope).

## Design system rule (non-negotiable)

**ALWAYS use `@kavicki/swi-design-system` components as-is. NEVER create local/custom replacements, overrides, or reimplementations of DS components.**

This is a hard rule the user has established for this project. Read it twice before writing any UI code:

> "Coloque como regra no projeto inteiro eu não quero que você crie nenhum componente por conta propria é REGRA usar o DS."

### What this prohibits

- Creating `AppHeaderUserInfo.tsx`, `LocalAvatar.tsx`, `MyButton.tsx`, etc. that reimplement a DS component to swap an icon, change a token, change layout, or work around any DS limitation.
- Inlining JSX that duplicates a DS component's structure to override one prop the DS doesn't expose.
- Wrapping `<img>`, `<View>`, styled-components, etc. as a parallel implementation of something already in the DS.
- "Just patch this locally for now" — even temporarily.

### What this requires

1. **Before writing any component file under `swi-admin/src/` or `mobile/app/`**, check `@kavicki/swi-design-system`'s exports first. If it ships a component for the use case (Avatar, Button, ChatSection, ChipGroup, DonutChart, EmployeeOverviewCard, HeaderUserInfo, Icon, Logo, ProgressBar, SearchInput, Text, Title, WeatherTimeline, …), **use it as-is**.
2. **If the DS component doesn't satisfy the design** (missing prop, wrong glyph, missing variant, wrong token): **propose a DS bump** (e.g. v0.1.4 → v0.1.5). Document the gap, open a PR in the DS repo, build dist, version-bump in `swi-admin/package.json`, then `npm install`. Never patch around it locally.
3. **Acceptable** local components: page-level layouts that *compose* multiple DS components (e.g. `Dashboard.tsx` arranging KPI tiles, lists, charts). These orchestrate, they don't replace primitives.
4. **Pushback expected**: if asked "can you just override this locally?" — push back firmly and propose a DS bump instead. Local overrides have already cost a full session of churn (see session 2026-05-09).

### Icons (sub-rule)

When the DS doesn't have an icon a screen needs and a bump is required:

1. **Always source the icon from a Figma SVG export.** In Figma desktop/web: select the icon node → right panel → Export → format `SVG` → copy or download. From the resulting SVG file, copy `viewBox` (from `<svg viewBox="...">`) and `d` (from `<path d="...">`) into `swi-design-system/src/icons/paths.ts`.
2. **If a valid SVG export can't be obtained — STOP and alert the user.** Do NOT fall back to PNG. Do NOT use Figma MCP asset URLs without first verifying `Content-Type: image/svg+xml`. Do NOT invent path data.
3. Material Symbols (Google) remain a valid second source *only* for generic concepts (`build`, `search`, `close`, `keyboard_arrow_*`) where the designer hasn't drawn a custom version. Per the header in `icons/paths.ts`.
4. **Scope:** this rule applies to icons (small monochrome glyphs registered in the DS `Icon` component). Background images, illustrations, and photographs can stay PNG/JPG.

### Tokens (sub-rule)

The DS exposes a hierarchy for token consumption. **In code, `useTheme()` is the only correct source.** Hardcoding token values is prohibited even when the literal value happens to match a token.

#### Hierarchy

```
Figma variables  →  tokens/*.ts (generated)  →  useTheme() (runtime API)  →  app code
                                                        │
                                                        └→ Storybook (visual validation)
```

1. **Code-time canonical: `useTheme()`** — from `@kavicki/swi-design-system`. Returns the live `theme` object via styled-components. Use for all colors, spacing, typography, borders, elevation. Reference pattern: `swi-admin/src/pages/auth/Login.tsx` (`const theme = useTheme(); ...style={{ backgroundColor: theme.background, gap: theme.gap.l }}`).
2. **Text reference (discovery): `node_modules/@kavicki/swi-design-system/src/tokens/*.ts`** — `primitive.ts`, `semantic.ts`, `typography.ts`, `effects.ts`. Read to find token names. Never `import` from these files; always go through `useTheme()`.
3. **Visual validation: Storybook hospedado at https://kavicki-com.github.io/swi-design-system/** — official validation channel. Has dedicated `tokens/_docs/Primitive.stories.tsx` and `Semantic.stories.tsx`, plus per-component stories. Use to confirm "what does `theme.surface.medium` look like?", "Logo size `m` vs `l` visually?", "which Text variant fits this Figma label?". Storybook is **not** a code source.
4. **Design upstream: Figma variables** — collection in the Figma file. The `tokens/*.ts` files are generated from these (`Source: references/figma-variables.json` header). Read-only for app code; updates flow Figma → `npm run tokens:generate` → DS bump → app update.

#### Prohibited

- Hardcoding values like `'#171717'`, `gap: 24`, `fontSize: 14`. Even when the value matches a token, the bypass breaks DS evolution (a future bump in the DS won't propagate to the screen).
- `import { theme } from '@kavicki/swi-design-system'` to read tokens. Always `useTheme()`.
- Treating Figma `get_design_context` output (`var(--gap/l, 24px)`) as authoritative for values — that's web mockup syntax; the real RN/web code resolves via the styled-components theme prop.

#### Required workflow when implementing a screen

1. Look at the equivalent admin screen (if it exists) and copy its `useTheme()` consumption pattern. The admin Login is the canonical reference for any auth screen.
2. For tokens not used by admin: open `tokens/semantic.ts` and `tokens/typography.ts` in the source mirror to find the right names.
3. If visually uncertain, open Storybook hospedado and confirm before coding (Logo size, Input states, Text variant size, etc.).
4. Code with `useTheme()` + dot notation. No hardcoding. No `import { theme }`.

#### Font loading caveat (mobile-specific)

The DS declares `theme.fontFamily.body = 'Inter'` and `theme.fontFamily.title = 'Montserrat'`. **The DS does not load fonts; that's host responsibility.** Site loads them via `<link>` Google Fonts in `swi-admin/index.html`. Mobile must load them via `expo-font` in `mobile/app/_layout.tsx` (using `useFonts` and `.ttf` files in `mobile/assets/fonts/`). Without this, RN falls back to system fonts (San Francisco / Roboto / sans-serif) and visual divergence from the site is obvious **even though the tokens are correct**. Token misalignment ≠ font loading. Diagnose accordingly.

### Why

Local overrides destroy DS-encoded design intent and produce drift that takes many rounds to chase. The user established this rule after `AppHeaderUserInfo.tsx` was created to swap material icons for Figma SVGs — the override drifted across multiple iterations and broke the visual fusion the DS `HeaderUserInfo` had right out of the box.

### Reference

Project's DS pin: `@kavicki/swi-design-system` (version in `swi-admin/package.json`). Source mirror: `swi-admin/node_modules/@kavicki/swi-design-system/src/`.
