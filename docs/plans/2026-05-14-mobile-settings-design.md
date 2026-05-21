# Mobile Settings Screen — Design Doc

**Date:** 2026-05-14
**Branch:** `feat/mobile-login` (worktree `C:\Users\Gabriel\Documents\SWI-mobile`)
**Figma ref:** https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=348-10615 (node `348:10615`)
**PNG ref:** `c:\Users\Gabriel\Downloads\settings.png`

**Goal:** Replace the placeholder `mobile/app/(app)/settings/index.tsx` with a Figma-faithful Settings hub: bordered Avatar + Edit-float chip, 6 horizontal menu cards, 2 ghost link buttons (privacy + Sair), Home FAB to dashboard. Add stubs for the two destinations that don't have routes yet (`support`, `privacy`). Bump the DS to ship a reusable `HorizontalCard` primitive.

**Why:** Settings is one of the core menu hubs and currently ships as a debug `<Surface>` placeholder. The Figma is final and reusable (the `HorizontalCard` pattern will recur on Permissões internal screens). This iteration produces the demo-grade screen and seeds the DS with a primitive that prevents local re-implementations down the line.

---

## Scope (this iteration)

**In scope:**
- New DS component `HorizontalCard` published in `@kavicki/swi-design-system` (own bump, own commit, new version).
- Rewrite `mobile/app/(app)/settings/index.tsx` consuming DS as-is per `CLAUDE.md`.
- New route stubs: `mobile/app/(app)/settings/support.tsx`, `mobile/app/(app)/settings/privacy.tsx` (placeholder pattern matching existing siblings).
- Background asset `mobile/assets/settings-bg.png` exported from Figma `imgSettings`.
- Wire navigation for every menu entry + Edit float + Home FAB. `Sair` does `router.replace('/(auth)/login')` (no real auth clear — demo phase).
- Visual verification via Playwright on Expo web (390×844) before commit.

**Out of scope (NOT done here):**
- Implementation of sub-screens (`personal-data`, `health-data`, `change-password`, `preferences`, `faq`, new `support`, new `privacy`) — they stay as placeholder stubs, each gets its own plan when needed.
- Real auth flow / session clearing on `Sair`.
- DS `Button variant="ghost"` (logged as Gap K, future bump).
- Pixel-diff harness in CI.
- Image-picker on Edit avatar tap.
- Bottom tab navigator.

---

## Section 1 — DS bump: `HorizontalCard`

**Repo:** `C:\Users\Gabriel\Documents\swi-design-system`
**Path:** `src/components/HorizontalCard/`
**Bump:** `v0.1.x → v0.1.(x+1)` (new minor patch).

**Props:**
```ts
interface HorizontalCardProps {
  label: string;
  leftIcon?: IconName;
  rightIcon?: IconName;             // default 'keyboard_arrow_right'
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}
```

**Visual (styled-components, read tokens via `useTheme()`):**
- Container: `Pressable` → `backgroundColor: theme.surface.standard`, `padding: theme.padding.m`, `borderRadius: theme.border.radius.m`, elevation-sm shadow, `flexDirection: row`, `alignItems: center`, `gap: theme.gap.s`, `width: 100%`.
- Label: `Title variant="title.xs" color={theme.content.dark}` (Montserrat Bold 16px) flex 1, `textAlign: left`.
- Right slot: 24×24 wrapper with `padding: theme.padding.xs`, containing `Icon` (default `keyboard_arrow_right`, width 7.4 height 12, color `theme.content.dark`).
- Disabled state: container `opacity: 0.5`, `onPress` short-circuited.

**Icon dependency:** `keyboard_arrow_right` must exist in `src/icons/paths.ts`. Verified present (used by `MenuItem` in DS already). `border_color` (used by mobile Edit float) — to be verified in same bump; if missing, register via Figma SVG export per the icons sub-rule of `CLAUDE.md`.

**Storybook:** `HorizontalCard.stories.tsx` with stories: `Default`, `WithLeftIcon`, `Disabled`.

**Output:** build dist (`npm run build`), version-bump `package.json`, commit + tag.

---

## Section 2 — Files & routes

| File | Action | Contents |
|---|---|---|
| `swi-design-system/src/components/HorizontalCard/HorizontalCard.tsx` | new | Implementation per Section 1 |
| `swi-design-system/src/components/HorizontalCard/HorizontalCard.types.ts` | new | `HorizontalCardProps` |
| `swi-design-system/src/components/HorizontalCard/HorizontalCard.styles.ts` | new | styled-components Container/Label/RightSlot |
| `swi-design-system/src/components/HorizontalCard/HorizontalCard.stories.tsx` | new | 3 stories |
| `swi-design-system/src/components/HorizontalCard/index.ts` | new | re-export |
| `swi-design-system/src/index.ts` | edit | export HorizontalCard |
| `swi-design-system/package.json` | edit | version bump |
| `mobile/app/(app)/settings/index.tsx` | rewrite | Settings screen (Figma-faithful) |
| `mobile/app/(app)/settings/support.tsx` | new | Stub mirroring `faq.tsx` |
| `mobile/app/(app)/settings/privacy.tsx` | new | Stub mirroring `faq.tsx` |
| `mobile/assets/settings-bg.png` | new | Figma `imgSettings` export |
| `mobile/package.json` | edit | Bump `@kavicki/swi-design-system` pin |
| `mobile/package-lock.json` | regen | via `npm install` |

**Untouched:** `mobile/app/(app)/settings/_layout.tsx` (Stack `headerShown:false` already OK), all existing sibling stubs.

**Navigation map:**

| Figma label | Target |
|---|---|
| Editar perfil | `/(app)/settings/personal-data` |
| Dados de saúde | `/(app)/settings/health-data` |
| Alterar senha | `/(app)/settings/change-password` |
| Permissões | `/(app)/settings/preferences` |
| Suporte | `/(app)/settings/support` (new stub) |
| FAQ | `/(app)/settings/faq` |
| Política de privacidade e termos de uso | `/(app)/settings/privacy` (new stub) |
| Sair | `router.replace('/(auth)/login')` (visual only) |
| Edit float (pencil chip on avatar) | `/(app)/settings/personal-data` |
| Home FAB (bottom) | `/(app)/dashboard` |

---

## Section 3 — Screen composition (`settings/index.tsx`)

**Top-down structure:**

```tsx
<View flex:1 bg:theme.background>
  {/* Background dotted/gradient overlay — Figma imgSettings.
      Absolute, pointerEvents=none, top:0 left:0 w/h 100%. */}
  <RNImage source={require('../../../assets/settings-bg.png')} ... />

  <ScrollView contentContainerStyle={{
    paddingTop: insets.top + 40,         // Figma container top=40
    paddingBottom: insets.bottom + 120,  // Home FAB clearance
    alignItems: 'center',
  }}>
    <View style={{ width: 328, gap: theme.gap.l, alignItems: 'center' }}>

      {/* 1. Avatar (80) + Edit float (DS Button contained pill small) */}
      <View style={{ width: 106, height: 91, justifyContent: 'flex-end' }}>
        <Avatar customSize={80} uri={avatarUri} bordered borderWidth={3} />
        <View style={{ position:'absolute', right:0, top:0 }}>
          <Button
            variant="contained" shape="pill" size="small"
            backgroundColor={theme.content.dark}
            elevation="lg"
            iconLeft={<Icon name="border_color" width={18.182} height={20}
                            color={theme.content.light} />}
            accessibilityLabel="Editar perfil"
            onPress={() => router.push('/(app)/settings/personal-data')}
          />
        </View>
      </View>

      {/* 2. Menu — 6 HorizontalCard, gap.m 16 */}
      <View style={{ width: '100%', gap: theme.gap.m }}>
        <HorizontalCard label="Editar perfil"   onPress={...} />
        <HorizontalCard label="Dados de saúde"  onPress={...} />
        <HorizontalCard label="Alterar senha"   onPress={...} />
        <HorizontalCard label="Permissões"      onPress={...} />
        <HorizontalCard label="Suporte"         onPress={...} />
        <HorizontalCard label="FAQ"             onPress={...} />
      </View>

      {/* 3. Ghost links — h 41, padding 12/8, radius m, Montserrat Bold 14 */}
      <Pressable onPress={() => router.push('/(app)/settings/privacy')}
                 style={{ height:41, paddingHorizontal:12, paddingVertical:8,
                          borderRadius: theme.border.radius.m,
                          alignItems:'center', justifyContent:'center' }}>
        <Text style={{ fontFamily: theme.fontFamily.title, fontWeight: '700',
                       fontSize: 14, color: theme.content.primary }}>
          Política de privacidade e termos de uso
        </Text>
      </Pressable>

      <Pressable onPress={() => router.replace('/(auth)/login')}
                 style={{ height:41, width:'100%', paddingHorizontal:12,
                          paddingVertical:8, borderRadius: theme.border.radius.m,
                          alignItems:'center', justifyContent:'center' }}>
        <Text style={{ fontFamily: theme.fontFamily.title, fontWeight: '700',
                       fontSize: 14, color: theme.content.error }}>
          Sair
        </Text>
      </Pressable>
    </View>
  </ScrollView>

  {/* 4. Home FAB — fixed bottom safe-area, centered */}
  <View pointerEvents="box-none" style={{ position:'absolute',
        bottom: insets.bottom + 24, left:0, right:0, alignItems:'center' }}>
    <Button variant="contained" shape="pill" size="xlarge"
            backgroundColor={theme.content.dark}
            borderColor={theme.content.disable}
            borderWidth={10}
            elevation="lg"
            iconLeft={<Icon name="home" width={30.857} height={30.857}
                            color={theme.surface.standard} />}
            accessibilityLabel="Voltar para a dashboard"
            onPress={() => router.push('/(app)/dashboard')} />
  </View>
</View>
```

**Decisions baked in:**
- `ScrollView` (not letterbox-fit) — settings is short and may overflow on small phones; safe-area-padded ScrollView is the cleanest match. Home FAB sits OUTSIDE the ScrollView, fixed to safe-area bottom.
- Edit float uses **DS Button** (named `ContainedButton` in Figma), not raw `Pressable` — DS-correct.
- Ghost buttons use `Pressable + Text` with **inline typography** matching Figma exactly (`fontFamily: theme.fontFamily.title`, `fontWeight: '700'`, `fontSize: 14`). Logged as **Gap K**: future DS bump should add `Button variant="ghost"` or `Text variant="label.s"` (Montserrat Bold 14).
- No header — Figma has no TopBar on this screen.
- Avatar `customSize={80} bordered borderWidth={3}` — matches Figma `-3.75% inset` (≈86px outer); verify in Storybook before final commit; tweak `borderWidth` if needed.

---

## Section 4 — Verification & acceptance

**Verification pipeline (must pass before commit 2):**
1. `cd swi-design-system && npm run build` — DS dist builds clean.
2. `cd mobile && npx tsc --noEmit` — zero new TS errors.
3. `cd mobile && npx expo start --web --port 8081` (background).
4. Playwright resize → 390×844 (iPhone 15).
5. Navigate to `http://localhost:8081/settings`.
6. `mcp__playwright__browser_take_screenshot` → `docs/audits/mobile/settings/fidelity-verify-2026-05-14.png`.
7. Side-by-side compare with `c:\Users\Gabriel\Downloads\settings.png`. Inline-document divergences.

**Acceptance criteria (all PASS to commit):**
- (a) Avatar bordered + Edit float chip top-right, chip touches avatar's upper-right edge (not floating distant).
- (b) 6 HorizontalCards visible as distinct `surface.standard` cards over the dark background (no dissolving).
- (c) Each card's chevron-right slot vertically centered + horizontally right-anchored.
- (d) Spacing: 24 between avatar→menu, 16 between cards, 16 between last card→privacy ghost, 16 between privacy ghost→Sair ghost.
- (e) Privacy ghost text in `content.primary` (#62BB81); Sair ghost text in `content.error` (#F5667A); both Montserrat Bold 14.
- (f) Home FAB centered horizontally, sits in safe-area bottom, `content.disable` border visibly framing the white circle (not blending).
- (g) Background dots/gradient subtly visible behind cards (not full opacity, not fully hidden).

**Failure modes & responses:**
- Criterion fails → fix before commit, re-screenshot, re-compare.
- DS bump fails to install → revert `package.json`, debug DS build, fix, retry.
- Asset URL expires → fallback to manual export ask.

---

## Section 5 — Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `border_color` icon not in DS paths.ts | Medium | Register via Figma SVG export in same DS bump (icons sub-rule). |
| Avatar `customSize=80 borderWidth=3` doesn't match `-3.75% inset` exactly | Low | Storybook hospedado validation before code; tweak borderWidth if needed. |
| Figma asset URL `imgSettings` expired / wrong Content-Type | Medium | First try `mcp__claude_ai_Figma__get_screenshot`; on failure, ask user to export manually. |
| RN Web elevation renders differently from native iOS shadow | Low | Playwright covers web; small cross-platform shadow diff accepted (Phase 2 if blocking). |
| Fonts not loaded in mobile `_layout.tsx` (memory caveat) | Low | Verified `expo-font` setup in `_layout.tsx`; if missing, alert before commit. |
| Ghost button visual diverges without DS `variant="ghost"` | Medium | Inline `fontFamily`/`fontWeight`/`fontSize` forces match; documented as Gap K. |

**Rollback:**
- Screen commit (commit 2): `git revert HEAD` in SWI-mobile.
- DS bump (commit 1): revert mobile `package.json` to previous DS pin + `npm install`. DS repo commit kept as history (not reverted).

---

## Commit plan

**Commit 1 — DS repo** (`C:\Users\Gabriel\Documents\swi-design-system`):
```
feat(ds): add HorizontalCard component

Surface card with bold label + chevron-right slot for settings/list
flows. Props: label, leftIcon?, rightIcon?, onPress, disabled.
Tokens: surface.standard bg, padding.m, radius.m, elevation-sm,
title.xs label, content.dark text. Storybook stories included.

Figma ref: 348:10928 (HorizontalCard component instance).
```
Then: `npm run build` + version bump + `git tag`.

**Commit 2 — Mobile repo** (`C:\Users\Gabriel\Documents\SWI-mobile`, branch `feat/mobile-login`):
```
feat(mobile): settings screen — Figma fidelity (348:10615)

Replace placeholder Surface with full settings hub: bordered Avatar
+ Edit float, 6 HorizontalCard menu entries, ghost links for privacy
+ logout, Home FAB to dashboard. Uses DS HorizontalCard (bumped to
v0.1.x). New stubs: settings/support.tsx, settings/privacy.tsx.

Asset: mobile/assets/settings-bg.png (Figma imgSettings export).
Gap K logged: DS lacks Button variant="ghost" / label.s text variant.
```

---

## Phase 2 preview (NOT in this plan)

- DS `Button variant="ghost"` (or `Text variant="label.s"`) — closes Gap K.
- Real auth flow / session clear on `Sair`.
- Image picker on Edit avatar.
- Sub-screen implementations (`personal-data`, `health-data`, etc.) — each its own plan.
- Pixel-diff harness in CI.

---

**Next step:** invoke `superpowers:writing-plans` to produce the executable step-by-step plan.
