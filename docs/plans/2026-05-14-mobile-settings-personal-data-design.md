# Mobile Settings — Personal Data Screen — Design Doc

**Date:** 2026-05-14
**Branch:** `feat/mobile-login` (worktree `C:\Users\Gabriel\Documents\SWI-mobile`)
**Figma ref:** https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=353-11560 (node `353:11560`)
**PNG ref:** `c:\Users\Gabriel\Downloads\settings-personal-data.png`

**Goal:** Replace the placeholder `mobile/app/(app)/settings/personal-data.tsx` with a Figma-faithful "Dados pessoais" form: TopBar (back + title), section title "Dados da cadastro", 5 text inputs (Nome / Data / CPF / Email / Telefone), UF+Cidade row, 4 comboboxes (Profissão / Setor / Função / Gerente), Salvar alterações button, Home FAB. Bump DS to ship a reusable `TopBar` primitive consumable across all drill-down sub-screens (Suporte, FAQ, Privacy, Saúde, Senha, Permissões, auth flows).

**Why:** Personal Data is the destination of the most-prominent Settings entry ("Editar perfil" HorizontalCard + Avatar Edit float). The screen introduces a TopBar pattern that recurs across the entire drill-down hierarchy — shipping it as a DS primitive now prevents 6+ local re-implementations later (same pattern that paid off with `HorizontalCard` for the Settings hub).

---

## Scope (this iteration)

**In scope:**
- New DS component `TopBar` published in `@kavicki/swi-design-system`, with `content.primary-light` token added to `semantic.ts` if absent.
- Rewrite `mobile/app/(app)/settings/personal-data.tsx` consuming DS as-is per `CLAUDE.md`.
- Background asset `mobile/assets/settings-personal-data-bg.png` exported from Figma `imgSettingsPersonalData`.
- Functional inputs (`useState` per field), pre-populated with Figma example values.
- Functional comboboxes with empty options + "Selecione aqui" placeholder.
- `Salvar alterações` → `router.back()` (no persistence — demo phase).
- Visual verification via Playwright on Expo web (390×844).

**Out of scope (NOT done here):**
- Real form submission / backend wiring.
- Real combobox option sources (Profissão / Setor / Função / Gerente lists).
- Field-level validation (CPF format, email regex, phone mask).
- Input masks (date `00/00/0000`, CPF `000.000.000-00`, phone `(00) 00000 0000`).
- Other Settings sub-screens (Suporte, Privacy, FAQ, Dados de saúde, Alterar senha, Permissões).
- `keyboard_arrow_left` Figma-exact path update (uses existing DS Material Symbols glyph).
- Pixel-diff harness in CI.

---

## Section 1 — DS bump: `TopBar`

**Repo:** `C:\Users\Gabriel\Documents\swi-design-system`
**Path:** `src/components/TopBar/`
**Bump:** `v0.1.37 → v0.1.38`.

**Props:**
```ts
interface TopBarProps {
  /** Page title shown right-aligned, content.dark. */
  title: string;
  /** Back-button press handler. When provided, chevron + label render. */
  onBack?: () => void;
  /** Override the back-button label. Defaults to "Voltar". */
  backLabel?: string;
  accessibilityLabel?: string;
  testID?: string;
}
```

**Visual (Figma 353:11629):**
- Container: `width: 360` (canvas inteiro), `paddingHorizontal: theme.padding.m`, `paddingVertical: theme.padding.s`, row layout, `alignItems: center`.
- Back slot (left, optional): `Pressable` with row layout, `gap: theme.gap.xs`, `paddingHorizontal: 0`, `paddingVertical: theme.padding.sm`, `borderRadius: theme.border.radius.m`.
  - `Icon name="keyboard_arrow_left" width={7.4} height={12} color={theme.content['primary-light']}`.
  - Text — Montserrat Bold 14 (`theme.fontSize.m`, `theme.fontWeight.bold`, `theme.fontFamily.title`), color `theme.content['primary-light']`.
- Title slot (right): Text Montserrat Bold 14, color `theme.content.dark`, `flex: 1`, `textAlign: 'right'`.

**Token additions:** verify `content.primary-light` (#CAE8D4) exists in `semantic.ts`. If absent, add it (additive change — no consumer breakage).

**Icons:** `keyboard_arrow_left` already in DS (Material Symbols). Used as-is. Phase 2: refresh to Figma-exact if asset becomes available.

**Storybook:** `TopBar.stories.tsx` with 2 stories: `Default` (with onBack and title), `WithCustomBackLabel` (backLabel="Cancelar").

**Output:** build dist, version-bump `package.json`, commit + tag v0.1.38, push to GitHub.

---

## Section 2 — Files & routes

| File | Action | Contents |
|---|---|---|
| `swi-design-system/src/components/TopBar/TopBar.tsx` | new | Implementation per Section 1 |
| `swi-design-system/src/components/TopBar/TopBar.types.ts` | new | `TopBarProps` |
| `swi-design-system/src/components/TopBar/TopBar.styles.ts` | new | styled-components |
| `swi-design-system/src/components/TopBar/TopBar.stories.tsx` | new | 2 stories |
| `swi-design-system/src/components/TopBar/index.ts` | new | barrel |
| `swi-design-system/src/index.ts` | edit | export TopBar + TopBarProps |
| `swi-design-system/src/tokens/semantic.ts` | edit (if needed) | Add `content['primary-light']` if absent |
| `swi-design-system/package.json` | edit | Version bump 0.1.37 → 0.1.38 |
| `mobile/app/(app)/settings/personal-data.tsx` | rewrite | Full form per Section 3 |
| `mobile/assets/settings-personal-data-bg.png` | new | Figma `imgSettingsPersonalData` export |
| `mobile/package.json` | edit | DS pin v0.1.37 → v0.1.38 |
| `mobile/package-lock.json` | regen | via `npm install` |

**Untouched:** `_layout.tsx`, sibling Settings stubs (`change-password.tsx`, `faq.tsx`, `health-data.tsx`, `preferences.tsx`, `support.tsx`, `privacy.tsx`).

**Navigation:**
- Back chevron `‹ Voltar` → `router.back()` (returns to `/(app)/settings`)
- `Salvar alterações` → `router.back()` (no persistence — demo phase)
- Home FAB → `router.push('/(app)/dashboard')`

---

## Section 3 — Screen composition (`personal-data.tsx`)

**Imports:**
```tsx
import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button, Combobox, Icon, Input, Title, TopBar, useTheme,
} from '@kavicki/swi-design-system';
```

**Top-down structure:**

```tsx
<View flex:1 bg:theme.background>
  {/* Bg overlay — dashboard pattern: wrapper View pointerEvents=none */}
  <View pointerEvents="none" style={{ position:'absolute', top:0,left:0,right:0,bottom:0 }}>
    <RNImage source={require('../../../assets/settings-personal-data-bg.png')}
             resizeMode="cover" style={{ width:'100%', height:'100%' }} />
  </View>

  <ScrollView contentContainerStyle={{
    paddingTop: insets.top,
    paddingBottom: insets.bottom + 120,
    alignItems: 'center',
  }}>
    <TopBar title="Dados pessoais" onBack={() => router.back()} />

    <View style={{ width: 328, gap: theme.gap.m, marginTop: theme.padding.xxl, alignItems:'stretch' }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Dados da cadastro
      </Title>

      <Input label="Nome Completo"        value={nome}      onChangeText={setNome} />
      <Input label="Data de Nascimento"   value={data}      onChangeText={setData} />
      <Input label="CPF"                  value={cpf}       onChangeText={setCpf} />
      <Input label="Email"                value={email}     onChangeText={setEmail}    keyboardType="email-address" />
      <Input label="Telefone"             value={telefone}  onChangeText={setTelefone} keyboardType="phone-pad" />

      {/* Row UF (77) + Cidade (flex) */}
      <View style={{ flexDirection:'row', gap: theme.gap.sm }}>
        <View style={{ width: 77 }}>
          <Input label="UF" value={uf} onChangeText={setUf} maxLength={2} autoCapitalize="characters" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Cidade" value={cidade} onChangeText={setCidade} />
        </View>
      </View>

      <Combobox label="Profissão"            placeholder="Selecione aqui" options={[]} value={profissao} onChange={setProfissao} />
      <Combobox label="Setor"                placeholder="Selecione aqui" options={[]} value={setor} onChange={setSetor} />
      <Combobox label="Função"               placeholder="Selecione aqui" options={[]} value={funcao} onChange={setFuncao} />
      <Combobox label="Gerente responsável"  placeholder="Selecione aqui" options={[]} value={gerente} onChange={setGerente} />

      <Button
        variant="contained"
        backgroundColor={theme.surface.primary}
        labelColor={theme.content.light}
        label="Salvar alterações"
        elevation="lg"
        onPress={() => router.back()}
      />
    </View>
  </ScrollView>

  {/* Home FAB — mesmo pattern de Settings (28.286×25.458 dims) */}
  <View pointerEvents="box-none" style={{ position:'absolute', bottom: insets.bottom + theme.gap.l, left:0, right:0, alignItems:'center' }}>
    <Button variant="contained" shape="pill" size="xlarge"
            backgroundColor={theme.content.dark}
            borderColor={theme.content.disable}
            borderWidth={10}
            elevation="lg"
            iconLeft={<Icon name="home" width={28.286} height={25.458} color={theme.surface.standard} />}
            accessibilityLabel="Voltar para a dashboard"
            onPress={() => router.push('/(app)/dashboard')} />
  </View>
</View>
```

**Initial state (per Figma example values):**
```ts
const [nome, setNome] = useState('Carlos Sampaio');
const [data, setData] = useState('00/00/0000');
const [cpf, setCpf] = useState('000.000.000-00');
const [email, setEmail] = useState('seu@email.com');
const [telefone, setTelefone] = useState('(00) 00000 0000');
const [uf, setUf] = useState('MG');
const [cidade, setCidade] = useState('Quitandinha');
const [profissao, setProfissao] = useState('');
const [setor, setSetor] = useState('');
const [funcao, setFuncao] = useState('');
const [gerente, setGerente] = useState('');
```

**Decisions baked in:**
- Inputs are functional (`useState`) pre-populated with Figma values. No masks (Phase 2).
- Comboboxes use empty `options=[]` + placeholder "Selecione aqui". If DS Combobox crashes on empty array, fallback to `[{label:'—', value:''}]` placeholder option.
- `Salvar alterações` does `router.back()` — no persistence, no toast. Same demo discipline as Sair on Settings hub.
- TopBar inside ScrollView (scrolls with content, not sticky). Phase 2 if user wants sticky.
- Home FAB matches Settings pattern (FAB stays consistent across the drill-down).
- Background asset extracted from Figma — same strategy as `settings-bg.png`.

---

## Section 4 — Verification & acceptance

**Pipeline (must pass before commit 2):**
1. `cd swi-design-system && npm run build` — DS dist builds clean.
2. `cd mobile && npx tsc --noEmit` — zero new errors in `personal-data.tsx`.
3. `cd mobile && npx expo start --web --port <free>` (background).
4. Playwright resize → 390×844; navigate to `http://localhost:<port>/settings/personal-data`.
5. Screenshot to `docs/audits/mobile/settings/personal-data-fidelity-2026-05-14.png`.
6. Compare with `c:\Users\Gabriel\Downloads\settings-personal-data.png`. Document divergences.

**Acceptance criteria (all PASS to commit):**
- (a) TopBar `‹ Voltar` left + `Dados pessoais` right, Montserrat Bold 14, back label in `content.primary-light`.
- (b) Section title "Dados da cadastro" in `content.primary` green, Montserrat Bold 16.
- (c) 5 inputs single-column visible with bold label + pre-filled value.
- (d) Row UF (77) / Cidade (flex) aligned, gap.sm between.
- (e) 4 comboboxes with placeholder "Selecione aqui" + chevron-down right.
- (f) Salvar button full-width green (`surface.primary`), `content.light` text, elevation-lg.
- (g) Home FAB centered bottom with `content.disable` border framing.
- (h) Background pattern subtly visible.

**Failure modes & responses:**
- Combobox crashes on `options=[]` → use single placeholder option.
- `content.primary-light` token missing → add in DS bump (Section 1 note).
- Asset URL expired → fallback to manual Figma export.

---

## Section 5 — Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `content.primary-light` (#CAE8D4) not in semantic.ts | Medium | Added in DS v0.1.38 bump |
| Combobox with `options=[]` errors | Low | Test in DS Storybook first; fallback to dummy option |
| Figma asset URL expired (7d TTL) | Low | Download immediately in Task 3 |
| `keyboard_arrow_left` Material differs from Figma | Low | Documented as Phase 2 (same as v0.1.37 cycle) |
| FAB overlaps Salvar on small viewport | Medium | `paddingBottom: insets.bottom + 120` gives clearance; iterate if needed |
| Many fields cause ScrollView jank on Expo web | Low | Native is the target; accept web perf as debug-only |

**Rollback:**
- Screen commit (commit 2): `git revert HEAD` in SWI-mobile.
- DS bump: revert mobile `package.json` pin to v0.1.37 + `npm install`. DS commit kept as history (additive).

---

## Commit plan

**Commit 1 — DS repo** (`C:\Users\Gabriel\Documents\swi-design-system`):
```
feat(ds): add TopBar component + content.primary-light (v0.1.38)

Drill-down navigation TopBar with chevron-left back button + title.
Props: title, onBack?, backLabel? (default "Voltar"). Tokens: padding.m
horiz / padding.s vert, gap.xs back-slot, content.primary-light back
label, content.dark title. Storybook stories included.

Reusável em todas as sub-telas Settings (Suporte, Privacy, FAQ,
Saúde, Senha, Permissões) e onboarding/auth.

Figma ref: 353:11629.
```
Build dist + version bump + tag v0.1.38 + push.

**Commit 2 — Mobile repo** (`C:\Users\Gabriel\Documents\SWI-mobile`, branch `feat/mobile-login`):
```
feat(mobile): settings/personal-data screen (Figma 353:11560)

Replace placeholder Surface with full Dados pessoais form: TopBar
(DS v0.1.38), section title, 5 inputs + UF/Cidade row + 4 comboboxes,
Salvar alterações button, Home FAB to dashboard. Pre-populated com
valores Figma; useState locally, sem persistência (demo phase).
Salvar → router.back().

Asset: mobile/assets/settings-personal-data-bg.png.
```

---

## Phase 2 preview (NOT in this plan)

- `keyboard_arrow_left` Figma-exact path refresh (if user exports asset).
- Input masks for Data/CPF/Phone fields.
- Field-level validation.
- Real combobox option sources (Profissão / Setor / Função / Gerente).
- Real form submission to backend.
- Sticky TopBar (`position: 'absolute', top: insets.top`).
- Other Settings sub-screens.

---

**Next step:** invoke `superpowers:writing-plans` to produce the executable step-by-step plan.
