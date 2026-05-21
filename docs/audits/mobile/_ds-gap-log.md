# DS Gap Log — Mobile

**Date:** 2026-05-10 (initial seed) · **Last updated:** 2026-05-10
**Source:** `_master-ds-audit.md` (Fase 0)

Gaps cumulativos surgidos durante mobile fidelity. Agrupados por **DS version target**.

---

## v0.1.8 — Mobile foundations (prioritário, bloqueia 7+ telas)

> **Note (2026-05-11):** originalmente planejado como `v0.1.7`. Renomeado pra v0.1.8 quando o WIP admin (dashboard r2 + map screen) consumiu o slot v0.1.7. Ver `docs/plans/2026-05-11-ds-v0.1.7-admin-cut.md` (a ser criado) ou commit DS `fd4c997`.

Status: **planejado, não iniciado.**

### Componentes novos

| Component                | Figma reference (canvas Mobile)         | Telas que destravam                                       | Notas                                  |
|--------------------------|-----------------------------------------|-----------------------------------------------------------|----------------------------------------|
| `Step`                   | `213:13087` (default/current/complete)  | (consumido por `StepBar`)                                 | Estado de um passo individual          |
| `StepBar`                | `213:13215` (4 estados: step-1/2/3/complete) | complimentary-data-step-{1,2,3}                       | Composição horizontal de Steps         |
| `GenderSelectionCard`    | `213:13640` (active/enable)             | (consumido por `GenderSelector`)                          | Card individual de gênero              |
| `GenderSelector`         | `213:13709` (option1/option2)           | complimentary-data-step-? (sign-up flow)                  | Pair de cards lado-a-lado              |
| `SmartbandStatus`        | `245:18876` (start/middle/end)          | smartband-connection-start, -middle, -complete            | Ilustração de pareamento BLE           |

### Ícones novos

A adicionar em `swi-design-system/src/icons/paths.ts`:

| Icon name (proposto)  | Figma reference         | Onde aparece                                       |
|-----------------------|-------------------------|----------------------------------------------------|
| `calories`            | `304:2569` calories-icon | my-stats (heart-rate-button), dashboard           |
| `email`               | `211:12984` email-icon  | login, sign-up, password-recovery, account confirmation |
| `steps`               | `262:28201` steps-icon  | my-stats, dashboard                                |
| `help`                | `304:2762` help-icon    | settings-faq, FAQ                                  |
| `wind-speed`          | `385:29336` wind-speed-icon | alert-modal, map-metereologic-alerts           |

### DoD do bump v0.1.8

- [ ] 5 componentes adicionados em `swi-design-system/src/components/<Name>/` com `.tsx`, `.types.ts`, `.theme.ts`, `.stories.tsx`
- [ ] 5 ícones adicionados em `src/icons/paths.ts` (com viewBox + d)
- [ ] `index.ts` exporta os 5 componentes + types
- [ ] Stories no Storybook cobrem os estados desenhados pelo designer
- [ ] Tag `v0.1.8` cortada e pinada em `mobile/package.json` (e admin se algum componente for útil cross-platform)

---

## v0.1.9 — Semantic icon clarifications (decisão de design)

Status: **bloqueado em decisão do designer.**

Pra resolver: três ícones do Figma `components-mobile` têm um candidato razoável já existente na DS, mas não foi confirmado se é equivalência semântica ou se o designer quer um ícone distinto.

| Figma icon     | DS candidato hoje              | Decisão necessária                          |
|----------------|--------------------------------|---------------------------------------------|
| `expand-icon`  | `keyboard_arrow_down`/`keyboard_arrow_up` | Designer aceita reuso? Se não, adicionar `expand` |
| `work-icon`    | `build` (Material wrench)      | É a mesma intenção visual? Se não, adicionar `work` |
| `time-icon`    | `av_timer`                     | É a mesma intenção visual? Se não, adicionar `time` |

**Action:** abrir Q ao designer com screenshots lado-a-lado. Se reuso aprovado, fechar v0.1.9 sem mudanças no código (só doc). Se não, bump com novos ícones.

---

## Resolved (sem ação necessária)

| Tópico                      | Resolução                                             |
|-----------------------------|-------------------------------------------------------|
| `umidity-icon`              | DS já tem `humidity_mid` — usar como está             |
| `heart` icon                | DS tem `heart_filled`, `vitals_pulse`, `monitor_heart` — designer escolhe qual fits cada uso |
| `status-chart` component    | DS já tem `StatusChart` + `Silhouette`                |
| `heartrate-status` component| DS já tem `HeartrateStatus`                            |
| `heart-status` component    | DS já tem `HeartStatus`                                |

---

## Workflow pra adicionar novos gaps

Quando uma tela na Fase 1 surfar gap não-coberto pelo master audit:

1. Adicionar linha à seção da DS version target apropriada (ou criar nova versão se não couber).
2. Anotar:
   - Nome proposto do componente/ícone
   - Figma node reference
   - Tela(s) que destravam
   - Notas semânticas
3. Atualizar `Last updated` no topo deste arquivo.
4. Se a tela puder rodar com compose local até o bump, anotar isso na divergence.md da tela como "deferido pra v0.1.x".

Não decidir bump-vs-compose ad-hoc na Fase 1 sem checar este log primeiro.
