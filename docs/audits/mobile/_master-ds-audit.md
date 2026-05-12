# Master DS Audit — Mobile

**Date:** 2026-05-10
**DS pin (mobile):** `mobile/package.json:13` → `github:Kavicki-com/swi-design-system#6a6c7b9c65dfccd4bce968c6fa1eaea7294e093f`
**DS pin (admin, proxy):** `swi-admin/package.json:18` → `github:Kavicki-com/swi-design-system#v0.1.6`
**DS source inspected:** `swi-admin/node_modules/@kavicki/swi-design-system/src/` + `mobile/node_modules/@kavicki/swi-design-system/src/`

**Cross-check:** componentes exportados no mobile e no admin são **idênticos** (50 nomes, listados abaixo). Proxy via admin é confiável; auditar mobile DS depois de cada bump pra garantir paridade contínua.

---

## Method

1. `mcp__claude_ai_Figma__get_metadata` no canvas Mobile (`138:5997`) → `_canvas-tree.xml` (45 frames + section `components-mobile`).
2. `ls mobile/node_modules/@kavicki/swi-design-system/src/components/` e `cat src/index.ts` → 50 componentes exportados.
3. `cat src/icons/paths.ts` → 41 ícones registrados.
4. Cross-reference com:
   - Section `components-mobile` do Figma (designer-drawn, autoritativo do que mobile precisa)
   - Listas pré-identificadas em memória `reference_swi_figma.md` (confirmar/refutar)

---

## DS components (50)

Todos exportados em `@kavicki/swi-design-system` raiz. Nomes em PascalCase como aparecem no `index.ts`:

```
Accordion, ActivitiesOverviewCard, Avatar, AvatarGroup, BigNumbersCard, Button,
CaloriesTag, ChatBubble, ChatSection, ChatUserCard, Checkbox, Chip, ChipGroup,
Combobox, DonutChart, EmployeeOverviewCard, ExamInfoCard, Header, HeaderUserInfo,
HeartrateStatus, HeartStatus, Icon, Image, ImageUploader, Input,
LineCaloriesChart, Logo, MapControl, MenuItem, NowMarker, ProgressBar, Radio,
ReportCard, SearchInput, SideMenu, Silhouette, StatusChart, StatusTag, Surface,
Tabs, Text, TimeStamp, Title, Toast, Toggle, WeatherEventChip, WeatherIcon,
WeatherTimeline, WeatherTimelineEntry, WorkersInfoCard
```

---

## Cross-reference: Figma `components-mobile` × DS

A section `components-mobile` no Figma (`443:3327`) lista exatamente o que o designer desenhou como blocos reutilizáveis pra mobile. Comparação:

| Figma component (designer)            | DS today                          | Status                    |
|---------------------------------------|-----------------------------------|---------------------------|
| `step` (default/current/complete)     | —                                 | **GAP — adicionar à DS**  |
| `step-bar` (4 estados)                | —                                 | **GAP — adicionar à DS**  |
| `gendere-selection-card` (active/enable) | —                              | **GAP — adicionar à DS**  |
| `gender-selector` (option1/option2)   | —                                 | **GAP — adicionar à DS**  |
| `smartband-status` (start/middle/end) | —                                 | **GAP — adicionar à DS**  |
| `heartrate-status` (check/alert/low)  | `HeartrateStatus`                 | ✅ existe                 |
| `heart-status`                        | `HeartStatus`                     | ✅ existe                 |
| `status-chart` (good/alert/low)       | `StatusChart` + `Silhouette`      | ✅ existe                 |

> A memória `reference_swi_figma.md` (2 dias atrás) listava `status-chart`, `heartrate-status` e `smartband-status` todos como gaps mobile. Hoje a DS já cobre os dois primeiros — só `smartband-status` e os 4 outros (step/step-bar/gender) permanecem como gaps reais. Memória será corrigida.

---

## Cross-reference: Figma icons × DS Icon registry

DS `Icon` aceita `name: IconName` mapeado em `src/icons/paths.ts` — 41 ícones registrados (Material Symbols + raw SVGs).

Ícones registrados na DS:
```
add_a_photo, build, vital_signs, cloud_upload, close, keyboard_arrow_down,
more_vert, search, favorite, monitor_heart, sunny, rainy, partly_cloudy_day,
account_circle, location_on, av_timer, cognition, chat_bubble, delete_icon,
humidity_mid, keyboard_arrow_up, person_apron, mode_heat, video_camera_back,
home, manage_accounts, badge, desktop_windows, monitoring, notifications,
settings, health_activity, swi_logo_complete, swi_logo_symbol, heart_filled,
vitals_pulse, home_filled, admin_filled, worker_filled, monitor_filled,
reports_filled, bell_filled, settings_filled
```

Ícones que mobile precisa (designer-drawn em `components-mobile`):

| Figma icon (designer) | DS today                      | Status                   |
|-----------------------|-------------------------------|--------------------------|
| `calories-icon`       | —                             | **GAP — adicionar**       |
| `email-icon`          | —                             | **GAP — adicionar**       |
| `expand-icon`         | `keyboard_arrow_down/up`?     | ⚠ semantic — confirmar com designer ou adicionar `expand` |
| `steps-icon`          | —                             | **GAP — adicionar**       |
| `help-icon`           | —                             | **GAP — adicionar**       |
| `work-icon`           | `build`?                      | ⚠ semantic — `build` é wrench/tools (Material), `work` no mobile pode ser outra coisa — confirmar com designer |
| `time-icon`           | `av_timer`?                   | ⚠ semantic — confirmar visual |
| `wind-speed-icon`     | —                             | **GAP — adicionar**       |
| `umidity-icon`        | `humidity_mid`                | ✅ existe (sob outro nome) |
| `heart` (já visto em frames) | `heart_filled`, `vitals_pulse`, `monitor_heart` | ✅ múltiplas opções — designer escolhe qual |

5 ícones-gap confirmados (`calories`, `email`, `steps`, `help`, `wind-speed`) + 4 a esclarecer (`expand`, `work`, `time` — semantic mapping com ícones existentes; `umidity` resolvido pra `humidity_mid`).

---

## Outros componentes que mobile vai usar (sem gap aparente)

Verificados no `index.ts` e considerados prontos pro consumo mobile sem mudança:

- `Header`, `HeaderUserInfo`, `Logo` — telas autenticadas (dashboard, journey, etc.)
- `Surface` — wrapper de tela com `variant` e `padding`
- `Title`, `Text` — tipografia
- `Input`, `SearchInput`, `Combobox`, `Checkbox`, `Radio`, `Toggle` — forms (login, sign-up, settings, recovery)
- `Button` — CTAs
- `Avatar`, `AvatarGroup` — chat, journey participants
- `BigNumbersCard`, `DonutChart`, `ProgressBar` — KPIs e gráficos
- `Chip`, `ChipGroup`, `Tabs` — filtros e navegação
- `Toast`, `StatusTag` — feedback
- `WeatherIcon`, `WeatherEventChip`, `WeatherTimeline`, `WeatherTimelineEntry`, `NowMarker` — widget meteo (alert-modal)
- `MapControl`, `Image` — mapas
- `MenuItem`, `SideMenu` — navegação
- `EmployeeOverviewCard`, `ChatUserCard`, `ChatBubble`, `ChatSection`, `ReportCard`, `ActivitiesOverviewCard`, `WorkersInfoCard`, `ExamInfoCard` — cartões de domínio
- `CaloriesTag`, `LineCaloriesChart` — saúde
- `ImageUploader` — settings (foto de perfil), report-new
- `Accordion` — settings, FAQ
- `TimeStamp` — chat, reports
- `HeartrateStatus`, `HeartStatus`, `StatusChart`, `Silhouette` — telas de saúde (my-stats, dashboard)

**Não-uso esperado em mobile:** `WorkersInfoCard` (per-employee detail card é admin/site, não mobile).

---

## DS bump sequence sugerida

Agrupar gaps por dependência e plataforma. Sugestão de versões:

### v0.1.8 (mobile foundations) — **prioridade alta, bloqueia muitas telas**

> **Note (2026-05-11):** originalmente planejado como `v0.1.7`. Renomeado pra v0.1.8 quando o slot v0.1.7 foi consumido pelo cut admin (dashboard r2 + map screen, commit DS `fd4c997`).

Componentes:
- `Step` + `StepBar` (composição: bar usa Step internamente)
- `GenderSelectionCard` + `GenderSelector` (selector usa cards)
- `SmartbandStatus` (3 estados, com asset visual ilustrativo)

Ícones:
- `calories`, `email`, `steps`, `help`, `wind-speed` (5 paths a adicionar em `icons/paths.ts`)

Resolve: complimentary-data-step-{1,2,3}, smartband-connection-{start, middle, complete}, my-stats (heart-rate-button), alert-modal (wind-speed icon), settings-faq.

### v0.1.9 (semantic icon clarifications)

Decidir com designer:
- `expand` vs reusar `keyboard_arrow_down/up`
- `work` vs reusar `build`
- `time` vs reusar `av_timer`

Se designer quiser ícones distintos: adicionar `expand`, `work`, `time` ao registry. Se concordar com reuso: documentar mapeamento e parar.

---

## Bottom line

- **5 componentes-gap confirmados** (`Step`, `StepBar`, `GenderSelectionCard`, `GenderSelector`, `SmartbandStatus`) + **5 ícones-gap confirmados** (`calories`, `email`, `steps`, `help`, `wind-speed`).
- DS bump v0.1.8 fecha todos eles num único release; v0.1.9 fica reservado pra resolver semantic icon naming.
- **Memória `reference_swi_figma.md` precisa correção**: status-chart, heartrate-status, heart-status já existem na DS.
- Pronto pra Fase 1: qualquer tela cujos gaps caem em "DS pronta" pode começar imediatamente. Telas que dependem de v0.1.8 (smartband, complimentary-data, my-stats, alert-modal, settings-faq) bloqueiam até o bump.

Telas **destravadas** (não dependem de gap mobile-específico):
- login, sign-up, account-creation-confirmation, email-confirmation-message
- password-recovery-step-{email,newpassword}
- dashboard (estado base; alert-active depende de uso de StatusTag — verificar)
- journey, journey-ongoing, journey-pause, task-details
- evacuation-route, evacuation-route-ongoing
- map-view-general, map-metereologic-alerts
- chat, chat-inbox, chat-user-info
- notifications, reports, report-details, new-report
- settings (index), settings-personal-data, settings-health-data, settings-change-password, settings-preferences
- modais: support-form, privacy-policy, responsables, alert-modal (sem o wind-speed icon — pode ser placeholder até bump)

Telas **bloqueadas** até v0.1.8:
- complimentary-data-step-{1,2,3} (precisa Step + StepBar + GenderSelector)
- smartband-connection-{start, ..., complete} (precisa SmartbandStatus)
- my-stats (heart-rate-button compõe com ícones que faltam — verificar na divergence da tela)
- FAQ / settings-faq (precisa help icon)
