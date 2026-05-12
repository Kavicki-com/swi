# SWI Mobile — Figma Fidelity Method

> **Para Claude:** Este é o método para alinhar telas do app `mobile/` com o Figma. Espelha o trabalho feito no site (`swi-admin/`) durante o S1.7 — referências canônicas:
> - Plan: `docs/plans/2026-05-08-swi-admin-s1.7-dashboard-fidelity.md`
> - Divergence report: `docs/audits/2026-05-08-s1.7-task0-divergence.md`
> - DS spec: `docs/audits/2026-05-08-ds-v0.1.4-spec.md`
> - Visual artifacts: `docs/audits/dashboard-figma-4-2.png`, `docs/audits/fidelity-method-experiment/`
>
> **Sub-skill obrigatória:** `superpowers:executing-plans` ao implementar tela-a-tela. `superpowers:yba-figma-fidelity-review` é usável como checklist visual no checkpoint final.

---

## Quality bar

- Pixel-perfect onde o DS suportar.
- Onde o DS não suportar: **DS bump > local hack**. Compor localmente é OK quando documentado como gap diferido (ver Gap A/B/C/D no divergence report do S1.7 como modelo).
- Testes verdes em todo task (`npm test`, `npx tsc --noEmit`).
- Walking-skeleton verificado visualmente em **iOS sim + Android sim + web Expo** antes de cada tela ser dada como pronta.
- Regra do CLAUDE.md (DS as-is, nunca recriar componente local) vale identicamente.

---

## Por que este método

A execução do S1.7 Dashboard provou que Figma fidelity exige quatro coisas, nessa ordem:

1. **Audit DS antes de começar** — evita criar componente local achando que falta algo que existe (no S1.7 isso pegou `Header`, `HeaderUserInfo`, `WorkersInfoCard` mal-rotulados).
2. **Divergence report formal** assinando bump-vs-compose por gap antes de codar.
3. **Screenshot Figma de alta resolução como artefato de trabalho** — `get_metadata` em frames densos retorna só o pai, e `get_design_context` no frame inteiro estoura limite do MCP. Trabalhar contra a imagem é o caminho viável.
4. **Implementation loop por região** com checkpoint visual entre regiões — nunca implementar a tela inteira de uma vez sem comparar.

Mobile herda isso. Adaptações:

- **35 telas vs. 1**: o master DS audit é **one-time (Fase 0)**. Per-screen audit (Fase 1) só investiga gaps que não estão cobertos pelo master.
- **Viewport**: Figma mobile usa frames ~390×844 (iOS reference) ou 360×800 (Android). Expo renderiza nos dois.
- **Runtime triplo**: iOS sim, Android sim, web preview. O web preview é canário cross-platform — se uma tela quebra só no web mas funciona nos dois sims, geralmente é uso de API RN que `react-native-web` não cobre.
- **Mobile-specific DS gaps já mapeados** (memória `reference_swi_figma.md`): `status-chart`, `smartband-status`, `heartrate-status`, `step`/`step-bar`, `gender-selection-card`/`gender-selector`, domain icons (heart, calories, steps, work, wind-speed, umidity, time, expand, help, email).

---

## Workflow

### Fase 0 — Master DS audit (one-time, antes da primeira tela)

1. Via Figma MCP, pull metadata da canvas Mobile (`138:5997`) → mapeia todas as 35 telas e seus node IDs.
   ```
   mcp__claude_ai_Figma__get_metadata({ fileKey: "bzDUuPdSiKgl5xucBH0IYE", nodeId: "138:5997" })
   ```
2. Salvar resultado em `docs/audits/mobile/_canvas-tree.xml` (o tool retorna XML, não JSON).
3. Preencher a coluna **Figma node** do **Screen registry** (abaixo).
4. Auditar componentes RN exportados pelo `@kavicki/swi-design-system`:
   ```
   ls mobile/node_modules/@kavicki/swi-design-system/src/  # depois de npm install no mobile/
   ```
   Catalogar nome × tipos exportados × props principais.
5. Cross-reference com a lista pré-identificada de gaps mobile e popular o **DS gap log** (abaixo) com a primeira leva.
6. Output: `docs/audits/mobile/_master-ds-audit.md` — tabela "componente RN × status × pronto pra mobile? × ação" no estilo da tabela do divergence S1.7. Inclui sequência sugerida de DS bumps (qual versão fecha qual conjunto de gaps).

A Fase 0 não codifica nenhuma tela. É só inventário.

### Fase 1 — Per-screen fidelity loop

Pra cada tela, em ordem de prioridade definida pelo plano de sprint mobile:

1. **Setup** — criar pasta `docs/audits/mobile/<screen-slug>/` (ex: `login`, `dashboard`, `journey-ongoing`). Slug bate com o nome do arquivo de rota em `mobile/app/`.
2. **Pull Figma** — preferir `get_design_context` no node ID da tela. Se travar (frame denso), screenshot manual via Figma desktop. Salvar em `<screen-slug>/figma.png`.
3. **Divergence report** — preencher `<screen-slug>/divergence.md` (template inline abaixo). Cita master DS audit pra não re-investigar componentes já catalogados; só lista gaps específicos desta tela.
4. **Plan tasks** — preencher `<screen-slug>/plan.md` (template inline abaixo). Numera tasks; cada task implementa uma região visual.
5. **Implement** — substituir placeholder em `mobile/app/<route>.tsx` pelos componentes DS conforme plan, task por task. Commit por task (regra de commits do projeto: usuário commita ao final, então acumular changes ordenados).
6. **Walking-skeleton checkpoint** — rodar e comparar:
   ```bash
   cd mobile
   npx expo start
   # 'i' iOS, 'a' Android, 'w' web
   ```
   Capturar `<screen-slug>/preview-ios.png` e `<screen-slug>/preview-android.png` lado a lado com `figma.png`.
7. **Notes** — `<screen-slug>/notes.md` pra anotações soltas (não-estruturado, igual o uso real dos `fidelity/*-notes.md` do S1.7).
8. **Done condition** — checklist do plan.md verificada → marcar tela como `done` no Screen registry.

**Quando uma tela revela um gap DS não-coberto pelo master audit:** anotar no DS gap log (não decidir bump/compose ad-hoc — bater com a Fase 0 e ver se entra na próxima versão da DS, ou se o compose local é aceitável até lá).

---

## Folder convention

```
docs/audits/mobile/
  README.md                        ← navega pra cá (este doc)
  _canvas-tree.xml                 ← metadata Figma canvas Mobile (Fase 0)
  _master-ds-audit.md              ← DS audit one-time (Fase 0)
  _ds-gap-log.md                   ← gaps cumulativos, agrupados por DS version target
  <screen-slug>/
    figma.png                      ← screenshot Figma da tela
    divergence.md                  ← Task 0 da tela
    plan.md                        ← tasks numeradas
    notes.md                       ← scratch
    preview-ios.png                ← Expo iOS sim no checkpoint final
    preview-android.png            ← idem Android
    preview-web.png                ← (opcional) Expo web no checkpoint final
```

Slugs prefixados com `_` são meta-artefatos da Fase 0; sem prefixo são per-screen da Fase 1.

---

## Templates

### `<screen-slug>/divergence.md`

```markdown
# <screen-slug> — divergence report

**Date:** YYYY-MM-DD
**Figma node:** `<node-id>` (canvas Mobile `138:5997`)
**Reference image:** `figma.png`
**DS version:** `@kavicki/swi-design-system@<sha-or-tag>` (de `mobile/package.json`)

## Method note

(Como o Figma context foi obtido — `get_design_context` direto, screenshot manual, etc. Se algo travou, anotar.)

## Component coverage (additional to master audit)

(Apenas gaps específicos desta tela. Se a tela só usa componentes já cobertos no master, escrever "Coberto pelo master DS audit." e pular pra Data model.)

| # | Component | DS status | Fits screen need? | Action for this screen |
|---|-----------|-----------|-------------------|------------------------|
| 1 | ...       | ...       | ...               | ...                    |

## Gaps and decisions

### Gap X — <short title>
**Figma:** ...
**DS today:** ...
**Decision:** bump (target DS v0.1.x) | compose local | defer

## Data model gaps

(Tipos/mocks/contratos que esta tela precisa e ainda não existem no `services/` correspondente do mobile.)

## Bottom line

- DS bump required for this screen? sim/não → version target
- Deferred gaps logged in `_ds-gap-log.md`? sim/não
- Ready to proceed with plan.md? sim/não
```

### `<screen-slug>/plan.md`

````markdown
# <screen-slug> — fidelity plan

**Sprint:** <sprint label>
**Branch:** `feat/mobile-<screen-slug>`
**Goal:** ...

## Figma reference

- Node ID: `<id>`
- Dimensions: ...×...
- Visual layout (ASCII):

```
(layout em arte ASCII, igual ao S1.7 plan)
```

## Pre-flight

- [ ] Master DS audit consultado
- [ ] Divergence report assinado (`divergence.md`)
- [ ] DS bump necessário? Se sim, bump executado e versão pinada em `mobile/package.json`

## Task 1 — <region 1>
...

## Task N — Tests + walking-skeleton

- [ ] iOS sim render OK
- [ ] Android sim render OK
- [ ] Web preview render OK (se aplicável)
- [ ] Side-by-side com `figma.png` aprovado
- [ ] `preview-ios.png` e `preview-android.png` salvos

## Acceptance

(Done condition verificável da tela.)

## Risks

...
````

### `<screen-slug>/notes.md`

Vazio inicialmente. Scratch durante o loop — uma linha, um lembrete, uma observação solta. Não tem estrutura.

---

## Screen registry

Status: `todo` / `in-progress` / `done` / `blocked`. **Figma node** é preenchido na Fase 0. **Plan / Divergence** marcam ✅ quando criados.

**Status legend:** `todo` (DS pronta, pode começar) · `blocked-vX.Y.Z` (depende de DS bump) · `in-progress` · `done` · `n/a` (não implementar)

| Slug | Rota (`mobile/app/`) | Figma node | Status | Plan | Divergence |
|------|----------------------|------------|--------|------|------------|
| login | `(auth)/login` | `138:7937` | todo | — | — |
| sign-up | `(auth)/sign-up` | `138:7963` | todo | — | — |
| account-confirmation | `(auth)/account-confirmation` | `211:12994` | todo | — | — |
| email-sent | `(auth)/email-sent` | `211:12920` ¹ | todo | — | — |
| password-recovery-email | `(auth)/password-recovery/email` | `138:7948` | todo | — | — |
| password-recovery-new-password | `(auth)/password-recovery/new-password` | `138:7955` | todo | — | — |
| complimentary-data-step-1 | `(auth)/complimentary-data/step-1` | `211:13009` | blocked-v0.1.8 | — | — |
| complimentary-data-step-2 | `(auth)/complimentary-data/step-2` | `213:13390` | blocked-v0.1.8 | — | — |
| complimentary-data-step-3 | `(auth)/complimentary-data/step-3` | `213:13464` | blocked-v0.1.8 | — | — |
| smartband-pairing | `(onboarding)/smartband/pairing` | `215:17901` | blocked-v0.1.8 | — | — |
| smartband-connection | `(onboarding)/smartband/connection` | `215:13790` | blocked-v0.1.8 | — | — |
| smartband-complete | `(onboarding)/smartband/complete` | `245:18895` | blocked-v0.1.8 | — | — |
| dashboard | `(app)/dashboard` | `245:23280` ² | todo | — | — |
| evacuation | `(app)/evacuation` | `385:30193` | todo | — | — |
| evacuation-ongoing | `(app)/evacuation-ongoing` | `385:30336` | todo | — | — |
| map | `(app)/map` | `385:28757` | todo | — | — |
| map-weather | `(app)/map-weather` | `385:21840` | todo | — | — |
| my-stats | `(app)/my-stats` | `342:9419` | blocked-v0.1.8 | — | — |
| notifications | `(app)/notifications` | `401:30469` | todo | — | — |
| chat-inbox | `(app)/chat/inbox` | `336:8808` | todo | — | — |
| chat-conversation | `(app)/chat/[userId]` | `332:8580` | todo | — | — |
| chat-user-info | `(app)/chat/user-info` | `336:8891` | todo | — | — |
| journey | `(app)/journey/index` | `364:16378` | todo | — | — |
| journey-ongoing | `(app)/journey/ongoing` | `364:17609` | todo | — | — |
| journey-pause | `(app)/journey/pause` | `364:17766` | todo | — | — |
| journey-task | `(app)/journey/task/[id]` | `364:17126` ³ | todo | — | — |
| reports | `(app)/reports/index` | `364:18596` | todo | — | — |
| report-details | `(app)/reports/[id]` | `364:20304` | todo | — | — |
| report-new | `(app)/reports/new` | `372:21297` | todo | — | — |
| settings | `(app)/settings/index` | `348:10615` | todo | — | — |
| settings-change-password | `(app)/settings/change-password` | `353:12228` | todo | — | — |
| settings-faq | `(app)/settings/faq` | `361:12425` | blocked-v0.1.8 | — | — |
| settings-health-data | `(app)/settings/health-data` | `353:12057` | todo | — | — |
| settings-personal-data | `(app)/settings/personal-data` | `353:11560` | todo | — | — |
| settings-preferences | `(app)/settings/preferences` | `357:12302` | todo | — | — |
| modal-privacy-policy | `modals/privacy-policy` | `213:13750` ⁴ | todo | — | — |
| modal-responsables | `modals/responsables` | `364:18017` | todo | — | — |
| modal-support-form | `modals/support-form` | `213:13742` ⁴ | todo | — | — |
| modal-weather-alert | `modals/weather-alert` | `385:29371` (alert-modal) | blocked-v0.1.8 | — | — |

**Notas dos node IDs:**
- ¹ `email-sent` tem variante duplicada em `290:688` (mesma mensagem reaproveitada no fluxo de password-recovery). Implementar uma vez como componente reutilizável.
- ² `dashboard` tem dois estados de "alert-active": `385:29138` e `385:29591`. Implementar como estado interno do `dashboard.tsx` (não rota separada).
- ³ `journey-task` tem variante alta em `364:17434` (970px) provavelmente é a versão "expanded". Confirmar na divergence.
- ⁴ `privacy-policy-modal` e `support-form-modal` aparecem duplicados em `348:10434` e `348:10426` (mesma instância referenciada em outra área da canvas — seguir o primário).

39 entries totais. Status atual após Fase 0: **30 destravadas** (todo) · **9 bloqueadas em DS v0.1.8** (complimentary-data-step-{1,2,3}, smartband-{pairing,connection,complete}, my-stats, settings-faq, modal-weather-alert).

> **Versionamento:** o slot v0.1.7 foi consumido pelo WIP admin (dashboard r2 + map screen, commit DS `fd4c997` em 2026-05-11). Mobile foundations migrou pra v0.1.8.

---

## DS gap log (initial seed from `reference_swi_figma.md`)

Pré-identificados antes mesmo do master audit. Confirmar/refinar na Fase 0.

### Components mobile-specific provavelmente faltando no DS

| Component                  | Used by screens                            | Tipo de gap         |
|----------------------------|--------------------------------------------|---------------------|
| `status-chart`             | my-stats, dashboard (variant)              | Component novo      |
| `smartband-status` (3 estados: start/middle/end) | smartband-pairing, smartband-connection, smartband-complete | Component novo |
| `heartrate-status` (check/alert/low) | my-stats, dashboard                  | Component novo      |
| `step` + `step-bar` (4 estados) | complimentary-data-step-{1,2,3}         | Component novo      |
| `gender-selection-card` + `gender-selector` | complimentary-data-step-? (sign-up flow) | Component novo |

### Domain icons mobile

heart · calories · steps · work · wind-speed · umidity · time · expand · help · email

A maioria provavelmente já existe em `Icon` do DS — confirmar nomes na Fase 0. Os que faltarem viram um único bump consolidado de ícones.

### Outros gaps surgindo durante a Fase 1

(Vai ser preenchido conforme as telas forem auditadas. Agrupar por DS version target — ex: "v0.2.0 mobile-foundations" vs "v0.2.1 chart-primitives".)

---

## Walking-skeleton verification protocol

Pra rodar e comparar visualmente:

```bash
cd mobile
npm install
npx expo start
# 'i' iOS sim · 'a' Android sim · 'w' web
```

Checklist por tela (incluído no `plan.md`):

- [ ] Renderiza no iOS sim sem warnings no console
- [ ] Renderiza no Android sim sem warnings no console
- [ ] Renderiza no web Expo sem warnings (canário cross-platform — falha aqui geralmente sinaliza uso de API RN não-coberta por `react-native-web`)
- [ ] Comparison side-by-side com `figma.png`: alinhamento, espaçamentos, tokens, ícones, tipografia
- [ ] `preview-ios.png` e `preview-android.png` capturados e salvos na pasta da tela

---

## Risks

1. **Frames mobile densos podem estourar MCP igual ao site** — fallback é screenshot manual, igual fizemos no S1.7.
2. **DS gaps mobile-específicos podem multiplicar** — mantenha o gap log agrupado por DS version target pra não fazer 5 bumps em vez de 1. Sequenciar por dependência.
3. **iOS sim ≠ Android sim ≠ web** — o que renderiza num pode quebrar no outro. Por isso o triplo checkpoint é parte do done.
4. **Per-screen branches multiplicam** — usar `feat/mobile-<screen-slug>` e mergear por tela. Não acumular várias telas num branch só.
5. **Re-coordenação de DS com o site** — se um bump do mobile mexer em componente compartilhado (ex: `Avatar`, `Title`), o site também precisa testar antes de mergear. Bump cross-cutting = uma PR no DS, depois duas PRs (uma admin, uma mobile) testando o consumo.

---

## Done condition do método (não de uma tela)

Este método é sucesso quando:

1. Fase 0 está completa: `_canvas-tree.json`, `_master-ds-audit.md`, `_ds-gap-log.md` populados.
2. Pelo menos uma tela (ex: `login`) foi executada inteira pelo loop e está com `preview-ios.png` + `preview-android.png` lado a lado com `figma.png` indistinguíveis dentro da quality bar.
3. Screen registry tem ao menos uma linha em `done`.
4. Pattern documentado em `docs/audits/mobile/README.md` referencia este método.

A partir daí, é repetir Fase 1 pra cada tela na ordem que o sprint mobile definir.

---

## Source materials

- Figma file: `https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI`
- Canvas Mobile (page): `138:5997`
- Site fidelity reference (proof do método):
  - `docs/plans/2026-05-08-swi-admin-s1.7-dashboard-fidelity.md`
  - `docs/audits/2026-05-08-s1.7-task0-divergence.md`
  - `docs/audits/2026-05-08-ds-v0.1.4-spec.md`
- DS pin (mobile): `mobile/package.json` → `github:Kavicki-com/swi-design-system#<sha>`
- Memory canônica: `reference_swi_figma.md` (gaps mobile já identificados), `project_swi_repo_structure.md` (boundary admin/mobile no repo flat)
