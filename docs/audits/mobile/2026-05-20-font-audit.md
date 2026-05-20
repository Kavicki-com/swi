# Mobile Font Audit — 2026-05-20

**Escopo:** mobile only. Design doc: `docs/plans/2026-05-20-mobile-font-audit-design.md`.

## 1. Sumário executivo

- **Branch auditada:** `feat/mobile-login` (worktree `C:/Users/Gabriel/Documents/SWI-mobile/`, último commit `ace8884` em 2026-05-20 18:56). DS instalado via `.tgz` local de `v0.1.79` — tokens idênticos a `v0.1.28`.
- **Telas mapeadas:** 42 telas reais, com 42 subseções §4.1–§4.42 (mais 2 de sistema sem ground truth Figma: `+not-found.tsx`, `index.tsx`; e 11 `_layout.tsx` ignorados). Ver §3.
- **Total de findings estruturais:** ~31 entradas tipo (a)–(f) nas tabelas de §4, sendo aproximadamente 21 de severidade **alta** e 10 de severidade **média/baixa**. Tela com **zero finds estruturais** modelo: §4.42 (Weather Alert Modal).
- **Root cause da camada de loading (§2):** split web/native deliberado em `_layout.tsx`. **Web funciona perfeitamente** — `FontFace` API com weight descriptor explícito; nenhum problema esperado em browser. **Native iOS/Android tem limitação real**: RN não bridgea `fontWeight` cosmético para lookup de family, então todas as variantes `Inter 500` e `Inter 700` (`subtitle.*`, `body.l`, `body.s`, `caption.s`, `caption.xs`) renderizam em Inter Regular (400). Se o QA testou em build native, o relato "fontes erradas em todas as telas" é parcialmente verdadeiro — explica o sintoma sem precisar de fix per-tela.
- **5 gaps no DS (§6)** cobrem ~80% dos findings estruturais. Triplets faltantes que aparecem repetidamente no Figma e são absorvidos hoje por overrides:
  - (a) Inter 700 / 14 (~20+ ocorrências — labels Input, CTAs, names, breadcrumbs).
  - (b) Montserrat 700 / 14 (~15+ ocorrências — ghost buttons, TopBar, Pagination).
  - (c) Inter 700 / 12 (~10 ocorrências — badges, dates inline, ChatUserCard).
  - (d) Inter 700 / 16 (6 ocorrências — info-grid labels em chat user-info + blood type).
  - (e) Inter 500 / 12 italic (2 ocorrências — email destacado em fluxo de confirmação).
- **Top 3 padrões cross-cutting (de §5):**
  1. **Inter Bold 14** (§5.1) — labels de Input e CTAs primary/outline emitidos pelo DS + overrides `weight="bold"` em 8 telas. Gap (a).
  2. **Montserrat Bold 14** (§5.2) — ghost button + TopBar + Pagination, emitidos pelo DS hoje com tokens hardcoded. Gap (b).
  3. **Override `fontWeight: bold` sobre `body.m`** (§5.7) — emphasis inline em 8 call-sites diferentes (journey names, complimentary labels, settings "Histórico Médico", smartband "Smartband"). Sintoma direto do gap (a).
- **Padrão arquitetural positivo identificado (§5.10):** privacy + support modais são reutilizados em 2 contextos (auth + settings) via **1 componente + 2 wrappers de rota**. Tipografia 100% idêntica entre instâncias — decisão correta, registrar como referência.
- **Caminho de correção (§7):** 7 passos sequenciados por alavancagem.
  1. Loading native (DS emite family weight-aware) → resolve ~80% do impacto visual em iOS/Android sem editar telas.
  2. DS bump v0.1.80+ (5 gaps + componentes internos) → resolve gaps cross-cutting + zera overrides emitidos por componentes DS.
  3. Cleanup de overrides em telas → ~24 overrides `weight=bold`/`fontStyle=italic`/`fontWeight=700` viram `<Text variant="X">` declarativos.
  4. Padronização semântica `body.s` vs `caption.s` → harmoniza dashboard vs my-stats.
  5. Findings (c) avulsos → ~5 trocas pontuais.
  6. Chat input nu (único tipo (a) do audit) → bump do `Input` DS pra suportar layout customizado.
  7. Manual review → ata de design para ambiguidades + anomalias Figma (§8).
- **Estimativa de impacto cumulativo:** após Passos 1+2, ~80% dos findings ficam resolvidos sem editar uma única tela (mudança vive no DS + `_layout.tsx`). Após Passos 1+2+3, ~95% resolvidos. Após Passos 1–6, 100% dos findings estruturais. Passo 7 (manual review) fecha desambiguações remanescentes.
- **Anomalias colaterais detectadas no Figma** (não causadas pelo código, reportar pro designer — §8.5): typo "Dados **da** cadastro", capitalização "**HI**stórico Médico", token `size/ms` resolvendo para fallback 20px em vez do esperado 16px na tela `new-report`.



## 2. Root cause — loading layer

> **Branch autoritativa:** todo o trabalho mobile real vive em `feat/mobile-login` (worktree `C:/Users/Gabriel/Documents/SWI-mobile/`), último commit `ace8884` em 2026-05-20 18:56. O QA testou esta branch. Demais branches contendo `mobile/`:
> - `main` (último merge 2026-05-14): estado anterior do mobile, vários commits atrás. Não é o que está sendo testado.
> - `feat/admin-real-maps-and-fixes`: branch de trabalho admin que carrega um stash uncommitted de stubs mobile de 11 linhas — **lixo, ignorar**.
>
> Esta seção descreve o estado em `feat/mobile-login` (DS `v0.1.79`). Tokens do DS em `v0.1.79` são idênticos a `v0.1.28` (mesma estrutura `typography.ts`, mesmas 12 variantes, mesmos triplets `(family, weight, size)`); a tabela Figma→variante DS do design doc segue válida.

### 2.A. Setup atual em `_layout.tsx` (138 linhas)

O arquivo tem um setup **deliberadamente sofisticado** com split entre web e native:

**Native (iOS/Android):**

```tsx
useFonts({
  Inter: Inter_400Regular,
  'Inter-Medium': Inter_500Medium,
  'Inter-Bold': Inter_700Bold,
  Montserrat: Montserrat_700Bold,   // ⚠ chave 'Montserrat' aponta para Bold
  'Montserrat-Regular': Montserrat_400Regular,
  'Montserrat-Medium': Montserrat_500Medium,
})
```

- A chave `'Montserrat'` aponta intencionalmente para o **Bold** porque o DS usa Montserrat exclusivamente em títulos (todos `fontWeight 700`).
- A chave `'Inter'` aponta para Regular (uso predominante: `body.m`).
- Aliases `'Inter-Medium'`, `'Inter-Bold'`, `'Montserrat-Regular'`, `'Montserrat-Medium'` estão registrados — **mas o DS não os emite**: tokens em `typography.ts` passam só `fontFamily: 'Inter'` ou `'Montserrat'` + `fontWeight` como prop separada.

**Web:**

`useFonts({})` (vazio) + `useEffect` que registra 6 `FontFace` manualmente com `weight` descriptor explícito via `document.fonts.add()`. Quando CSS pede `Inter 500` ou `Inter 700`, o browser encontra o face certo e renderiza com weight real (sem synthetic-bold borrado). O comentário no código (L51–L55) cita exatamente este motivo.

**Outros aspectos:**
- Splash gating com timeout de 5s: `ready = fontsLoaded || fontError || fontTimeout` (L106). Splash some quando qualquer um dispara — evita travamento se Google Fonts CDN estiver offline.
- `mobile-frame` constraint na web (L31–L37): `maxWidth: 360px` centralizado horizontalmente. Mantém fidelidade ao Figma em browsers desktop.
- `GestureHandlerRootView` + `SafeAreaProvider` + `SwiThemeProvider` + `AuthProvider` ancorando o `<Stack>`.
- `mobile/assets/fonts/` continua **não existindo** — depende 100% dos pacotes `@expo-google-fonts/*` em runtime (download via CDN no boot).

### 2.B. `package.json`

Versões relevantes:
- `@expo-google-fonts/inter`: `^0.4.2`
- `@expo-google-fonts/montserrat`: `^0.4.2`
- `expo-font`: `~14.0.11`
- `expo-splash-screen`: `~31.0.13`
- `@kavicki/swi-design-system`: `file:../../swi-design-system/kavicki-swi-design-system-0.1.79.tgz` (instalação local via `.tgz`, não via Git tag).

### 2.C. Expectativa do DS (`v0.1.79`)

Tokens em `mobile/node_modules/@kavicki/swi-design-system/src/tokens/typography.ts` (idêntico a `v0.1.28`):

- `fontFamily.title = 'Montserrat'`, `fontFamily.body = 'Inter'`
- `fontWeight`: 300 / 400 / 500 / 700
- 12 variantes:
  - `title.l/m/s/xs` → Montserrat 700 + 32/24/20/16
  - `subtitle.l/m/s` → Inter 500 + 24/16/12
  - `body.l/m/s` → Inter 500/400/500 + 20/14/12
  - `caption.s/xs` → Inter 500/700 + 12/8

### 2.D. Avaliação de cobertura (Native vs Web)

| Variante DS | Triplet pedido | Como Native resolve hoje | Como Web resolve hoje |
|---|---|---|---|
| `title.*` (Montserrat 700) | `('Montserrat', 700)` | RN procura family `'Montserrat'` → encontra Bold. **OK** | FontFace `Montserrat` weight 700 registrado. **OK** |
| `body.m` (Inter 400) | `('Inter', 400)` | RN procura `'Inter'` → encontra Regular. **OK** | FontFace `Inter` weight 400 registrado. **OK** |
| `subtitle.*` (Inter 500) | `('Inter', 500)` | RN procura `'Inter'` (Regular). `fontWeight=500` é descritor cosmético — RN não troca de arquivo. **Renderiza em peso 400.** ⚠ | FontFace `Inter` weight 500 registrado. Browser encontra o face certo. **OK** |
| `body.l`, `body.s`, `caption.s` (Inter 500) | idem | idem ao acima. **Renderiza em peso 400.** ⚠ | **OK** |
| `caption.xs` (Inter 700) | `('Inter', 700)` | RN procura `'Inter'` (Regular). **Renderiza em peso 400.** ⚠ | FontFace `Inter` weight 700 registrado. **OK** |

### 2.E. Conclusão

O QA reportou "fontes erradas em praticamente todas as telas".

- **Se o QA testou em browser/web:** o setup atual deve estar funcionando perfeitamente em quase tudo. Algum erro pontual ainda é possível (variante errada no código, override inline), mas não "todas as telas". Phase 3 (sweep per-tela) vai identificar.
- **Se o QA testou em build native iOS/Android:** o relato é em parte verdadeiro. Títulos Montserrat estão certos, `body.m` está certo. Mas **todas as variantes que pedem Inter Medium (500) ou Inter Bold (700)** — `subtitle.l/m/s`, `body.l`, `body.s`, `caption.s`, `caption.xs` — renderizam em Inter Regular (400) por limitação do RN nativo: ele lookups por family-name único, não bridge weight descritor. Esse é o root cause native real.

### 2.F. Fix recomendado (alto nível)

**Pra resolver o problema native** (sem mudar o setup web que já funciona):

- **Opção (a) — Shim no `SwiThemeProvider` ou `Text` do DS no native:** quando renderizar `('Inter', 500)`, trocar para `('Inter-Medium', 'normal')`; idem para 700 → `'Inter-Bold'`. O `_layout.tsx` já registra os aliases — só falta o DS consumir eles.
- **Opção (b) — Mudar tokens do DS pra emitir family weight-aware:** `typography.ts` passa a setar `fontFamily: 'Inter-Medium'` em variantes 500 e `'Inter-Bold'` em variantes 700, removendo dependência do `fontWeight` descritor. Mais limpo, mas requer bump coordenado (swi-admin web também tem que registrar aliases).
- **Opção (c) — Patch local no `_layout.tsx`:** envolver `SwiThemeProvider` num provider que injeta um `Text` customizado que faz o swap. Não toca DS, fica isolado no mobile.

Opção (b) é a definitiva. Opção (a) ou (c) servem como fix tático até o DS bumpar.

**Verificação visual após fix:** rodar em iOS Simulator + Android emulador, abrir 2–3 telas que usam `subtitle.*` ou `caption.xs` (ex: `account-confirmation`, `complimentary-data/step-1`, `dashboard`) e comparar com Figma.

Detalhe (snippets de código, paths exatos, ordem de commits) fica para a rodada subsequente de `writing-plans` (plano de correção).

## 3. Mapeamento rota → Figma

**Fonte de código:** worktree `C:/Users/Gabriel/Documents/SWI-mobile/` (branch `feat/mobile-login`). Glob de `mobile/app/**/*.tsx` → 55 arquivos: 11 `_layout.tsx`, 2 de sistema (`+not-found.tsx`, `index.tsx` redirect), **42 telas reais**.

**Fonte Figma:** `fileKey=bzDUuPdSiKgl5xucBH0IYE`, canvas Mobile `nodeId=138:5997`.

| Rota | Arquivo | nodeId Figma | Nome no Figma | Status |
|---|---|---|---|---|
| /(auth)/login | `app/(auth)/login.tsx` | 138:7937 | login | ok |
| /(auth)/sign-up | `app/(auth)/sign-up.tsx` | 138:7963 | sign-up | ok |
| /(auth)/email-sent | `app/(auth)/email-sent.tsx` | 211:12920 | email-confirmation-message | ok (fluxo sign-up) |
| /(auth)/account-confirmation | `app/(auth)/account-confirmation.tsx` | 211:12994 | account-creation-confirmation | ok |
| /(auth)/password-recovery/email | `app/(auth)/password-recovery/email.tsx` | 138:7948 | password-recovery-step=email | ok |
| /(auth)/password-recovery/email-sent | `app/(auth)/password-recovery/email-sent.tsx` | 290:688 | email-confirmation-message (variant pwd-recovery) | manual review |
| /(auth)/password-recovery/new-password | `app/(auth)/password-recovery/new-password.tsx` | 138:7955 | password-recovery-step-newpassword | ok |
| /(auth)/complimentary-data/step-1 | `app/(auth)/complimentary-data/step-1.tsx` | 211:13009 | complimentary-data-step-1 | ok |
| /(auth)/complimentary-data/step-2 | `app/(auth)/complimentary-data/step-2.tsx` | 213:13390 | complimentary-data-step-2 | ok |
| /(auth)/complimentary-data/step-3 | `app/(auth)/complimentary-data/step-3.tsx` | 213:13464 | complimentary-data-step-3 | ok |
| /(onboarding)/smartband/connection-start | `app/(onboarding)/smartband/connection-start.tsx` | 215:17901 | smartband-connection-start | ok |
| /(onboarding)/smartband/connection | `app/(onboarding)/smartband/connection.tsx` | 215:13790 | smartband-connection | ok |
| /(onboarding)/smartband/complete | `app/(onboarding)/smartband/complete.tsx` | 245:18895 | smartband-connection-complete | ok |
| /(app)/dashboard | `app/(app)/dashboard.tsx` | 245:23280 | dashboard | ok |
| /(app)/evacuation | `app/(app)/evacuation.tsx` | 385:30193 | evacuation-route | ok |
| /(app)/evacuation-ongoing | `app/(app)/evacuation-ongoing.tsx` | 385:30336 | evacuation-route-ongoing | ok |
| /(app)/notifications | `app/(app)/notifications.tsx` | 401:30469 | notifications | ok |
| /(app)/my-stats | `app/(app)/my-stats.tsx` | 342:9419 | my-stats | ok |
| /(app)/map | `app/(app)/map.tsx` | 385:28757 | map-view-general | ok |
| /(app)/map-weather | `app/(app)/map-weather.tsx` | 385:21840 | map-metereologic-alerts | ok |
| /(app)/journey | `app/(app)/journey/index.tsx` | 364:16378 | journey | ok |
| /(app)/journey/ongoing | `app/(app)/journey/ongoing.tsx` | 364:17609 | journey-ongoing | ok |
| /(app)/journey/pause | `app/(app)/journey/pause.tsx` | 364:17766 | journey-pause | ok |
| /(app)/journey/task/[id] | `app/(app)/journey/task/[id].tsx` | 364:17126 | task-details | manual review |
| /(app)/reports | `app/(app)/reports/index.tsx` | 364:18596 | reports | ok |
| /(app)/reports/[id] | `app/(app)/reports/[id].tsx` | 364:20304 | report-details | ok |
| /(app)/reports/new | `app/(app)/reports/new.tsx` | 372:21297 | new-report | ok |
| /(app)/reports/responsibles | `app/(app)/reports/responsibles.tsx` | 364:18017 | responsables-modal | ok (rota não-modal) |
| /(app)/chat/inbox | `app/(app)/chat/inbox.tsx` | 336:8808 | chat-inbox | ok |
| /(app)/chat/[userId] | `app/(app)/chat/[userId].tsx` | 332:8580 | chat | ok |
| /(app)/chat/user-info | `app/(app)/chat/user-info.tsx` | 336:8891 | chat-user-info | ok |
| /(app)/settings | `app/(app)/settings/index.tsx` | 348:10615 | settings | ok |
| /(app)/settings/personal-data | `app/(app)/settings/personal-data.tsx` | 353:11560 | settings-personal-data | ok |
| /(app)/settings/health-data | `app/(app)/settings/health-data.tsx` | 353:12057 | settings-health-data | ok |
| /(app)/settings/change-password | `app/(app)/settings/change-password.tsx` | 353:12228 | settings-change-password | ok |
| /(app)/settings/preferences | `app/(app)/settings/preferences.tsx` | 357:12302 | settings-preferences | ok |
| /(app)/settings/faq | `app/(app)/settings/faq.tsx` | 361:12425 | FAQ | ok |
| /(app)/settings/privacy | `app/(app)/settings/privacy.tsx` | 348:10434 | privacy-policy-modal (variant settings) | manual review |
| /(app)/settings/support | `app/(app)/settings/support.tsx` | 348:10426 | support-form-modal (variant settings) | manual review |
| /modals/support-form | `app/modals/support-form.tsx` | 213:13742 | support-form-modal (auth row) | manual review |
| /modals/privacy-policy | `app/modals/privacy-policy.tsx` | 213:13750 | privacy-policy-modal (auth row) | manual review |
| /modals/weather-alert | `app/modals/weather-alert.tsx` | 385:29371 | alert-modal | ok |

**Notas de "manual review" (7):**

- `password-recovery/email-sent` — Figma `290:688` é uma variante do "email-confirmation-message" usado pelo fluxo de password-recovery. Confirmar visualmente que difere da versão de sign-up (`211:12920`).
- `journey/task/[id]` — dois frames `task-details` no Figma (`364:17126` 800px e `364:17434` 970px); preferi `364:17126` (canônico). Pode haver dois estados visuais (curto/longo).
- `settings/privacy` ↔ `modals/privacy-policy` e `settings/support` ↔ `modals/support-form` — o Figma tem duas instâncias de cada modal: uma na fileira auth (`213:13742`/`213:13750`, contexto: usuário deslogado) e uma na fileira settings (`348:10426`/`348:10434`, contexto: usuário autenticado). O código `feat/mobile-login` materializou os DOIS contextos como rotas distintas: rota modal acessível do auth flow + página completa dentro de `(app)/settings/`. Phase 3 deve auditar cada uma contra sua instância Figma específica.

**Rotas sem ground truth Figma (2):**
- `app/+not-found.tsx` — tela de erro do expo-router; sem design.
- `app/index.tsx` — redirect; não renderiza UI.

(Os 11 `_layout.tsx` ficam fora do escopo de UI textual.)

**Frames Figma sem rota correspondente no código:**
- `364:17434` "task-details" (variante alongada 970px — provavelmente estado visual de `journey/task/[id]`).
- `385:29138` "dashboard-alert-active" e `385:29591` "dashboard-alert-active" — estados do dashboard com alerta ativo; provavelmente render condicional dentro de `dashboard.tsx`.
- Section `443:3327` "components-mobile" — biblioteca de componentes do DS; fora do escopo de telas.
- Frames `1256:10650`, `1256:10658`, `1256:10701`, `1256:10997` — variantes iPhone 16-sized (393×852); estudos de viewport iOS.

## 4. Findings per-tela

> **Fonte do código:** worktree `feat/mobile-login` em `C:/Users/Gabriel/Documents/SWI-mobile/mobile/`.
> Findings abaixo são **estruturais** — variante errada, override hardcoded, `Text` de RN nu, etc. O root cause de loading (§2) impacta a renderização visual em native mas não cria findings adicionais aqui.

### 4.1 Login (`app/(auth)/login.tsx`)

**Figma:** [login (138:7937)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=138-7937)

Tela renderiza apenas componentes do DS (`Logo`, `Input`, `Button`, `Icon`) — não há `<Text>` direto. A tipografia de todos os elementos textuais (label "Login"/"Senha", placeholders, label dos botões "Recuperar senha"/"Entrar"/"Primeiro acesso"/"Suporte") é gerenciada internamente pelos componentes do DS. Nenhum override hardcoded de `fontFamily`/`fontWeight`/`fontSize` no arquivo da tela.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| — | — | — | nenhum finding direto na tela | — |

**Notas:** Figma exibe label Input em `Inter Bold 14` e CTAs em `Inter Bold 14` (cross-cutting candidato — fora da tabela DS, gap (e) potencial). Como esses textos são emitidos pelo DS (`Input`, `Button`), o gap é estrutural no DS, não nesta tela. Ghost buttons "Recuperar senha"/"Suporte" no Figma usam `Montserrat Bold 14` (também fora da tabela). Cross-cutting consolidado em §5.

### 4.2 Sign-up (`app/(auth)/sign-up.tsx`)

**Figma:** [sign-up (138:7963)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=138-7963)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/sign-up.tsx:60` | — | `body.m` (Inter 400/14) | `body.m` em `Text` do DS | ok |
| `app/(auth)/sign-up.tsx:58` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |

**Notas:**
- Figma mostra label do primeiro Input "Nome completo" em Inter Regular 14 (não Bold), enquanto demais labels ("Email", "Crie uma senha", "Confirme sua senha") em Inter Bold 14. Código usa `labelWeight="regular"` em **todos** os 4 inputs (linhas 68, 77, 88, 96) — divergência (c) em 3 deles vs Figma. Severidade média porque é prop do `Input` do DS, não override hardcoded; pode ser intencional para padronizar.
- `Toast` (L105) e `Checkbox` (L111) emitem tipografia interna do DS — fora do escopo.
- Botão "Política de privacidade & Termos de uso" (L118-125) passa `labelFamily="body"` `labelWeight="regular"` explicitamente — Figma mostra Inter Regular 14 underlined; consistente.

### 4.3 Email Sent (`app/(auth)/email-sent.tsx`)

**Figma:** [email-confirmation-message (211:12920)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=211-12920)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/email-sent.tsx:58` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |
| `app/(auth)/email-sent.tsx:59` | — | `body.s` (Inter 500/12) | `body.s` em `Text` do DS | ok |
| `app/(auth)/email-sent.tsx:61-67` | (d) | `body.s` italic (Inter Medium Italic 12) | `body.s` + override inline `fontStyle: 'italic'` | média |
| `app/(auth)/email-sent.tsx:61-67` | (e) | Inter Medium Italic 12 não existe no DS | DS não emite italic — só Regular/Medium/Bold | alta |

**Notas:**
- O span do email destacado (linha 61-67) usa `fontStyle: 'italic'` inline + cor `theme.content.secondaryLight` (azul, ~#8ad2e2 no Figma). Triplet `Inter Medium Italic 12` está fora da tabela DS — é um **gap real**. Padrão cross-cutting com `password-recovery/email-sent`.
- Desambiguação `subtitle.s` / `body.s` / `caption.s` (todas Inter Medium 12): contexto é texto corrido descritivo abaixo do título → **body.s** (decisão manual review resolvida).

### 4.4 Account Confirmation (`app/(auth)/account-confirmation.tsx`)

**Figma:** [account-creation-confirmation (211:12994)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=211-12994)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/account-confirmation.tsx:66` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |
| `app/(auth)/account-confirmation.tsx:67` | — | `body.s` (Inter Medium 12) | `body.s` em `Text` do DS | ok |

**Notas:**
- Figma descreve a description "Você será redirecionado..." em `Inter Medium 12` cor `content/medium` — código bate (variante + `theme.content.medium`).
- Desambiguação `subtitle.s`/`body.s`/`caption.s`: texto descritivo único centralizado abaixo do título → **body.s**.

### 4.5 Password Recovery — Email (`app/(auth)/password-recovery/email.tsx`)

**Figma:** [password-recovery-step=email (138:7948)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=138-7948)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/password-recovery/email.tsx:44` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |
| `app/(auth)/password-recovery/email.tsx:45` | — | `body.m` (Inter 400/14) | `body.m` em `Text` do DS | ok |

**Notas:** Sem findings diretos. Label do Input ("e-mail") com case lowercase intencional — Figma confirma.

### 4.6 Password Recovery — Email Sent (`app/(auth)/password-recovery/email-sent.tsx`)

**Figma:** [email-confirmation-message variant pwd-recovery (290:688)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=290-688)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/password-recovery/email-sent.tsx:56` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |
| `app/(auth)/password-recovery/email-sent.tsx:57` | — | `body.s` (Inter 500/12) | `body.s` em `Text` do DS | ok |
| `app/(auth)/password-recovery/email-sent.tsx:59-65` | (d) | `body.s` italic (Inter Medium Italic 12) | `body.s` + override inline `fontStyle: 'italic'` | média |
| `app/(auth)/password-recovery/email-sent.tsx:59-65` | (e) | Inter Medium Italic 12 não existe no DS | DS não emite italic | alta |

**Notas:**
- Variant pwd-recovery do email-confirmation-message: Figma confirma copy "Acesse o link de recuperação" + body com email destacado em italic. Mesma estrutura de email-sent (signup) — padrão duplicado.
- Desambiguação resolvida como **body.s** (mesma lógica de 4.3).

### 4.7 Password Recovery — New Password (`app/(auth)/password-recovery/new-password.tsx`)

**Figma:** [password-recovery-step-newpassword (138:7955)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=138-7955)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(auth)/password-recovery/new-password.tsx:44` | — | `title.xs` (Montserrat 700/16) | `title.xs` em `Title` do DS | ok |
| `app/(auth)/password-recovery/new-password.tsx:45` | — | `body.m` (Inter 400/14) | `body.m` em `Text` do DS | ok |

**Notas:** Sem findings diretos. Toast + PasswordInput emitem tipografia interna do DS.

### 4.8 Complimentary Data — Step 1 (`app/(auth)/complimentary-data/step-1.tsx`)

**Figma:** [complimentary-data-step-1 (211:13009)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=211-13009)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/OnboardingHeader.tsx:26-31` | — | greeting multi-span (`title.s` 20 + `title.l` 32) | dois `Title` separados (`title.s` + `title.l`) | ok |
| `components/OnboardingHeader.tsx:33` | — | `body.m` (Inter 400/14) | `body.m` em `Text` | ok |
| `app/(auth)/complimentary-data/step-1.tsx:71` | — | `title.xs` cor primary (Montserrat 700/16 verde) | `title.xs` + `color: theme.content.primary` | ok |
| `app/(auth)/complimentary-data/step-1.tsx:112` | — | `title.xs` cor primary | `title.xs` + `color: theme.content.primary` | ok |

**Notas:**
- Greeting multi-span no Figma (`Boas vindas %username%!` num único `<p>` com 2 spans, 20px + 32px). Código decompõe em **dois `Title` separados** (OnboardingHeader L26-31) — comentário do componente justifica a escolha (line break independente do comprimento do username). Visual final equivalente. Não é um finding (a)-(f).
- Labels do `Input` (4 campos) usam `labelWeight="regular"` (linhas 78, 86, 94, 102). Figma confirma `Inter Regular 14` para todos (idênticos à tela). OK.
- `helperText` do `ImageUploader` ("Selecione arquivos do tipo: JPG ou PNG") emitido internamente pelo DS — Figma confirma `Inter Medium 12`.

### 4.9 Complimentary Data — Step 2 (`app/(auth)/complimentary-data/step-2.tsx`)

**Figma:** [complimentary-data-step-2 (213:13390)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=213-13390)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/OnboardingHeader.tsx:26-33` | — | greeting + description | reused (ver §4.8) | ok |
| `app/(auth)/complimentary-data/step-2.tsx:58` | — | `title.xs` cor primary | `title.xs` + `color: theme.content.primary` | ok |

**Notas:**
- Figma mostra labels dos inputs deste step ("CEP", "Logradouro", "Número", "Bairro", "UF") em **`Inter Bold 14`** (não Regular). O código **não** passa `labelWeight="regular"` aos `Input` (linhas 63-98) — herda o default do DS. Se o default do `Input` for Bold, está correto; se for Regular, há divergência. **Manual review** — depende do default do componente DS.
- Greeting/description compartilhados pelo `OnboardingHeader`.

### 4.10 Complimentary Data — Step 3 (`app/(auth)/complimentary-data/step-3.tsx`)

**Figma:** [complimentary-data-step-3 (213:13464)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=213-13464)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/OnboardingHeader.tsx:26-33` | — | greeting + description | reused (ver §4.8) | ok |
| `app/(auth)/complimentary-data/step-3.tsx:96` | — | `title.xs` cor primary | `title.xs` + `color: theme.content.primary` | ok |
| `app/(auth)/complimentary-data/step-3.tsx:101-103` | (d) | label "Seu gênero" `Inter Bold 14` | `Text variant="body.m"` + `fontWeight: theme.fontWeight.bold` override | média |
| `app/(auth)/complimentary-data/step-3.tsx:155-157` | (d) | label "Pessoa com deficiência?" `Inter Bold 14` | `Text variant="body.m"` + `fontWeight: theme.fontWeight.bold` override | média |

**Notas:**
- Linhas 101 e 155: override inline de `fontWeight` no `Text` do DS. Body.m é `Inter 400/14`; forçar bold via `theme.fontWeight.bold` muda o weight pra 700 mantendo family Inter — visualmente é `Inter Bold 14`, que coincide com label do Input do Figma. Mas é tipo (d) — override em vez de usar variante adequada. Triplet `Inter 700 14` não está coberto pela tabela DS (apenas Inter 400/500/700 com sizes 14/12/8) — `body.m` é 400, `caption.xs` é 700 mas 8px. Provável **gap (e)** cross-cutting para "label de input" no DS (já candidato listado).
- Combobox/Input do DS labels emitidos internamente — mesma observação de §4.9: depende do default.

### 4.11 Smartband — Connection Start (`app/(onboarding)/smartband/connection-start.tsx`)

**Figma:** [smartband-connection-start (215:17901)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=215-17901)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(onboarding)/smartband/connection-start.tsx:66-72` | — | `title.s` (Montserrat 700/20) Figma | `Title variant="title.s"` | ok |

**Notas:**
- Figma codifica `text-[length:var(--size/ms,20px)]` no Title — corresponde a `title.s` (Montserrat 700/20). Código usa exatamente `title.s`.
- Métrica do Figma cita `title/s: Font(family: title, weight 700, size: size/ml=20)` confirmando.
- `SmartbandStatus` (L78-81) é componente do DS — tipografia interna fora do escopo.
- Importante: Figma chama o size de `ms` mas valor é 20px (font-size token nomenclature do DS).

### 4.12 Smartband — Connection (`app/(onboarding)/smartband/connection.tsx`)

**Figma:** [smartband-connection (215:13790)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=215-13790)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(onboarding)/smartband/connection.tsx:39` | — | greeting span 1 (Montserrat 700/20) | `Title variant="title.s"` | ok |
| `app/(onboarding)/smartband/connection.tsx:42` | — | greeting span 2 (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(onboarding)/smartband/connection.tsx:45` | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(onboarding)/smartband/connection.tsx:51` | — | título instruções `title.s` 20px | `Title variant="title.s"` | ok |
| `app/(onboarding)/smartband/connection.tsx:54-63` | — | body.m com inline bold | `Text variant="body.m"` (outer) + nested `Text variant="body.m"` com `fontWeight: theme.fontWeight.bold` (inline span "Smartband") | ok-ish |
| `app/(onboarding)/smartband/connection.tsx:58-62` | (d) | inline emphasis bold = `Inter Bold 14` | `body.m` + override `fontWeight: theme.fontWeight.bold` | média |
| `app/(onboarding)/smartband/connection.tsx:64` | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(onboarding)/smartband/connection.tsx:67` | — | `body.m` | `Text variant="body.m"` | ok |

**Notas:**
- Figma greeting "Vamos configurar a sua Smartband" é dividido em 2 spans (20px + 32px) num único `<p>`. Código materializa em 2 `Title` separados (linhas 39-44) — mesma decisão do `OnboardingHeader`.
- Inline emphasis "Smartband" (L56-62) é tipo (d) — override de fontWeight em vez de variante. Triplet `Inter Bold 14` é o mesmo gap (e) recorrente.
- Padrão cross-cutting confirmado: multi-span greeting (`title.s` + `title.l`).

### 4.13 Smartband — Complete (`app/(onboarding)/smartband/complete.tsx`)

**Figma:** [smartband-connection-complete (245:18895)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=245-18895)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(onboarding)/smartband/complete.tsx:36-42` | — | `title.s` (Montserrat 700/20) | `Title variant="title.s"` | ok |

**Notas:**
- Figma cita `title/s: weight 700, size size/ml=20`. Código bate.
- `SmartbandStatus` (L49-54) é componente do DS — figma confirma que internamente usa `body.l` (Inter Medium 20) para a message "Configuração concluída...". Não há override no chamador.
- Botão "Finalizar" (L55-60) emitido pelo DS — fora do escopo.

### 4.14 Dashboard (`app/(app)/dashboard.tsx`)

**Figma:** [dashboard (245:23280)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=245-23280) — estado normal. Estados condicionais: [dashboard-alert-modal (385:29138)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-29138) (mesmo layout, gradiente bg → vermelho + modal "Local em Alerta!" sobreposto) e [dashboard-alert-active (385:29591)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-29591) (sub-view `AlertActiveView` — timeline de evacuação).

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/dashboard.tsx:674` (`StatCol` value) | — | `title.l` (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(app)/dashboard.tsx:677` (`StatCol` label) | — | `subtitle.s` / `body.s` (Inter 500/12) | `Text variant="body.s"` | ok (manual review) |
| `app/(app)/dashboard.tsx:568` | — | `body.m` (Inter 400/14) "Tempo até atingir fadiga total: 1h45m" | `Text variant="body.m"` | ok |
| `app/(app)/dashboard.tsx:820` (`BadgedButton` badge "4") | (c) + (e) | Figma marca badge "4" em **Inter Bold 12** (gap (e), fora da tabela DS) | `Text variant="caption.s"` (Inter 500/12) | alta |
| `app/(app)/dashboard.tsx:889` (`AlertActiveView` title) | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/dashboard.tsx:940` (`AlertActiveView` "17ºC") | — | `title.l` (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(app)/dashboard.tsx:943` ("Chuva Intensa") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/dashboard.tsx:1112` (`WeatherDataRow` value) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/dashboard.tsx:960-967` (description) | — | `body.s` (Inter 500/12) | `Text variant="body.s"` | ok |
| `app/(app)/dashboard.tsx:976,1005,1018,1041` (timeline steps) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/dashboard.tsx:1030` ("Aprox. 7 minutos" chip) | — | `body.s` (Inter 500/12) cor primary | `Text variant="body.s"` + `color={theme.content.primary}` | ok |
| `app/(app)/dashboard.tsx:1060-1066` ("Mantenha-se calmo...") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |

**Notas:**
- Tela mais densa do escopo (1117 linhas, 3 estados + dois sub-componentes locais `StatCol`/`BadgedButton`/`FatigueBar`/`WeatherDataRow`). Nenhum `Text` de RN nu; nenhum override inline de `fontFamily`/`fontWeight`/`fontSize` em uso (apenas `style={{ textAlign }}` benignos).
- **Stat label "BPM"/"Boa"/"Kcal/hora" (L677):** Figma marca como `Inter Medium 12` — coincide com triplet de `body.s`, `subtitle.s` e `caption.s`. Código usa `body.s`. Como é label sob um valor numérico Montserrat, `subtitle.s` seria semanticamente mais preciso (label de seção/sub-rótulo) mas `body.s` renderiza idêntico no DS. **Manual review** mantido em §8.
- **Badge "4" (`BadgedButton` L820 / Figma 304:2722):** Figma usa explicitamente `font-['Inter:Bold',sans-serif]` + `text-[12px]` (Inter 700/12) com cor `#222` (content.light). Código usa `caption.s` (Inter 500/12) com `content.light`. Diferença de peso é (c) variante errada **e** (e) gap real — triplet `Inter 700/12` não existe no DS (`caption.s` é 500/12 e `caption.xs` é 700/8). Tom da divergência: o texto fica visualmente Medium em vez de Bold dentro do badge vermelho.
- **AlertActiveView (`?alert=active`):** Figma `385:29591` (não puxado por estar fora do nodeId base, mas variantes do dashboard listadas em §3 como estados condicionais). Triplets observados no código (`title.xs`, `body.m`, `body.s`) batem com o padrão dos cards do DS já validado em outras telas; nenhum override.
- **Dashboard alert-modal (`?alert=modal`):** mesmo layout do estado normal, apenas cor de gradiente do `BG_DECOR_PATH` muda (`BG_DECOR_GRAD_TOP_ALERT`/`BG_DECOR_GRAD_BOTTOM_ALERT`) + modal `WeatherAlertModal` sobreposto (componente local em `components/modals/`, fora do escopo desta tela; conta no batch D `/modals/weather-alert`).
- `ProgressBar` é local (`FatigueBar`, L688) — sem texto interno.

### 4.15 Evacuation (`app/(app)/evacuation.tsx`)

**Figma:** [evacuation-route (385:30193)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-30193)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/evacuation.tsx:140-142` ("Procedimento de evacuação") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` + `color={theme.content.dark}` | ok |
| `app/(app)/evacuation.tsx:169-175` ("Rota de evacuação") | — | `title.xs` cor success (Montserrat 700/16, color `#65d040`) | `Title variant="title.xs"` + `color={theme.content.success}` | ok |
| `app/(app)/evacuation.tsx:176-182` (instruction card body) | — | `body.s` (Inter 500/12) | `Text variant="body.s"` | ok |
| `MapChipBody` ("6 minutos"/"17 minutos", L117/124) | — | `body.s` (Inter 500/12) | componente local `components/MapChipBody.tsx` — tipografia fora do escopo da tela | n/a |

**Notas:**
- Componentes locais (`MapView`, `MapLineSource`, `MapMarker`, `MapChipBody`, `NavFABs`, `LocationPin`) renderizam tipografia internamente; a tela só emite o título "Procedimento de evacuação", o título do card "Rota de evacuação", o body do card, e o label do botão "Continuar".
- Botão "Continuar" (L183-191) é `Button` do DS — label `Montserrat Bold 14` (ver pattern §5 — Montserrat/700/14 em CTAs primários do DS).

### 4.16 Evacuation Ongoing (`app/(app)/evacuation-ongoing.tsx`)

**Figma:** [evacuation-route-ongoing (385:30336)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-30336)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| — | — | — | nenhum `<Text>`/`<Title>` direto na tela | — |

**Notas:**
- Tela sem texto próprio. Único texto visível (`MapChipBody "6 minutos"`/`"17 minutos"`, L74-89) vem do componente local `MapChipBody.tsx`. Pins (`LocationPin badge`), polyline e nav arrow são gráficos.
- Figma confirma: layout só de mapa fullscreen + 2 chips + 1 pin + nav arrow. Sem cards, sem títulos.
- Tela renderiza apenas em web (`Platform.OS !== 'web'` → `ProdOnlyPlaceholder`). Fallback é componente local, fora do escopo.

### 4.17 Notifications (`app/(app)/notifications.tsx`)

**Figma:** [notifications (401:30469)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=401-30469)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/notifications.tsx:142-144` ("Notificações") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/notifications.tsx:168-174` (card title) | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` + `numberOfLines={1}` | ok |
| `app/(app)/notifications.tsx:175-177` (card body) | — | `body.s` (Inter 500/12) | `Text variant="body.s"` | ok |

**Notas:**
- 12 cards estáticos com mesma estrutura. Toda tipografia bate.
- Card é composto inline (Pressable + View + Title + Text + Pressable do ícone) em vez de usar `HorizontalCard` do DS — Figma referencia `HorizontalCard` (component `I401:30538;2053:1397`), mas tipografia interna do DS bate com o que o código emite, então não é finding de fonte.
- Pattern recorrente do batch B: `title.xs` para título de tela centralizado/seção.

### 4.18 My Stats (`app/(app)/my-stats.tsx`)

**Figma:** [my-stats (342:9419)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=342-9419)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/my-stats.tsx:263-269` (vital "67") | — | `title.l` (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(app)/my-stats.tsx:270-276` ("BPM") | — | `subtitle.s`/`body.s` (Inter 500/12) | `Text variant="caption.s"` | ok (manual review) |
| `app/(app)/my-stats.tsx:294-300` ("12/8") | — | `title.l` | `Title variant="title.l"` | ok |
| `app/(app)/my-stats.tsx:301-307` ("Boa") | — | `subtitle.s`/`body.s` | `Text variant="caption.s"` | ok (manual review) |
| `app/(app)/my-stats.tsx:326-332` ("145") | — | `title.l` | `Title variant="title.l"` | ok |
| `app/(app)/my-stats.tsx:333-339` ("Kcal/hora") | — | `subtitle.s`/`body.s` | `Text variant="caption.s"` | ok (manual review) |
| `app/(app)/my-stats.tsx:364-366` ("Tempo até atingir fadiga total: 1h45m") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/my-stats.tsx:503-505` ("Gasto calórico" section title) | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/my-stats.tsx:537-539` ("Alergias" section title) | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/my-stats.tsx:569-571` (chips de alergia "Buscopan" etc) | — | `body.s` (Inter 500/12) cor light | `Text variant="body.s"` + `color={theme.content.light}` | ok |
| `app/(app)/my-stats.tsx:584-586` ("Histórico Médico") | — | `title.xs` | `Title variant="title.xs"` | ok |

**Notas:**
- **Discrepância de variante para stat labels (`BPM`/`Boa`/`Kcal/hora`, L270/301/333):** código usa `caption.s`, Figma marca como `Inter Medium 12` que coincide com `subtitle.s`, `body.s` E `caption.s` (todos Inter 500/12). Diferença é semântica, não visual: `caption.s` no DS é Inter 500/12 idêntico ao `body.s`. Mesma divergência semântica do dashboard (`StatCol` usa `body.s` lá vs `caption.s` aqui — **inconsistência interna entre as duas telas** que renderizam o mesmo bloco visual de vitals). Mark como manual review em §8.
- **Vital signs row paralela ao dashboard:** mesmo padrão `title.l` (valor) + label em variante Inter 500/12; dashboard L677 escolheu `body.s`, my-stats L271/302/334 escolheu `caption.s` — inconsistência interna a ser harmonizada.
- `ExamInfoCard` (L588-601) componente do DS — Figma mostra year em `Inter Bold 14`, date em `body.s`, exam name em `body.s` cor secondary. Tudo emitido pelo DS; fora do escopo da tela.
- `ImageUploader` helper "Selecione arquivos do tipo: JPG ou PNG" e label do botão "Enviar novo exame" — emitidos pelo DS.
- `Combobox` value "Hoje" — emitido pelo DS (Figma confirma `body.m`).
- `LineCaloriesChart` (chart-line + 9 tags `body.s` + 9 timestamps `caption.xs`) — componente do DS.
- `Button` "Editar alergias" (variant outline) emite `Inter Bold 14` (ver pattern §5 — Inter/700/14 em label de outline button).

### 4.19 Map View General (`app/(app)/map.tsx`)

**Figma:** [map-view-general (385:28757)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-28757)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/map.tsx:441-443` (`RadiusPill` label "5KM"/"10KM") | — | `Inter Regular 14` (Inter 400/14 = `body.m`) cor light | `Text variant="body.m"` + `color={theme.content.light}` | ok |

**Notas:**
- Tela quase 100% mapa (MapLibre satellite) + bridge maplibre/createRoot pra pins. Único texto direto é o pill de raio "5KM"/"10KM" — Figma codifica explicitamente `font-['Inter:Regular',sans-serif]` `text-[14px]`, idêntico ao `body.m` do DS. Código bate.
- Pins de operadores/câmeras/avatar usam `LocationPin` do DS (tipografia interna fora do escopo).
- Tela web-only (`Platform.OS !== 'web'` → `ProdOnlyPlaceholder`); na native usa o placeholder local.
- Figma usa `not-italic leading-[16px]` no pill — `body.m` do DS pode renderizar com line-height `normal` (não `16`) dependendo do `Text` token; é uma diferença de altura de linha, não de família/peso/tamanho, fora do escopo deste audit.

### 4.20 Map Weather (`app/(app)/map-weather.tsx`)

**Figma:** [map-metereologic-alerts (385:21840)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-21840)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| — | — | — | nenhum `<Text>`/`<Title>` direto na tela | — |

**Notas:**
- Tela sem texto próprio. Layout é fullscreen map + 2 heatmaps (tempestades #BC88FF + inundações orange→red) + 11 alert pins (`LocationPin variant="badge"`) + 3 toggle buttons icon-only (`MapToggleButton` local). Nada textual.
- Figma confirma: zero `<p>` no design context — só pins e ícones.
- Tela web-only (mesma band-aid do `map.tsx` / `evacuation-ongoing.tsx`).

### 4.21 Journey (`app/(app)/journey/index.tsx`)

**Figma:** [journey (364:16378)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-16378)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/journey/index.tsx:56-58` ("Hoje") | — | `title.l` (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(app)/journey/index.tsx:59-61` ("27/04/2026") | (d) + (e) | data Inter Bold 12 (Figma `font-['Inter:Bold'] text-[12px]`) | `Text variant="body.s"` + `weight="bold"` | alta |
| `app/(app)/journey/index.tsx:67-69` ("Romulo Cardoso") | (d) + (e) | nome Inter Bold 14 (gap recorrente) | `Text variant="body.m"` + `weight="bold"` | alta |
| `app/(app)/journey/index.tsx:70-72` ("Mecânico maquinário B2") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/journey/index.tsx:77-95` (DonutChart) | — | center "8h" `title.s` + "Não iniciadas" `caption.xs` | `DonutChart` do DS com overrides `iconWidth/Height=18`, `labelSize=8`, `labelWeight="bold"` | ok |
| `app/(app)/journey/index.tsx:98-100` ("Próximas tarefas") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/journey/index.tsx:141-147` (task title) | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` + `numberOfLines={1}` | ok |
| `app/(app)/journey/index.tsx:148-150` (task description) | — | `body.s` (Inter 500/12) | `Text variant="body.s"` | ok |
| `app/(app)/journey/index.tsx:158-166` (Button "Iniciar Jornada") | — | label `Inter Bold 14` (gap (e) cross-cutting, emitido pelo Button do DS) | `Button` do DS | ok |

**Notas:**
- **L59-61 "27/04/2026":** Figma codifica explicitamente `font-['Inter:Bold',sans-serif] text-[12px]`. Triplet `Inter 700/12` fora da tabela DS (`caption.s` é Inter 500/12, `caption.xs` é Inter 700/8). Código aplica `body.s` (Inter 500/12) + `weight="bold"` override — visualmente Inter Bold 12, batendo com Figma, mas via prop ad-hoc. Mesmo padrão recorre em journey/ongoing, journey/pause (date row); soma 3 ocorrências do triplet.
- **L67-69 "Romulo Cardoso":** mesmo padrão recorrente — `body.m` + `weight="bold"` = Inter Bold 14 (gap (e) confirmado também em batches A/B; aqui se confirma no batch C). Avatar info pattern.
- **DonutChart:** label "Não iniciadas" usa `labelSize=8` + `labelWeight="bold"` → equivale a `caption.xs` (Inter 700/8) emitido internamente. OK porque o DS expõe overrides numéricos pra esse component (pattern já validado em batch B em complimentary-data/step-1 via `OnboardingHeader`/`ImageUploader`).
- Greeting "Hoje" é single-Title (L56) — não há multi-span split como em onboarding (não há greeting de username dinâmico aqui).
- "Iniciar Jornada" label Figma confirma `font-['Inter:Bold',sans-serif] text-[14px]` — Button contained primary do DS emite isso; gap (e) cross-cutting já contado.

### 4.22 Journey Ongoing (`app/(app)/journey/ongoing.tsx`)

**Figma:** [journey-ongoing (364:17609)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-17609)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/journey/ongoing.tsx:57-59` ("Hoje") | — | `title.l` (Montserrat 700/32) | `Title variant="title.l"` | ok |
| `app/(app)/journey/ongoing.tsx:60-62` ("27/04/2026") | (d) + (e) | Inter Bold 12 (gap recorrente) | `Text variant="body.s"` + `weight="bold"` | alta |
| `app/(app)/journey/ongoing.tsx:68-70` ("Romulo Cardoso") | (d) + (e) | Inter Bold 14 | `Text variant="body.m"` + `weight="bold"` | alta |
| `app/(app)/journey/ongoing.tsx:71-73` ("Mecânico maquinário B2") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/journey/ongoing.tsx:78-93` (DonutChart "Em andamento") | — | "7:55:12h" `title.s` + "Em andamento" `caption.xs` | DS DonutChart com overrides 18/18/8/bold | ok |
| `app/(app)/journey/ongoing.tsx:98-100` ("Em andamento" section title) | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/ongoing.tsx:143-148` (active task title) | — | `title.xs` | `Title variant="title.xs"` + `numberOfLines={1}` | ok |
| `app/(app)/journey/ongoing.tsx:150-152` (active task desc) | — | `body.s` | `Text variant="body.s"` | ok |
| `app/(app)/journey/ongoing.tsx:159-161` ("Próximas tarefas") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/ongoing.tsx:198-204` (upcoming task title) | — | `title.xs` | `Title variant="title.xs"` + `numberOfLines={1}` | ok |
| `app/(app)/journey/ongoing.tsx:205-207` (upcoming task desc) | — | `body.s` | `Text variant="body.s"` | ok |
| `app/(app)/journey/ongoing.tsx:217-225` ("Finalizar Jornada" CTA) | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |
| `app/(app)/journey/ongoing.tsx:226-233` ("Fazer pausa" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline"` | ok |

**Notas:**
- Layout idêntico ao journey/index, +seção "Em andamento" com active task + dois CTAs no rodapé. Mesmos padrões; mesmos finds (date Inter Bold 12, name Inter Bold 14).
- Outline button "Fazer pausa" label cor `theme.surface.accent` (laranja #f5a125) — Figma confirma `font-['Inter:Bold'] text-[14px] text-[color:var(--surface/accent)]`. Gap (e) já contado.

### 4.23 Journey Pause (`app/(app)/journey/pause.tsx`)

**Figma:** [journey-pause (364:17766)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-17766)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/journey/pause.tsx:54-56` ("Hoje") | — | `title.l` | `Title variant="title.l"` | ok |
| `app/(app)/journey/pause.tsx:57-59` ("27/04/2026") | (d) + (e) | Inter Bold 12 | `Text variant="body.s"` + `weight="bold"` | alta |
| `app/(app)/journey/pause.tsx:65-67` ("Romulo Cardoso") | (d) + (e) | Inter Bold 14 | `Text variant="body.m"` + `weight="bold"` | alta |
| `app/(app)/journey/pause.tsx:68-70` ("Mecânico maquinário B2") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/journey/pause.tsx:75-91` (DonutChart "Pausado") | — | "7:55:12h" `title.s` + "Pausado" `caption.xs` | DS DonutChart com overrides | ok |
| `app/(app)/journey/pause.tsx:96-98` ("Em andamento") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/pause.tsx:141-146` (active task title) | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/pause.tsx:148-150` (active task desc) | — | `body.s` | `Text variant="body.s"` | ok |
| `app/(app)/journey/pause.tsx:156-158` ("Próximas tarefas") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/pause.tsx:195-201` (upcoming task title) | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/pause.tsx:202-204` (upcoming task desc) | — | `body.s` | `Text variant="body.s"` | ok |
| `app/(app)/journey/pause.tsx:214-222` ("Finalizar Jornada" disabled) | — | label Inter Bold 14 (gap (e)) | `Button` do DS, disabled | ok |
| `app/(app)/journey/pause.tsx:223-230` ("Retomar" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline"` | ok |

**Notas:**
- Variação visual de ongoing — apenas DonutChart label "Pausado" + CTA primário disabled + outline label "Retomar". Tipografia idêntica; mesma contagem de finds (date/name patterns).

### 4.24 Journey Task Details (`app/(app)/journey/task/[id].tsx`)

**Figma:** [task-details (364:17126)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-17126) — variante idle. Variante alongada `364:17434` (in-progress) é a mesma tela com 3 CTAs (Finalizar/Pausa/Cancelar) em vez de 1; mesma tipografia.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/journey/task/[id].tsx:80-82` ("Jornada" breadcrumb item) | (c) + (e) | Inter Bold 14 cor primary (Figma `font-['Inter:Bold'] text-[#62bb81] text-[14px]`) | `Text variant="body.m"` + `weight="bold"` + `color={theme.content.primary}` | alta |
| `app/(app)/journey/task/[id].tsx:94-101` (task title breadcrumb item) | (c) + (e) | Inter Bold 14 cor primary | `Text variant="body.m"` + `weight="bold"` + `color={theme.content.primary}` | alta |
| `app/(app)/journey/task/[id].tsx:118-124` (card title) | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` + `numberOfLines={1}` | ok |
| `app/(app)/journey/task/[id].tsx:125-127` (card description) | — | `body.s` (Inter 500/12) | `Text variant="body.s"` | ok |
| `app/(app)/journey/task/[id].tsx:133-135` ("Progresso da tarefa") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/task/[id].tsx:148-150` ("Objetivo principal") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/task/[id].tsx:151-154` (objetivo body) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/journey/task/[id].tsx:161-163` ("Fotos da solicitação") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/task/[id].tsx:185-187` ("Tempo estimado") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/task/[id].tsx:188-190` ("3h até a conclusão") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/journey/task/[id].tsx:195-197` ("Interessados") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/journey/task/[id].tsx:205-207` (interessados body) | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/journey/task/[id].tsx:213-220` ("Finalizar tarefa" CTA) | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |
| `app/(app)/journey/task/[id].tsx:222-229` ("Fazer pausa" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline"` | ok |
| `app/(app)/journey/task/[id].tsx:230-236` ("Cancelar tarefa" ghost) | — | label Inter Bold 14 (gap (e)) | `Button variant="ghost"` | ok |
| `app/(app)/journey/task/[id].tsx:239-252` ("Iniciar Jornada e começar tarefa") | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |

**Notas:**
- **Breadcrumb (L80-82 e L94-101):** Figma codifica `font-['Inter:Bold',sans-serif] text-[14px] text-[#62bb81]`. Triplet `Inter 700/14` é o **mesmo gap (e) cross-cutting recorrente**. Código usa `body.m` (Inter 400/14) + `weight="bold"` override — visualmente Inter Bold 14, mas via override em vez de variante.
- Manual review do `364:17434` (variante 970px alongada in-progress) — resolução: mesmo conteúdo, mesma tipografia, diferença é apenas que `isOngoing` mostra 3 CTAs em vez de 1; já capturado pelas linhas 213-236.
- AvatarGroup "+13" (componente do DS, L198-204) emite `caption.xs` internamente; Figma confirma `Inter Bold 8` — match.
- "Joacir Alves e mais 17 pessoas..." (L205-207) é `body.m` cor dark; Figma usa `text-[length:var(--size/m,14px)]` Inter Regular — match.
- Tela sem `NavFABs` (intencional — sub-rota de journey, não tem chat/home FABs no Figma 364:17126). Confirmação visual da decisão estrutural.

### 4.25 Reports List (`app/(app)/reports/index.tsx`)

**Figma:** [reports (364:18596)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-18596)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| — | — | — | nenhum `<Text>`/`<Title>` direto na tela | — |

**Notas:**
- Tela renderiza apenas `SearchInput` + `Button` "Novo relatório" + lista de `ReportCard` (componente do DS) + `Pagination`. Zero `Text`/`Title` direto.
- **Toda tipografia visível é emitida internamente por componentes do DS.** Findings indiretos (gaps que aparecem na renderização final mas não são culpa da tela):
  - SearchInput placeholder "Pesquisar relatório" = Inter Regular 14 (`body.m`) ✓
  - Button "Novo relatório" label = Inter Bold 14 (gap (e), conhecido)
  - ReportCard StatusTag = Inter Bold 8 (gap (e) — Inter 700/8 = `caption.xs` ✓)
  - ReportCard title = Montserrat Bold 16 → `title.xs` cor primary ✓
  - ReportCard "Resumo" label = Inter Medium 12 → `body.s` ✓
  - ReportCard summary body = Inter Regular 14 → `body.m` ✓
  - ReportCard "Data de criação" label = **Inter Bold 12** (gap (e), Inter 700/12 não existe no DS)
  - ReportCard date value = Inter Regular 14 → `body.m` ✓
  - ReportCard "Autor" label = Inter Medium 12 → `body.s` ✓
  - ReportCard author name = Inter Medium 12 → `body.s` ✓
  - ReportCard "Setor Noroeste" = **Inter Bold 12** cor `#8ad2e2` (gap (e))
  - ReportCard "Responsáveis" label = **Inter Bold 12** (gap (e))
  - ReportCard responsibles value = Inter Regular 14 → `body.m` ✓
  - Pagination buttons = Montserrat Bold 14 (gap (e) cross-cutting — Montserrat 700/14, mesmo dos ghost buttons)
- **Variação intra-ReportCard:** o `ReportCard` na listing (Figma `364:17962+`) usa Inter Medium 12 pra labels "Resumo"/"Autor" e Inter Bold 12 pra "Data de criação"/"Responsáveis"; já em `report-details` (vide §4.26) o mesmo card usa Inter Bold 14 pra "Resumo"/"Autor". Decisão de design (provável: card-em-página mais denso). Não é finding desta tela.
- Tela sem text próprio = nenhum finding direto.

### 4.26 Report Details (`app/(app)/reports/[id].tsx`)

**Figma:** [report-details (364:20304)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-20304)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/reports/[id].tsx:119-135` ("Voltar" ghost) | — | label Montserrat Bold 14 (gap (e) cross-cutting) | `Button variant="ghost"` | ok |
| `app/(app)/reports/[id].tsx:144-157` ("Fazer comentário" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline" size="small"` | ok |
| `app/(app)/reports/[id].tsx:159-172` ("Revisar relatório" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline" size="small"` | ok |
| `app/(app)/reports/[id].tsx:190-192` ("Detalhes do relatório:") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/reports/[id].tsx:193-199` (DETAIL_TEXT) | (d) | `body.m` cor dark com lineHeight 1.4 | `Text variant="body.m"` + `style={{ lineHeight: theme.fontSize.m * 1.4 }}` | baixa |
| `app/(app)/reports/[id].tsx:204-206` ("Imagens") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/reports/[id].tsx:232-234` ("Atividades") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/reports/[id].tsx:260-262` (activity title) | (c) + (e) | Figma codifica `family/title:Inter:Regular weight/bold size/ms:14` = Inter Bold 14 (gap recorrente) | `Text variant="body.m"` (Inter 400/14, sem bold) | alta |
| `app/(app)/reports/[id].tsx:263-265` (activity sector) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/reports/[id].tsx:285-292` (Input "Adicionar comentário") | — | label Inter Bold 14 (gap (e), Input do DS) | `Input` do DS | ok |
| `app/(app)/reports/[id].tsx:294-302` ("Fazer comentário" CTA) | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |

**Notas:**
- **L260-262 activity title:** Figma codifica `family/title: Inter:Regular` family + `weight/bold` + `size/ms: 14` = Inter Bold 14. Note que o token `family/title` no Figma é confusamente reusado pra Inter aqui (não Montserrat) — provável bug do Figma; mas o pixel renderizado é Inter Bold 14. Código usa `body.m` (Inter 400/14) **sem** override de weight — divergência **visual real**: a tela renderiza activity title em Inter Regular enquanto Figma pede Inter Bold. Tipo (c) variante errada + (e) gap. Severidade alta porque é visualmente perceptível (peso diferente em label de card).
- **L193-199 DETAIL_TEXT lineHeight:** override inline de lineHeight, não de family/weight/size. Tipo (d) tecnicamente, mas é leitura — mantenho baixa severidade. Figma usa `leading-[normal]` (default = 1.0); código aplica 1.4. Divergência intencional pra legibilidade de parágrafo longo. Pode ser harmonizado adicionando variante DS com lineHeight ajustado, ou aceitar como override de tela.
- **ReportCard interno renderizado nesta tela (`I364:20894`):** Figma mostra a variante **destacada** do card, com "Resumo"/"Autor" em Inter Bold 14 + summary/date/author/responsibles values em Inter Medium 12. Diferente da variante da listing. Tipografia emitida pelo DS — fora do escopo da tela; mas reflete diferença interna do componente entre dois usos.
- Activity card: Figma mostra title em Inter Bold 14 mas o subtitle "Setor Noroeste"/"Setor Central" em Inter Regular 14 (`body.m`). Código usa `body.m` em ambos — bate no subtitle mas perde peso no title. Triplet Inter 700/14 cross-cutting já contado.

### 4.27 New Report (`app/(app)/reports/new.tsx`)

**Figma:** [new-report (372:21297)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=372-21297)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/reports/new.tsx:79-94` ("Voltar" ghost) | — | label Montserrat Bold 14 (gap (e)) | `Button variant="ghost"` | ok |
| `app/(app)/reports/new.tsx:97-99` ("Novo relatório" form title) | — | `title.s` (Montserrat 700/20) cor primary | `Title variant="title.s"` + `color={theme.content.primary}` | ok |
| `app/(app)/reports/new.tsx:102-107` (Input "Título do relatório") | — | label Inter Bold 14 (gap (e), Input do DS) | `Input` do DS | ok |
| `app/(app)/reports/new.tsx:108-113` (Input "Resumo do relatório") | — | label Inter Bold 14 (gap (e)) | `Input` do DS | ok |
| `app/(app)/reports/new.tsx:116-123` (Input "Detalhes" multiline) | — | label Inter Bold 14 (gap (e)) | `Input` do DS multiline | ok |
| `app/(app)/reports/new.tsx:127-135` ("Atribuir responsáveis" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline"` | ok |
| `app/(app)/reports/new.tsx:138-140` ("Anexos") | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |
| `app/(app)/reports/new.tsx:164-170` (ImageUploader) | — | helper text `body.s` + button "Enviar arquivo" Montserrat Bold 14 (gap (e)) | `ImageUploader` do DS | ok |
| `app/(app)/reports/new.tsx:173-181` ("Salvar relatório" CTA) | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |
| `app/(app)/reports/new.tsx:182-188` ("Cancelar" ghost) | — | label Inter Bold 14 (gap (e)) | `Button variant="ghost"` | ok |

**Notas:**
- **L97-99 form title "Novo relatório":** Figma codifica de forma ambígua: `text-[length:var(--size/ms,20px)]` — o nome do token (`size/ms`) é o de 16px no DS, mas o fallback (`20px`) é o do `size/ml` (20). Cross-referenciando com a screenshot, o texto renderiza em ~20px (alinhado a `title.s`, Montserrat 700/20). Código usa `title.s` ✓. **Anomalia do Figma**, não do código.
- **Triplet `Montserrat 700/14`** aparece em **Voltar ghost (L79)**, **ImageUploader "Enviar arquivo" outline (interno DS)** e — em outras telas do batch — botões de paginação. Continua sendo gap (e) cross-cutting cumulativo.
- **Sem `<Text>` direto** — tela 100% composta de componentes DS. Gaps todos cross-cutting via DS.

### 4.28 Reports Responsibles Modal (`app/(app)/reports/responsibles.tsx` + `components/modals/ResponsiblesModal.tsx`)

**Figma:** [responsables-modal (364:18017)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=364-18017)

Rota `responsibles.tsx` é wrapper de envelope `transparentModal` + backdrop; conteúdo real vive em `components/modals/ResponsiblesModal.tsx`. Auditoria abaixo cobre o componente que renderiza o textual.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/ResponsiblesModal.tsx:93-95` ("Selecionar responsáveis") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `components/modals/ResponsiblesModal.tsx:96-98` (body subtítulo) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `components/modals/ResponsiblesModal.tsx:134-141` (admin name) | (d) + (e) | nome Inter Bold 14 (Figma `font-['Inter:Bold'] text-[14px]`) | `Text variant="body.m"` + `weight="bold"` | alta |
| `components/modals/ResponsiblesModal.tsx:142-144` ("32 anos") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `components/modals/ResponsiblesModal.tsx:149-155` (blood type "O+") | (c) + (d) + (e) | Inter Bold **16** (Figma `font-['Inter:Bold'] text-[16px]`) — Inter 700/16 fora do DS | `Text variant="body.m"` (Inter 400/14) + `weight="bold"` — peso bate, **tamanho não** (14 vs 16) | alta |
| `components/modals/ResponsiblesModal.tsx:170-177` ("Cancelar" outline) | — | label Inter Bold 14 (gap (e)) | `Button variant="outline"` | ok |
| `components/modals/ResponsiblesModal.tsx:178-186` ("Continuar" CTA) | — | label Inter Bold 14 (gap (e)) | `Button` do DS | ok |

**Notas:**
- **L134-141 admin name:** mesmo padrão Inter Bold 14 (gap (e)) já cross-cutting. Override via `weight="bold"` em `body.m`.
- **L149-155 blood type:** este é um finding **adicional** ao gap recorrente — Figma pede **Inter Bold 16** (Inter 700/16, completamente fora do DS — nenhuma variante atual tem size 16 + family body). Código usa `body.m` (size 14) + bold — renderiza em Inter Bold 14, **2px menor** que o Figma. Tipo (c) variante errada (size mismatch) + (e) gap (Inter 700/16 não existe). É o blood type number — visual: badge "O+"/"AB-"/"A+" exibido menor do que o design.
- Backdrop `surface.medium` (override de cor de modal documentado no comentário L78-90) — fora do escopo de tipografia.
- A rota wrapper `responsibles.tsx` (L1-43) tem zero texto próprio; toda análise transferida pro componente.

### 4.29 Chat Inbox (`app/(app)/chat/inbox.tsx`)

**Figma:** [chat-inbox (336:8808)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=336-8808)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| — | — | — | nenhum `<Text>`/`<Title>` direto na tela | — |

**Notas:**
- Tela 100% composta de componentes DS (`Button`, `SearchInput`, `ChatUserCard`). Toda tipografia visível é emitida internamente pelos componentes do DS. Nenhum override inline de `fontFamily`/`fontWeight`/`fontSize`.
- **Findings indiretos via DS (gaps cross-cutting já contados):**
  - Topbar "Voltar" (ghost button) = Montserrat Bold 14 (gap (e) recorrente)
  - SearchInput placeholder "Pesquisar Contatos" = Inter Regular 14 (`body.m`) ✓
  - ChatUserCard nome (Romulo Cardoso etc) = **Inter Bold 12** (gap (e) recorrente — Inter 700/12)
  - ChatUserCard role "Setor Leste" = Inter Medium 12 (`body.s`/`caption.s`) ✓
  - ChatUserCard badge "+9"/"02" (surface.error) = **Inter Bold 12** (gap (e) recorrente, mesmo da `BadgedButton` do dashboard)
  - "Novo Chat" outline button label = Inter Bold 14 (gap (e) recorrente)
- O ChatUserCard do DS materializa o triplet `Inter 700/12` em DOIS lugares (nome + badge unread) — alta concentração de gap (e) por uso de card.
- Custom scrollbar (`hasScroll` block L142-168) — gráfico puro, sem texto.

### 4.30 Chat Thread (`app/(app)/chat/[userId].tsx`)

**Figma:** [chat (332:8580)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=332-8580)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/chat/[userId].tsx:180-190` ("Hoje - 21/03/2026") | — | Inter Medium 12 cor medium (Figma `family/body Inter:Medium size/sm`) — `body.s`/`caption.s`/`subtitle.s` (manual review) | `Text variant="body.s"` + `color={theme.content.medium}` | ok (manual review) |
| `app/(app)/chat/[userId].tsx:226-235` (chat input placeholder) | (a) + (d) | `body.m` (Inter 400/14) — Figma codifica Input DS com placeholder Inter Regular 14 | `TextInput` de **react-native** com `style={{ fontFamily: theme.fontFamily.body, fontSize: 14 }}` | alta |

**Notas:**
- **L180-190 date separator:** desambiguação `body.s` vs `caption.s` vs `subtitle.s` — todas Inter 500/12. Contexto é label centralizado separando trechos de timeline → `caption.s` semanticamente mais preciso (metadata/legenda); código usa `body.s`. Visual idêntico no DS. **Manual review** mantido em §8.
- **L226-235 TextInput RN nu:** o chat input é renderizado com `TextInput` cru da `react-native` (L226) com style inline `fontFamily: theme.fontFamily.body` + `fontSize: 14`. Tipo (a) — `TextInput` não-DS (não há componente DS pra chat input customizado com attach icon + send button externos) **e** (d) — override inline de family/size. O valor bate com `body.m` (Inter Regular 14), mas via overrides hardcoded.
- **ChatBubble (DS, L192-198):** Figma confirma message body `body.m` (Inter Regular 14) + time `caption.xs` (Inter Bold 8) — ambos emitidos internamente pelo `ChatBubble` do DS, fora do escopo da tela.
- **Topbar "Voltar"** Montserrat Bold 14 (gap (e) cross-cutting).
- **Send button** (L243-256) icon-only, sem texto.
- **JourneyTheme** wrapper só desenha background, fora do escopo de tipografia.

### 4.31 Chat User Info (`app/(app)/chat/user-info.tsx`)

**Figma:** [chat-user-info (336:8891)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=336-8891)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/chat/user-info.tsx:56-62` ("Romulo Cardoso") | — | `title.xs` (Montserrat 700/16) | `Title variant="title.xs"` | ok |
| `app/(app)/chat/user-info.tsx:63-69` (role multiline "Operador..."/"Maquinário pesado") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/chat/user-info.tsx:162-164` ("Tempo até a fadiga total") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/chat/user-info.tsx:179-181` ("1:45:12 h") | — | `title.xs` | `Title variant="title.xs"` | ok |
| `app/(app)/chat/user-info.tsx:198-204` ("Gênero" label) | (c) + (d) + (e) | Inter Bold **16** (Figma `font-['Inter:Bold'] text-[16px]`) — Inter 700/16 fora do DS | `Text variant="subtitle.m"` (Inter 500/16) + override `fontWeight: '700'` | alta |
| `app/(app)/chat/user-info.tsx:205-211` ("♂" symbol) | (c) + (d) + (e) | Inter Bold 16 | `Text variant="subtitle.m"` + `fontWeight: '700'` override | alta |
| `app/(app)/chat/user-info.tsx:214-216` ("Masculino") | — | `body.m` (Inter 400/14) | `Text variant="body.m"` | ok |
| `app/(app)/chat/user-info.tsx:219-225` ("Idade" label) | (c) + (d) + (e) | Inter Bold 16 | `Text variant="subtitle.m"` + `fontWeight: '700'` | alta |
| `app/(app)/chat/user-info.tsx:226-228` ("26 anos") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/chat/user-info.tsx:232-238` ("Tipo sanguíneo" label) | (c) + (d) + (e) | Inter Bold 16 | `Text variant="subtitle.m"` + `fontWeight: '700'` | alta |
| `app/(app)/chat/user-info.tsx:240-242` ("O+") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/chat/user-info.tsx:246-251` ("Alergias" label) | (c) + (d) + (e) | Inter Bold 16 | `Text variant="subtitle.m"` + `fontWeight: '700'` | alta |
| `app/(app)/chat/user-info.tsx:253-255` ("Nenhuma") | — | `body.m` | `Text variant="body.m"` | ok |
| `app/(app)/chat/user-info.tsx:153` ("Ver mapa completo" button) | — | label Inter Bold 14 (gap (e), Button do DS) | `Button variant="surface" size="small"` | ok |

**Notas:**
- **Complementary data labels (L198/219/232/246):** Figma codifica explicitamente `font-['Inter:Bold',sans-serif] text-[16px]` para todos os 4 labels (Gênero/Idade/Tipo sanguíneo/Alergias) + para o glyph "♂". Triplet `Inter 700/16` é **gap real** — completamente fora do DS. Code escolheu `subtitle.m` (Inter 500/16) + override `fontWeight: '700'` — visualmente Inter Bold 16, batendo com Figma, mas via combinação hack: size correto (16 do subtitle.m) + weight override (que muda 500→700). Cinco ocorrências do triplet `Inter 700/16` numa única tela.
- **Comentário do código (L186):** "Bold labels use Inter Bold 16; values use body.m (14)" — autor reconhece explicitamente o triplet faltante.
- **Mesmo gap recorre em `ResponsiblesModal.tsx:149-155`** (§4.28 batch C, blood type). Já são 2 telas mobile pedindo Inter 700/16 — entra forte como gap (e) cross-cutting consolidado em §5.
- **Mini-map (L75-158):** RNImage do basemap + Avatar + Svg polygon + Camera Button (DS) + "Ver mapa completo" Button (DS). Nenhum texto direto da tela; "Ver mapa completo" label vem do DS.

### 4.32 Settings Hub (`app/(app)/settings/index.tsx`)

**Figma:** [settings (348:10615)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=348-10615)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/index.tsx:121-130` ("Política de privacidade e termos de uso") | (d) + (e) | Montserrat Bold 14 cor primary (Figma "GhostButton" `font-['Montserrat:Bold'] text-[14px]`) — gap (e) recorrente | `Text` do DS com style inline `fontFamily: theme.fontFamily.title` + `fontWeight: theme.fontWeight.bold` + `fontSize: theme.fontSize.m` + `color: theme.content.primary` | média |
| `app/(app)/settings/index.tsx:147-156` ("Sair") | (d) + (e) | Montserrat Bold 14 cor error | `Text` do DS com style inline (mesmo padrão acima) + `color: theme.content.error` | média |

**Notas:**
- **L121-130 e L147-156:** o autor compôs manualmente o triplet Montserrat 700/14 via tokens (`theme.fontFamily.title` + `theme.fontWeight.bold` + `theme.fontSize.m`) em vez de usar uma variante DS. O comentário no código (L99-107) **documenta explicitamente** essa decisão: "Figma 348:10615 GhostButton uses title-family + bold + 14px, which has no direct DS Text/Title variant... not promoting to a DS variant: only 2 call sites (both here) and a dedicated DS GhostButton would absorb it cleanly when shipped (Phase 2)". É reconhecimento explícito de gap (e) cross-cutting.
- Severidade média (não alta): a referência aos tokens via `theme` é correta (sem literais hardcoded), só falta uma variante coerente.
- HorizontalCard labels (Editar perfil/Dados de saúde/Alterar senha/Permissões/Suporte/FAQ) emitem `title.xs` (Montserrat 700/16) internamente — Figma confirma. ✓
- Avatar + Edit button (DS) + Home FAB (DS Button com icon-only) — sem texto direto.
- Background `imgSettings` é decorativo.

### 4.33 Settings — Personal Data (`app/(app)/settings/personal-data.tsx`)

**Figma:** [settings-personal-data (353:11560)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=353-11560)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/personal-data.tsx:73-75` ("Dados do cadastro") | — | `title.xs` cor primary (Montserrat 700/16 verde) | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |

**Notas:**
- Tela 100% composta de componentes DS: `TopBar` (Voltar + título), 5x `Input`, 1x `Input` UF/Cidade row, 4x `Combobox`, 1x `Button` "Salvar alterações", 1x Home FAB Button.
- **Findings indiretos via DS (gaps cross-cutting já contados):**
  - TopBar "Voltar" Montserrat Bold 14 (gap (e))
  - TopBar título "Dados pessoais" Montserrat Bold 14 (gap (e) — atenção: é Montserrat 700/14, não title.xs que é 16)
  - Input labels (Nome Completo/Data de Nascimento/CPF/Email/Telefone/UF/Cidade) = **Inter Bold 14** (gap (e) recorrente)
  - Input placeholder/value = `body.m` (Inter 400/14) ✓
  - Combobox labels (Profissão/Setor/Função/Gerente) = **Inter Bold 14** (gap (e) recorrente)
  - Combobox value "Selecione aqui" = `body.m` ✓
  - "Salvar alterações" CTA label = Inter Bold 14 (gap (e))
- Figma confirma TopBar title em Montserrat **Bold 14** (não 16) — confirmando que o TopBar do DS emite um triplet **adicional** ao gap recorrente. Esse triplet (Montserrat 700/14) já existe em ghost buttons / pagination.
- **Anomalia "Dados da cadastro" no Figma** (sic, deveria ser "Dados do cadastro") — código corrigiu pra "Dados do cadastro".

### 4.34 Settings — Health Data (`app/(app)/settings/health-data.tsx`)

**Figma:** [settings-health-data (353:12057)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=353-12057)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/health-data.tsx:77-79` ("Dados da saúde") | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |
| `app/(app)/settings/health-data.tsx:115-117` ("Histórico Médico") | (c) + (e) | Inter Bold 14 cor dark (Figma `font-['Inter:Bold'] text-[14px]`) — gap (e) recorrente | `Text variant="body.m"` + `weight="bold"` + `color={theme.content.dark}` | alta |

**Notas:**
- **L115-117 "Histórico Médico":** Figma codifica explicitamente `font-['Inter:Bold',sans-serif] text-[14px]` (Inter 700/14). Triplet fora da tabela DS — mesmo gap (e) cross-cutting confirmado em batches A/B/C. Código usa `body.m` (Inter 400/14) + `weight="bold"` override = renderiza Inter Bold 14, bate com Figma via override em vez de variante. Tipo (c) variante errada **e** (e) gap.
- **Note Figma anomalia:** o frame Figma escreve "HIstórico Médico" (sic, capitalização errada — "HI" em vez de "Hi"). Código corrigiu pra "Histórico Médico".
- 2x `Combobox` (Tipo sanguíneo/Gênero) + 2x `Input multiline` (alergias/doenças) + 4x `ExamInfoCard` + `ImageUploader` + Salvar Button + Home FAB — tudo DS.
- Figma confirma description "separe suas alergias com..." em `body.s`/`caption.s` (Inter Medium 12) — emitido internamente pelo `Input` do DS quando `description` prop é passada. ✓
- ExamInfoCard interno: year "2027" em Inter Bold 14 (gap (e)), date "05 Mar" em Inter Medium 12 (`body.s`), exam name em Inter Medium 12 cor `content/secondary` — emitido pelo DS.
- Last ExamInfoCard (L41) tem `future: true` — interno do DS, Figma 361:12380 mostra year em Inter Regular 14 (não Bold) — variação de state, fora do escopo da tela.

### 4.35 Settings — Change Password (`app/(app)/settings/change-password.tsx`)

**Figma:** [settings-change-password (353:12228)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=353-12228)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/change-password.tsx:60-62` ("Senha de acesso") | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |

**Notas:**
- TopBar (DS) + section title + 3x PasswordInput (componente local em `components/PasswordInput.tsx`, wrapper sobre `Input` do DS) + Toast (DS) + Button Salvar + Home FAB.
- **PasswordInput** é local mas só compõe Input do DS — labels Senha atual/Nova senha/Repetir nova senha emitidas pelo Input = Inter Bold 14 (gap (e)).
- **Toast (L80-85)** body emitido internamente pelo DS — Figma confirma `body/s`/`caption/s` (Inter Medium 12) cor `content/light`. ✓ Triplet `subtitle/s` aparece no design context — desambiguação cross-cutting.
- **Findings indiretos via DS (gaps cross-cutting):**
  - TopBar "Voltar" Montserrat Bold 14 (gap (e))
  - TopBar título "Alterar senha" Montserrat Bold 14 (gap (e))
  - 3 PasswordInput labels = Inter Bold 14 (gap (e))
  - PasswordInput placeholder "**********" = `body.m` ✓
  - "Salvar nova senha" CTA label = Inter Bold 14 (gap (e))
- Único `<Text>`/`<Title>` direto na tela é o section title — bate.

### 4.36 Settings — Preferences (`app/(app)/settings/preferences.tsx`)

**Figma:** [settings-preferences (357:12302)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=357-12302)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/preferences.tsx:62-64` ("Permissões") | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |
| `app/(app)/settings/preferences.tsx:83-85` (toggle row label "Notificações"/"Localização"/etc) | — | `body.m` (Inter 400/14) | `Text variant="body.m"` + `color={theme.content.dark}` | ok |

**Notas:**
- 4 toggle rows com mesma estrutura (linhas 70-87). Figma codifica `font-[family-name:var(--family/body, 'Inter:Regular',sans-serif)] text-[length:var(--size/m,14px)]` = `body.m` ✓.
- **Comentário do código (L66-69):** documenta intencionalmente o uso de `body.m` cor `content.dark` independente do state do toggle (vs `rightLabel` do Toggle DS que vincula ao estado). Decisão deliberada.
- Toggle (DS) sem `rightLabel` — sem texto interno. Home FAB icon-only.
- Tela mais "simples" de findings da batch — apenas 2 entries, ambas OK. TopBar "Voltar"/"Preferências" emite Montserrat Bold 14 (gap (e) cross-cutting via DS).

### 4.37 Settings — FAQ (`app/(app)/settings/faq.tsx`)

**Figma:** [FAQ (361:12425)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=361-12425)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `app/(app)/settings/faq.tsx:113-115` (hero title "Tire suas dúvidas...") | — | `title.xs` (Montserrat 700/16) cor dark | `Title variant="title.xs"` + `color={theme.content.dark}` | ok |

**Notas:**
- Tela com 1 título direto + SearchInput + 12 Accordions + Pagination + Home FAB. Toda tipografia restante via DS.
- **Findings indiretos via DS (gaps cross-cutting):**
  - TopBar "Voltar"/"FAQ" Montserrat Bold 14 (gap (e))
  - SearchInput placeholder "Pesquisar" = `body.m` ✓
  - Accordion title = `body.m` cor primary ✓ (Figma confirma `family/body Inter:Regular size/m`, cor `content/primary` verde)
  - Accordion body (collapsed por default no Figma; quando expandido seria `body.m`)
  - Pagination buttons "1"/"2"/"3"/"4"/"..." = Montserrat Bold 14 cor primary (gap (e) recorrente)
  - Pagination next arrow = icon-only sem texto
- Accordion no Figma renderiza **título em cor primary verde** (não dark) — confirmando `accentColor` prop default do componente DS. Variação interna do Accordion, fora do escopo.
- **`gap: 38`** literal hardcoded (L109) — não é fonte mas sim spacing token; fora do escopo.

### 4.38 Settings — Privacy (`app/(app)/settings/privacy.tsx` + `components/modals/PrivacyPolicyModal.tsx`)

**Figma:** [privacy-policy-modal variant settings (348:10434)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=348-10434)

Rota wrapper aplica `transparentModal` + backdrop; conteúdo real vive em `components/modals/PrivacyPolicyModal.tsx`. Auditoria abaixo cobre o componente.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/PrivacyPolicyModal.tsx:36-38` ("Política de privacidade" title) | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |
| `components/modals/PrivacyPolicyModal.tsx:50-56` (POLICY body) | (d) | `body.m` (Inter 400/14) cor dark — Figma `family/body Inter:Regular size/m` | `Text variant="body.m"` + `color={theme.content.dark}` + style inline `lineHeight: theme.fontSize.m * 1.4` | baixa |

**Notas:**
- **L53 lineHeight override:** mesmo padrão de `report-details` (§4.26 batch C, L193-199) — leitura de parágrafo longo recebe lineHeight 1.4 (vs Figma `leading-[normal]` que vira 1.0). Tipo (d) leve. Não troca family/weight/size, apenas leading. Severidade baixa.
- **Triplet em uso:** Figma `348:10434` codifica `body/m` no body (Inter 400/14) — bate com `body.m` ✓.
- Close icon (L45) icon-only.
- Rota wrapper `privacy.tsx` (L1-34) zero texto próprio — toda análise transferida pro componente.

### 4.39 Settings — Support (`app/(app)/settings/support.tsx` + `components/modals/SupportFormModal.tsx`)

**Figma:** [support-form-modal variant settings (348:10426)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=348-10426)

Rota wrapper aplica `transparentModal` + backdrop; conteúdo real vive em `components/modals/SupportFormModal.tsx`. Auditoria abaixo cobre o componente.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/SupportFormModal.tsx:46-48` ("Solicitação de suporte" title) | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |

**Notas:**
- Tela com 1 título direto + 1 Combobox + 2 Inputs + 1 Button — tudo DS. Sem `<Text>` direto.
- **Findings indiretos via DS (gaps cross-cutting):**
  - Combobox label "Motivo da solicitação" = Inter Bold 14 (gap (e))
  - Combobox placeholder "Selecione aqui" = `body.m` ✓
  - Input labels "Título da sua solicitação" + "Mensagem" = Inter Bold 14 (gap (e))
  - Input placeholder "Digite aqui"/"Digite aqui a sua mensagem" = `body.m` ✓
  - "Enviar solicitação" CTA = Inter Bold 14 (gap (e))
- Close icon (L55) icon-only.
- Rota wrapper `support.tsx` (L1-35) zero texto próprio.

### 4.40 Modal — Support Form (auth context) (`app/modals/support-form.tsx` + `components/modals/SupportFormModal.tsx`)

**Figma:** [support-form-modal auth row (213:13742)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=213-13742)

Rota wrapper auth aplica `transparentModal` + backdrop; **reutiliza o mesmo componente** `SupportFormModal.tsx` da rota settings (§4.39).

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/SupportFormModal.tsx:46-48` ("Solicitação de suporte" title) | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |

**Notas:**
- Mesma análise estrutural de §4.39 — código materializa **uma única implementação** (`components/modals/SupportFormModal.tsx`) consumida por 2 rotas (pre-auth e authenticated).
- **Comparação Figma 213:13742 (auth) vs 348:10426 (settings):** os dois frames são quase idênticos. Único delta visual: `border-radius` do top edge (auth = `m=8px`, settings = `l=16px`) + `padding-bottom` (auth = `2xl=40px`, settings = `xl=32px`). **Tipografia 100% idêntica** — mesmos triplets em ambos os frames: `title.xs` (Montserrat 700/16) para o título, `Inter:Bold 14` para labels (gap (e)), `body.m` para placeholders, `Inter:Bold 14` para CTA.
- Decisão de reuso 1-componente-2-wrappers é correta porque conteúdo + tipografia + estrutura são idênticos. Diferenças de container (radius/padding) ficam no wrapper.
- Findings indiretos = mesmos de §4.39 (gaps (e) via DS para labels + CTA).
- **Não duplicar contagem** em §5 — é a mesma instância de componente sendo audited duas vezes em rotas diferentes.

### 4.41 Modal — Privacy Policy (auth context) (`app/modals/privacy-policy.tsx` + `components/modals/PrivacyPolicyModal.tsx`)

**Figma:** [privacy-policy-modal auth row (213:13750)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=213-13750)

Rota wrapper auth aplica `transparentModal` + backdrop; **reutiliza o mesmo componente** `PrivacyPolicyModal.tsx` da rota settings (§4.38).

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/PrivacyPolicyModal.tsx:36-38` ("Política de privacidade" title) | — | `title.xs` cor primary | `Title variant="title.xs"` + `color={theme.content.primary}` | ok |
| `components/modals/PrivacyPolicyModal.tsx:50-56` (POLICY body) | (d) | `body.m` cor dark, lineHeight normal no Figma | `Text variant="body.m"` + `lineHeight: theme.fontSize.m * 1.4` inline | baixa |

**Notas:**
- Mesma análise estrutural de §4.38 — código materializa **uma única implementação** consumida por 2 rotas.
- **Comparação Figma 213:13750 (auth) vs 348:10434 (settings):** únicos deltas: `border-radius` (auth `m=8`, settings `l=16`) + `gap` no container (auth `gap.m=16`, settings `gap=16`). **Tipografia 100% idêntica**: title.xs cor primary + body.m cor dark.
- Mesmo finding (d) de lineHeight override aplica nos 2 contextos — mas conta uma vez só em §5 (mesma linha de código).
- O componente é parâmetro-livre exceto `onClose`, garantindo render idêntico independente do contexto.
- **Padrão "1 componente, 2 wrappers"** confirmado para os 2 modais (privacy + support). Settings/privacy ↔ modals/privacy-policy e settings/support ↔ modals/support-form são pares verificadamente equivalentes — nenhuma divergência tipográfica entre as instâncias.

### 4.42 Modal — Weather Alert (`app/modals/weather-alert.tsx` + `components/modals/WeatherAlertModal.tsx`)

**Figma:** [alert-modal (385:29371)](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=385-29371)

Rota wrapper aplica `transparentModal` + backdrop centralizado (não bottom-sheet); conteúdo real vive em `components/modals/WeatherAlertModal.tsx`.

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| `components/modals/WeatherAlertModal.tsx:54-56` ("Local em Alerta!") | — | `title.xs` (Montserrat 700/16) cor dark | `Title variant="title.xs"` + `color={theme.content.dark}` | ok |
| `components/modals/WeatherAlertModal.tsx:101-103` ("17ºC") | — | `title.l` (Montserrat 700/32) cor dark | `Title variant="title.l"` + `color={theme.content.dark}` | ok |
| `components/modals/WeatherAlertModal.tsx:104-110` ("Chuva Intensa") | — | `body.m` (Inter 400/14) cor dark center | `Text variant="body.m"` + `color={theme.content.dark}` + `textAlign: 'center'` | ok |
| `components/modals/WeatherAlertModal.tsx:125-131` (description "Risco de desabamentos...") | — | `body.m` cor dark center | `Text variant="body.m"` + `color={theme.content.dark}` + `textAlign: 'center'` | ok |
| `components/modals/WeatherAlertModal.tsx:169-171` (MetricRow value "65%"/"65km/h"/"32ºC"/"19ºC") | — | `body.m` (Inter 400/14) cor dark | `Text variant="body.m"` + `color={theme.content.dark}` | ok |
| `components/modals/WeatherAlertModal.tsx:133-142` ("Instruções de segurança" CTA) | — | label Inter Bold 14 (gap (e), Button do DS) | `Button variant="contained"` + `backgroundColor={theme.surface.error}` + `labelColor={theme.content.light}` | ok |

**Notas:**
- Modal limpo, alta fidelidade ao Figma. Toda tipografia bate com triplets do DS — nenhum override de fontFamily/fontWeight/fontSize. Único override é `textAlign: 'center'` em 2 lugares (benigno).
- MetricRow é function local (L151-174) que renderiza icon (SvgXml) + Text — usada 4x para %, km/h, max/min temp. Tipografia uniforme.
- Title.l "17ºC" é o **segundo uso** de `title.l` (Montserrat 700/32) no escopo — só aparece em dashboard `StatCol`, my-stats vitals, weather-alert "17ºC". É a variante de "número grande de destaque".
- Rota wrapper `weather-alert.tsx` (L1-49) zero texto próprio — sem findings.
- Tela com **zero findings estruturais** (tipos a–f). Modelo de implementação correto pra ser citado em §5.

## 5. Findings cross-cutting

> Padrões que se repetem em ≥3 telas. Cada padrão é cruzado com §4 para rastreabilidade. Itens marcados **DS** se originam em componentes do DS (`Input`, `Button`, `TopBar`, `Pagination`, `ChatUserCard`, `ReportCard`, `ImageUploader`) — fix vive no DS, não nas telas. Itens marcados **TELA** se originam de override inline no código da tela — fix vive na tela (depois que o DS expuser variante).

### 5.1 Inter Bold 14 — label de Input, CTA contained, outline button, breadcrumbs, names, activity titles

- **Triplet pedido pelo Figma:** Inter / 700 / 14.
- **Variante DS atual:** nenhuma cobre (`body.m` é Inter 400/14, `caption.xs` é Inter 700/8). Solução adotada hoje: `body.m` + `weight="bold"` override, ou label/CTA emitido pelo DS com weight hardcoded internamente.
- **Severidade:** alta — é o gap (e) com mais ocorrências (~20+) e o mais visualmente perceptível em native (`fontWeight: 700` não bridgea family lookup do RN — ver §2.F).
- **Origem mista:**
  - **DS:** `Input` label (§4.10, §4.26, §4.27, §4.33, §4.34, §4.35, §4.39), `Button contained` label (§4.15, §4.21, §4.22, §4.23, §4.24, §4.26, §4.27, §4.31, §4.33, §4.35, §4.39, §4.42), `Button outline` label (§4.18, §4.22, §4.23, §4.24, §4.26, §4.27, §4.28).
  - **TELA (override `weight="bold"` sobre `body.m`):** §4.10 (×2 label "Seu gênero"/"Pessoa com deficiência?"), §4.21 (name "Romulo Cardoso"), §4.22 (idem), §4.23 (idem), §4.24 (×2 breadcrumb items "Jornada"/task title), §4.28 (admin name no `ResponsiblesModal`), §4.34 ("Histórico Médico"); §4.26 activity title **não** aplica override e fica em Inter Regular 14 (divergência visual real).
- **Recomendação:** §6 gap (a). Variante `label.m` ou `subtitle.m.bold` no DS cobre todos os call-sites de uma vez. Após bump, remover os ~8 overrides `weight="bold"` em telas.

### 5.2 Montserrat Bold 14 — ghost button, TopBar, Pagination, ImageUploader outline

- **Triplet pedido pelo Figma:** Montserrat / 700 / 14.
- **Variante DS atual:** nenhuma (`title.xs` é Montserrat 700/16 — 2px maior). Emitido por componentes DS (TopBar/Pagination/Button ghost) com tokens hardcoded internamente.
- **Severidade:** alta — gap (e) com 2ª maior ocorrência (~15+).
- **Origem mista:**
  - **DS:** `TopBar` "Voltar" + título (§4.15, §4.26, §4.27, §4.33, §4.34, §4.35, §4.36, §4.37, §4.38, §4.39), `Button variant="ghost"` (§4.1 Login "Recuperar senha"/"Suporte"/"Primeiro acesso", §4.24 "Cancelar tarefa", §4.26 "Voltar", §4.27 "Voltar"/"Cancelar"), `Pagination` botões 1/2/3/4/.. (§4.25, §4.37), `ImageUploader` "Enviar arquivo"/"Enviar novo exame" (§4.18, §4.27).
  - **TELA (override hardcoded composto via tokens):** §4.32 settings hub "Política de privacidade..."/"Sair" (2 ghost-button-like compostos manualmente como `Text` + style inline `fontFamily: theme.fontFamily.title` + `fontWeight: theme.fontWeight.bold` + `fontSize: theme.fontSize.m`). Comentário do autor reconhece explicitamente o gap.
- **Recomendação:** §6 gap (b). Variante `link.m` ou `button.ghost.m` no DS. Vira também a base do GhostButton dedicado citado no comentário de §4.32.

### 5.3 Inter Bold 12 — badges, dates inline, ChatUserCard nome, ReportCard labels

- **Triplet pedido pelo Figma:** Inter / 700 / 12.
- **Variante DS atual:** nenhuma (`caption.s` é Inter 500/12, `caption.xs` é Inter 700/8). Solução adotada hoje: `body.s` + `weight="bold"` override, ou `caption.s` simples (perde o bold).
- **Severidade:** alta — ~10 ocorrências, visualmente perceptível em badges e dates.
- **Origem mista:**
  - **DS:** `BadgedButton` badge (§4.14 dashboard "4"), `ChatUserCard` nome + badge unread (§4.29 cinco call-sites internos do card), `ReportCard` labels "Data de criação"/"Setor"/"Responsáveis" (§4.25).
  - **TELA (override):** §4.21 date "27/04/2026", §4.22 (idem), §4.23 (idem) — `body.s` + `weight="bold"` em 3 telas de journey.
- **Recomendação:** §6 gap (c). Variante `caption.s.bold` ou rename de `caption.xs` pra `caption.xs.bold` + adição de `caption.s.bold`. Após bump, journey dates ficam declarativas.

### 5.4 Inter Bold 16 — labels de info-grid em chat user-info e ResponsiblesModal blood type

- **Triplet pedido pelo Figma:** Inter / 700 / 16.
- **Variante DS atual:** nenhuma (`subtitle.m` é Inter 500/16, `title.xs` é Montserrat 700/16 — family errada). Solução adotada hoje: `subtitle.m` + `fontWeight: '700'` override inline.
- **Severidade:** alta — concentração extrema em uma tela (5 ocorrências na §4.31) + 1 ocorrência adicional na §4.28 = 6 total. Na §4.28 o code usa `body.m` (size 14) + bold, então renderiza **2px menor** que o Figma — divergência visual de tamanho real.
- **Origem:**
  - **TELA:** §4.31 chat user-info — 5 labels ("Gênero" + "♂" glyph + "Idade" + "Tipo sanguíneo" + "Alergias"), todos com style inline `fontWeight: '700'` sobre `subtitle.m`. Comentário do código (L186) reconhece o gap explicitamente.
  - **TELA:** §4.28 `ResponsiblesModal.tsx:149-155` (blood type "O+") — mas aqui o code usa `body.m`+bold em vez de `subtitle.m`+bold, errando o **size** (14 vs 16). Bug adicional além do gap.
- **Recomendação:** §6 gap (d). Variante `subtitle.m.bold` ou nova `label.l` no DS. Após bump, info-grid em user-info vira 5 `<Text variant="X">`s limpos e `ResponsiblesModal` corrige o size de quebra.

### 5.5 Inter Medium Italic 12 — email destacado em mensagens de confirmação

- **Triplet pedido pelo Figma:** Inter / 500 / 12 + `font-style: italic`.
- **Variante DS atual:** nenhuma — o DS não tem suporte a italic em nenhuma variante.
- **Severidade:** média — apenas 2 ocorrências, ambas em fluxo de confirmação (mensagem "enviamos um email para X"). Visualmente pequeno (12px).
- **Origem:**
  - **TELA:** §4.3 email-sent (signup flow, L61-67), §4.6 password-recovery/email-sent (L59-65) — ambos com `body.s` + style inline `fontStyle: 'italic'`. Padrão idêntico, replicado.
- **Recomendação:** §6 gap (e). Prop opcional `italic` no `<Text>` do DS (booleana, mais simples) **ou** variante explícita `body.s.italic`. Prop ganha porque cobre o caso geral sem inflacionar a tabela DS.

### 5.6 Ambiguidade `body.s` vs `caption.s` vs `subtitle.s` (todos Inter 500/12)

- **Problema:** 3 variantes do DS têm o triplet idêntico `Inter / 500 / 12`. Telas escolhem entre elas semanticamente, mas sem regra documentada acabam divergindo no mesmo padrão visual.
- **Severidade:** média — não causa diferença visual (mesmo render), mas cria inconsistência no código que dificulta refactor/grep/intent.
- **Ocorrências identificadas:**
  - **Stat label sob valor numérico** (mesmo bloco visual de vitals): §4.14 dashboard `StatCol` L677 escolheu `body.s`, §4.18 my-stats L271/302/334 escolheu `caption.s` para "BPM"/"Boa"/"Kcal/hora". Inconsistência interna entre 2 telas (4 call-sites).
  - **Description text under title** em telas de confirmação: §4.3 email-sent escolheu `body.s` (resolvido em manual review).
  - **Date separator em chat thread:** §4.30 L180-190 escolheu `body.s` — mas `caption.s` seria semanticamente preciso (metadata centralizado).
  - **Toast body:** §4.35 — Figma codifica `subtitle/s` mas DS emite como interno do `Toast`; ambiguidade vive dentro do componente.
- **Recomendação:** documentação semântica no DS, **não** mudança de tokens. Definir:
  - `body.s` → texto corrido/descritivo curto.
  - `caption.s` → metadata, legendas, labels secundárias sob valores grandes.
  - `subtitle.s` → sub-rótulo de seção pequena (sob `title.*`).
  - Aplicar à 4 ocorrências de stat label: padronizar como `caption.s` (mais consistente com a semântica). Ver §7 passo 4.

### 5.7 Override inline `fontWeight: theme.fontWeight.bold` sobre `body.m`

- **Padrão:** uma palavra/frase dentro de `body.m` precisa ficar bold (inline emphasis ou label dentro de info-grid).
- **Severidade:** alta — root cause de ~8 dos finds (d) no audit. Sintoma de gap (e) Inter Bold 14 (§5.1) materializado caso-a-caso.
- **Ocorrências:**
  - §4.10 complimentary-data/step-3 (×2 labels "Seu gênero"/"Pessoa com deficiência?").
  - §4.12 smartband/connection (inline span "Smartband").
  - §4.21–§4.23 journey index/ongoing/pause (nome "Romulo Cardoso", ×3 telas).
  - §4.24 journey/task/[id] (×2 breadcrumb items).
  - §4.28 ResponsiblesModal (admin name).
  - §4.34 settings/health-data ("Histórico Médico").
- **Recomendação:** mesma fix do §5.1 (variante `label.m`/`subtitle.m.bold` no DS). Após bump, esses ~10 call-sites viram `<Text variant="X">` direto.

### 5.8 Override inline `lineHeight: theme.fontSize.m * 1.4`

- **Padrão:** parágrafos longos em modais/details recebem leading 1.4 (vs Figma `leading-normal` = 1.0).
- **Severidade:** baixa — divergência de leading, não family/weight/size. Decisão de legibilidade local.
- **Ocorrências:**
  - §4.26 reports/[id] DETAIL_TEXT (L193-199).
  - §4.38 / §4.41 PrivacyPolicyModal POLICY (L50-56) — única implementação, 2 contextos.
- **Recomendação:** ou aceitar como override de tela (leitura > rigor Figma), ou adicionar variante DS `body.m.reading` com lineHeight 1.4 explícito. Custo/benefício: aceitar override é defensável; 2 call-sites não justificam bump.

### 5.9 Greeting multi-span (`title.s` 20px + `title.l` 32px)

- **Padrão:** "Olá %username%!" ou "Vamos configurar a sua Smartband" Figma renderiza em 2 spans num único `<p>` (20px depois 32px). Código decompõe em 2 `Title` separados.
- **Severidade:** ok — não é finding (a)-(f). Decisão deliberada, documentada no `OnboardingHeader` (line break independente do username dinâmico).
- **Ocorrências:**
  - `components/OnboardingHeader.tsx` reusado em §4.8 (step-1), §4.9 (step-2), §4.10 (step-3).
  - §4.12 smartband/connection inline (não usa o componente — duplica o padrão).
- **Recomendação:** consolidar pattern em prop do `OnboardingHeader` ou aceitar como padrão estável (4 ocorrências, sempre o mesmo shape).

### 5.10 Modais reutilizados em 2 contextos (decisão arquitetural correta)

- **Padrão positivo:** privacy-policy + support-form são instanciados pelo auth flow (`/modals/...`) E por settings (`/settings/...`). Código materializa **um único componente** por modal (`PrivacyPolicyModal.tsx`, `SupportFormModal.tsx`) consumido por **2 wrappers de rota**.
- **Severidade:** ok — não é finding. É a decisão correta: Figma tem 2 instâncias por modal (auth row + settings row) com tipografia 100% idêntica e deltas apenas de container (border-radius, padding). Reuso elimina duplicação.
- **Ocorrências:**
  - §4.38 (settings/privacy) ↔ §4.41 (modals/privacy-policy) ↔ `PrivacyPolicyModal.tsx`.
  - §4.39 (settings/support) ↔ §4.40 (modals/support-form) ↔ `SupportFormModal.tsx`.
- **Recomendação:** registrar no design doc como decisão validada. **Não duplicar contagem** em outras seções — os pares são a mesma instância de componente.

### 5.11 `react-native.TextInput` nu em chat thread (único caso tipo (a))

- **Padrão anômalo:** §4.30 chat/[userId].tsx L226-235 usa `TextInput` cru da `react-native` (não do DS) com style inline `fontFamily: theme.fontFamily.body` + `fontSize: 14`.
- **Severidade:** alta — único caso tipo (a) no audit todo. Bypassa o DS por necessidade (chat input precisa de attach icon esquerdo + send button externo direito, layout não coberto pelo `Input` atual).
- **Recomendação:** avaliar bump do `Input` DS pra suportar `iconLeft`+`actionRight` (ou criar variante `Input variant="chat"`). Custo provável: 1 prop + 1 layout slot. Após bump, eliminar TextInput nu.



## 6. Gaps no DS

Tabela deduplicada por triplet. Coluna "Telas que pedem" agrega tanto call-sites diretos (telas que sobrescrevem) quanto indiretos (componentes DS que emitem o triplet internamente — fix vive no DS, mas a cobertura precisa estar listada).

| # | Triplet Figma | Variante DS hoje | Sugestão nome variante | Telas (§4.X) | Prioridade |
|---|---|---|---|---|---|
| (a) | Inter / 700 / 14 | ausente (`body.m` é 400/14, `caption.xs` é 700/8) | `label.m` ou `subtitle.m.bold` (preferir `label.m`) | §4.1 (DS), §4.10 (×2 TELA), §4.12 (TELA), §4.15 (DS), §4.18 (DS), §4.21–§4.23 (×3 TELA), §4.24 (×2 TELA + DS), §4.25 (DS — Button novo relatório), §4.26 (DS ×3 + 1 TELA L260), §4.27 (DS ×6), §4.28 (TELA + DS), §4.31 (DS), §4.33 (DS ×6), §4.34 (TELA), §4.35 (DS ×4), §4.39 (DS ×3), §4.42 (DS) | **alta** |
| (b) | Montserrat / 700 / 14 | ausente (`title.xs` é Montserrat 700/16, 2px maior) | `link.m` ou `button.ghost.m` (preferir `link.m`, alinhado a "ghost link") | §4.1 (DS ×4), §4.24 (DS ghost), §4.25 (DS pagination), §4.26 (DS), §4.27 (DS ×3), §4.32 (×2 TELA — compostos via tokens), §4.33 (DS TopBar ×2), §4.34 (DS TopBar), §4.35 (DS TopBar), §4.36 (DS TopBar), §4.37 (DS TopBar + Pagination), §4.38 (DS via wrapper), §4.39 (DS) | **alta** |
| (c) | Inter / 700 / 12 | ausente (`caption.s` é 500/12, `caption.xs` é 700/8) | `caption.s.bold` ou simplesmente nova variante `badge.s` | §4.14 (DS badge), §4.21–§4.23 (×3 TELA dates), §4.25 (DS ReportCard ×3 labels), §4.29 (DS ChatUserCard ×2 — nome + badge) | **alta** |
| (d) | Inter / 700 / 16 | ausente (`subtitle.m` é 500/16; `title.xs` é Montserrat 700/16) | `subtitle.m.bold` ou nova `label.l` (preferir `label.l`, simétrica com (a) `label.m`) | §4.28 (TELA — bug: size 14 em vez de 16), §4.31 (×5 TELA info-grid) | **média** (2 telas, mas alta concentração) |
| (e) | Inter / 500 / 12 + italic | ausente — DS não suporta italic | prop opcional `italic: boolean` no `<Text>` (preferir) **ou** variante `body.s.italic` | §4.3 (TELA), §4.6 (TELA) | **baixa** (2 ocorrências) |

### 6.1 Estratégia geral

A causa raiz da maioria dos gaps acima é estrutural no DS:

1. **DS emite variantes Inter 500 e Inter 700 com `fontFamily: 'Inter'` + `fontWeight` numérico separado.** Funciona na web (FontFace API faz match por weight), **não funciona em iOS/Android nativo** (RN faz lookup só por family-name — ver §2.D/§2.F).
2. **DS não tem variantes "bold" de `body`/`caption`/`subtitle`** — assume que `weight` é cosmético e o consumidor sobrescreve.
3. **Resultado prático:** todo `weight="bold"` ou `fontWeight: theme.fontWeight.bold` override que aparece nas telas existe porque o DS não tem a variante. Os ~26 finds tipo (d)/(e) viram ~10 call-sites limpos após o bump.

**Bump recomendado v0.1.80+ (coordenado):**

- Adicionar 4 variantes novas: `label.m` (Inter 700/14), `label.l` (Inter 700/16), `caption.s.bold` (Inter 700/12), `link.m` (Montserrat 700/14).
- Adicionar prop `italic` no `<Text>` (cobre o gap (e)).
- Mudar tokens para emitir family weight-aware no native (opção (b) de §2.F): `fontFamily: 'Inter-Medium'` em variantes 500, `'Inter-Bold'` em variantes 700. Web continua usando FontFace API.
- Atualizar `Button` `Input` `TopBar` `Pagination` `ChatUserCard` `ReportCard` `BadgedButton` `ImageUploader` internamente para usar as novas variantes em vez de tokens hardcoded.
- Swi-admin (web) também precisa registrar aliases dos faces Inter-Medium/Inter-Bold (já faz hoje via FontFace) — coordenar bump pra não quebrar o admin.

Após o bump:
- ~80% dos findings em §4 ficam resolvidos sem editar telas (sumiço dos overrides via DS interno).
- ~10 overrides explícitos `weight="bold"` em telas viram `<Text variant="label.m">` (cleanup).
- Native iOS/Android começa a renderizar Inter Medium/Bold em pixel correto (resolve a observação do QA "fontes erradas em todas as telas").



## 7. Ordem de correção sugerida

Sequência baseada em **alavancagem** (alto impacto / baixo custo primeiro). Cada passo lista o resultado esperado e a verificação visual associada.

### Passo 1 — Loading layer Native (opção (b) de §2.F)

- **O que:** mudar `typography.ts` do DS pra emitir `fontFamily: 'Inter-Medium'` em variantes Inter 500 e `'Inter-Bold'` em variantes Inter 700, em vez de `fontFamily: 'Inter'` + `fontWeight` separado. `_layout.tsx` mobile já registra os aliases (`'Inter-Medium'`, `'Inter-Bold'`) — só falta o DS consumir.
- **Por que primeiro:** corrige ~80% do impacto visual em iOS/Android **sem editar uma única tela**. Resolve diretamente a observação do QA ("fontes erradas em todas as telas" se testou em native — ver §2.E).
- **Pré-requisito:** coordenar com swi-admin (web) — admin já registra os mesmos aliases via FontFace, então não quebra; mas precisa de bump na mesma cadência.
- **Verificação:** rodar mobile em iOS Simulator + Android emulador. Abrir 3 telas que pedem Inter 500/700 (`account-confirmation`, `dashboard`, `journey`) e confirmar visualmente que Inter Medium/Bold renderiza em peso correto vs Figma.
- **Custo estimado:** 1 PR no DS, ~20 LOC.

### Passo 2 — DS bump v0.1.80+ com as 5 gaps de §6

- **O que:** adicionar variantes `label.m`, `label.l`, `caption.s.bold`, `link.m` + prop `italic` no `<Text>`. Atualizar componentes internos (`Input`/`Button`/`TopBar`/`Pagination`/`ChatUserCard`/`ReportCard`/`BadgedButton`/`ImageUploader`) pra consumir as novas variantes em vez de tokens hardcoded.
- **Por que segundo:** cobre os 5 triplets gap (e) em uso hoje, eliminando a maior parte dos overrides em telas no Passo 3. Independente do Passo 1 (pode rodar em paralelo), mas mais barato fazer junto pra ter um único bump coordenado.
- **Verificação:** Storybook do DS rendendo cada nova variante com snapshot visual. Telas mobile **não mudam** ainda — confirmar que renders existentes via `Button`/`Input`/`TopBar` ficam idênticos depois do bump (regressão zero).
- **Custo estimado:** 1 PR no DS, ~100 LOC + 5 stories.

### Passo 3 — Cleanup de overrides inline nas telas

- **O que:** remover ~24 overrides espalhados em telas. Mapping concreto:
  - **`weight="bold"` sobre `body.m` → `<Text variant="label.m">`** (cobre §5.7 inteiro): §4.10 ×2, §4.12, §4.21, §4.22, §4.23, §4.24 ×2, §4.28 (corrigir size de quebra), §4.34.
  - **`weight="bold"` sobre `body.s` → `<Text variant="caption.s.bold">`** (cobre §5.3 TELA): §4.21, §4.22, §4.23 dates.
  - **`fontWeight: '700'` sobre `subtitle.m` → `<Text variant="label.l">`** (cobre §5.4 TELA): §4.31 ×5.
  - **Style inline `fontFamily: title + fontWeight: bold + fontSize: m` → `<Text variant="link.m">`** (cobre §5.2 TELA composto via tokens): §4.32 ×2.
  - **`fontStyle: 'italic'` inline + `body.s` → `<Text variant="body.s" italic>`** (cobre §5.5): §4.3, §4.6.
  - **L260-262 §4.26 activity title:** trocar `body.m` por `label.m` (resolve divergência visual real de peso).
- **Por que terceiro:** depende do Passo 2 (variantes têm que existir). Após esse cleanup, o repo mobile fica sem overrides de tipografia inline (zero finds tipo d/e — só tipo a no chat input do Passo 6).
- **Verificação:** grep no repo por `fontWeight:`, `fontStyle:`, `fontFamily:` em `app/` e `components/` → resultado deve ficar restrito a casos justificáveis (chat input do passo 6, lineHeight passo restante).
- **Custo estimado:** 1 PR no mobile, ~50 LOC removidas, ~50 LOC reescritas (delta líquido perto de zero).

### Passo 4 — Padronização semântica body.s vs caption.s

- **O que:** unificar stat label sob valor numérico (vitals row) em `caption.s` em todas as ocorrências (decisão de §5.6). Aplica a 4 call-sites: §4.14 dashboard `StatCol` L677 (trocar `body.s` → `caption.s`); §4.18 my-stats já usa `caption.s` (ok, não muda). Também trocar §4.30 chat date separator `body.s` → `caption.s` (metadata centralizado).
- **Por que quarto:** custo baixíssimo, mas só faz sentido depois que `label.m`/etc estiverem em uso (evita misturar dois refactors no mesmo PR). Pode entrar junto com o Passo 3 se preferir.
- **Verificação:** comparar render do dashboard antes/depois — visualmente idêntico (Inter 500/12 não muda em pixel), só a intenção semântica no código melhora. Documentar regra em `docs/design/typography-semantics.md` (criar) ou no Storybook do DS.
- **Custo estimado:** ~5 LOC mudadas + 1 doc.

### Passo 5 — Findings tipo (c) avulsos (variantes erradas isoladas)

- **O que:** corrigir 10 ocorrências de tipo (c) que **não** são cobertas pelos passos anteriores (porque o gap já está fechado, mas o code escolheu a variante errada apesar disso):
  - §4.2 sign-up: avaliar se label "Nome completo" deve ser Regular (Figma) ou Bold (consistência com outros inputs) — decisão de design, manual review.
  - §4.10 §4.34 já cobertas pelo Passo 3.
  - §4.26 L260-262 activity title já coberto pelo Passo 3.
  - §4.28 blood type "O+" — já coberto pelo Passo 3 (corrige size 14 → 16 ao trocar pra `label.l`).
  - §4.31 ×5 já cobertas pelo Passo 3.
  - Resto são casos pontuais menores (mostly internal de componentes DS que vão ser corrigidos no Passo 2).
- **Verificação:** após Passos 1–4, rodar comparação Figma↔mobile (Playwright + screenshot diff ou visual review) em 5–6 telas representativas (`login`, `dashboard`, `chat/user-info`, `reports/[id]`, `settings/health-data`, `journey/index`).
- **Custo estimado:** ~5 LOC + 1 decisão de design (sign-up labels).

### Passo 6 — Tipo (a) único: chat thread TextInput nu

- **O que:** §4.30 (§5.11). Avaliar se vale bumpar `Input` do DS pra suportar `iconLeft`+`actionRight` ou criar `Input variant="chat"`. Após bump, substituir `TextInput` cru por `<Input variant="chat" />`.
- **Por que último:** caso isolado, requer decisão de API do DS (1 prop a mais? ou variante nova?). Não impacta nenhuma outra tela.
- **Verificação:** chat thread renderizando em iOS+Android+web com mesma layout do Figma (`332:8580`).
- **Custo estimado:** 1 PR no DS, ~30 LOC + 1 PR no mobile, ~15 LOC.

### Passo 7 — Manual review (§8)

- **O que:** itens em §8 que precisam de olho do designer/dev (desambiguações + anomalias Figma + capitalização). Não bloqueia nenhum dos passos anteriores.
- **Verificação:** ata de design review acordando as decisões; aplicar em PR de cleanup separado.
- **Custo estimado:** 1h de review + ~10 LOC.

### Impacto cumulativo

| Após passo | % findings resolvidos | Mudanças em telas |
|---|---|---|
| 1 (loading native) | ~80% (visual em native, sem editar telas) | 0 |
| 1+2 (DS bump) | ~80% + DS internamente consistente | 0 |
| 1+2+3 (cleanup) | ~95% | ~24 overrides removidos |
| 1+2+3+4 (semântica) | ~97% | +5 trocas semânticas |
| 1+2+3+4+5+6 (avulsos + chat) | ~100% findings estruturais | +1 sub.com chat |
| +7 (manual review) | 100% incl. ambiguidades | — |



## 8. Lacunas / checks manuais

Itens que precisam de **olho humano** (designer ou dev de DS) — Phase 3 não conseguiu resolver com leitura do código + Figma. Não bloqueiam os Passos 1–6 de §7.

### 8.1 Manual review da §3 mapping (3 entradas restantes)

Das 7 entradas originais marcadas como "manual review", 4 já foram resolvidas durante o sweep:
- ~~`settings/privacy` ↔ `modals/privacy-policy`~~ — confirmado reuso de 1 componente + 2 wrappers (§4.38/§4.41). **Resolvido.**
- ~~`settings/support` ↔ `modals/support-form`~~ — idem (§4.39/§4.40). **Resolvido.**
- ~~`journey/task/[id]` (2 frames Figma 364:17126 vs 364:17434)~~ — mesma tela, dois states visuais (idle vs in-progress, 3 CTAs); tipografia idêntica (§4.24). **Resolvido.**

Restantes:
- **`password-recovery/email-sent` (Figma 290:688)** — confirmado durante §4.6 que é variante pwd-recovery do `email-confirmation-message` (211:12920), com mesma tipografia + copy "Acesse o link de recuperação". Pode ser marcado como **resolvido** também (apenas variantes de copy). Designer pode confirmar formalmente.

### 8.2 Desambiguações `body.s` / `caption.s` / `subtitle.s` (todos Inter 500/12)

6 ocorrências onde o Figma codifica Inter 500/12 mas o design context lista múltiplas variantes possíveis:

- §4.3 email-sent description "Você será redirecionado..." — resolvido como `body.s` (texto corrido).
- §4.4 account-confirmation description — idem.
- §4.14 dashboard `StatCol` label L677 ("BPM"/"Boa"/"Kcal/hora") — código usa `body.s`, designer precisa confirmar se `caption.s` é mais semântico (proposta em §5.6 / §7 Passo 4).
- §4.18 my-stats L271/302/334 vitals labels — código usa `caption.s` (inconsistente com dashboard).
- §4.30 chat date separator "Hoje - 21/03/2026" L180-190 — código usa `body.s`, proposta é `caption.s` (metadata centralizado).
- §4.35 Toast body — Figma cita `subtitle/s`, mas DS emite via componente; revisar internamente no `Toast`.

**Ação:** ata de design review acordando a regra semântica de §5.6.

### 8.3 Default `labelWeight` do `Input` do DS

§4.9 (complimentary-data/step-2) levantou que o código **não** passa `labelWeight="regular"` aos 5 inputs (CEP, Logradouro, Número, Bairro, UF). Se o default do `Input` for **Bold**, está consistente com o Figma (Inter Bold 14 nos labels). Se for **Regular**, há divergência (c) em 5 inputs.

**Ação:** confirmar o default no DS (`@kavicki/swi-design-system v0.1.79`, `Input.tsx`).

### 8.4 Variante `body.s` vs italic prop (gap (e))

§5.5/§6 gap (e) propõe duas alternativas mutuamente exclusivas: prop `italic` no `<Text>` **ou** variante `body.s.italic`. **Decisão do mantenedor do DS** — proposta é prop boolean (mais simples + escala pra qualquer variante).

### 8.5 Anomalias detectadas no Figma durante a auditoria

Estas são **bugs do design source-of-truth**, não do código. Reportar pro designer corrigir no Figma:

- **§4.27 reports/new form title:** token `text-[length:var(--size/ms,20px)]`. Nome do token `size/ms` corresponde a 16px no DS, mas o fallback do CSS-var é 20px (que é `size/ml`). Inconsistência interna — code usou 20px (visualmente correto). Pedir pro designer renomear o token ou trocar o fallback.
- **§4.33 settings/personal-data:** Figma escreve "Dados **da** cadastro" (sic, deveria ser "Dados **do** cadastro"). Code corrigiu pra "Dados do cadastro". Designer corrige no Figma.
- **§4.34 settings/health-data:** Figma escreve "**HI**stórico Médico" (sic, capitalização "HI" em vez de "Hi"). Code corrigiu pra "Histórico Médico". Designer corrige no Figma.

### 8.6 Rotas sem ground truth Figma

Sem ação requerida — apenas registrar:

- `app/+not-found.tsx` — tela de erro do expo-router; sem design.
- `app/index.tsx` — redirect; não renderiza UI.

### 8.7 Frames Figma sem rota correspondente no código

Sem ação requerida no escopo de fontes — registrar pro time decidir se vira tela:

- `364:17434` "task-details" — variante alongada 970px (in-progress state); coberta como state condicional dentro de §4.24.
- `385:29138` "dashboard-alert-active" + `385:29591` — estados do dashboard com alerta ativo; render condicional dentro de `dashboard.tsx` (§4.14 cobre ambos).
- Section `443:3327` "components-mobile" — biblioteca DS, fora do escopo.
- Frames `1256:10650`, `1256:10658`, `1256:10701`, `1256:10997` — viewport studies iOS (393×852), fora do escopo.

### 8.8 Decisão de design: label de primeiro Input do sign-up

§4.2 levantou que Figma codifica label "Nome completo" em Inter **Regular** 14 mas os demais 3 labels do mesmo formulário em Inter **Bold** 14. Code usa Regular em todos os 4 (padronização). Designer precisa decidir:
- (a) Aceitar padronização do code (todos Regular).
- (b) Voltar pro Figma (1 Regular + 3 Bold — visualmente assimétrico).
- (c) Padronizar todos Bold (mais alinhado com label semantics em outros forms).


