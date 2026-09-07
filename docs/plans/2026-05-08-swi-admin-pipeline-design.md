# SWI Admin — Pipeline Front-First (Design)

**Data:** 2026-05-08
**Projeto:** SWI (monitoramento de funcionários em campo — biometria, GPS, alertas críticos, rota de evacuação)
**Escopo deste doc:** pipeline de implementação do **swi-admin** (web), front-first, com mocks
**Status:** aprovado pelo stakeholder

---

## 1. Sumário executivo

Construir o `swi-admin` (29 telas + 3 modais do Figma "SWI - UI" Desktop) como front-end isolado, sem back-end, em ~5–6 semanas. Toda comunicação de dados passa por uma camada `services/mockApi` cuja interface é desenhada para ser idêntica ao cliente `@supabase/supabase-js`. Quando o back-end Supabase entrar (fase 2), o trabalho é substituir o corpo das funções de `mockApi`; os componentes de tela não mudam.

Mobile (`swi-app`, ~35 telas) e back-end real ficam para a fase 2. O risco aceito é o refactor de integração quando o back chegar; mitigação principal é a disciplina de contrato em `mockApi`.

## 2. Decisões registradas

| Decisão | Valor | Justificativa |
|---|---|---|
| Stack back-end (fase 2) | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) | Reduz tempo até primeiro alerta crítico funcionando; RLS atende LGPD nativamente |
| Smartband BLE | Adiado para fase 2 | Hardware ainda não definido; MVP usa mock determinístico de biometria |
| Plataforma | Web admin primeiro, mobile depois | Time enxuto; evita 2 frentes simultâneas |
| Estratégia | Front-first com camada anti-refactor | Stakeholder aceitou o trade-off; mitigação via `mockApi` contract |
| Escopo MVP | 29 telas web + 3 modais | Todas as telas do arquivo Figma "SWI - UI" Desktop |
| Prazo | 4–6 semanas (alvo 6) | Capacidade declarada pelo stakeholder |

## 3. Arquitetura

### 3.1 Stack

- **Build:** Vite 5 + TypeScript strict
- **UI:** React 18 + react-native-web + styled-components 6
- **Design System:** `@kavicki/swi-design-system` pinned via `git+https://github.com/Kavicki-com/swi-design-system.git#v0.1.x`
- **Estado:** zustand (estado local), React Query opcional para cache de mocks
- **Roteamento:** react-router 6
- **Mapas:** Leaflet + leaflet.heat (mapa térmico) + GeoJSON estático
- **Hospedagem:** Vercel desde o S0 (preview por PR)

### 3.2 Estrutura de pastas

```
swi-admin/
  src/
    app/              # router, providers, layout, theme
    pages/            # uma pasta por tela do Figma
      auth/           # login, sign-up, recovery x2
      dashboard/
      admins/         # list, registration, detail
      employees/      # list, registration, detail
      maps/           # general, cameras, heat, meteorologic
      alerts/         # list, heatmap, meteorologic, rescue-route, rescue-route-selection, rescue-ongoing
      monitoring/     # alerts, good-conditions
      reports/        # list, detail, new
      chat/           # inbox
      user/           # settings, profile
      modals/         # support-form, privacy-policy, responsables
    services/
      mockApi/        # auth.ts, employees.ts, admins.ts, alerts.ts, realtime.ts, ...
      types/          # User, Employee, Admin, Alert, Report, ChatMessage, ...
    components/       # composições do admin (NÃO vão pro DS)
    hooks/            # useAuth, useEmployees, useAlerts, useRealtimeAlerts
    config/           # env, constants
  vite.config.ts      # alias react-native -> react-native-web
  tsconfig.json
  package.json
```

### 3.3 Vite alias (necessário para o DS funcionar no web)

```ts
resolve: {
  alias: { 'react-native': 'react-native-web' },
  extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js'],
},
optimizeDeps: { include: ['react-native-web', 'styled-components'] },
```

## 4. A camada `mockApi` — apólice de seguro contra refactor

### 4.1 Contrato

Toda função de leitura retorna o shape de `PostgrestResponse` do Supabase:

```ts
type MockResponse<T> = { data: T | null; error: { message: string } | null; count?: number }
```

Toda assinatura realtime retorna shape compatível com `RealtimeChannel`:

```ts
type MockChannel = {
  subscribe(): void
  unsubscribe(): void
  on(event: 'INSERT' | 'UPDATE' | 'DELETE', cb: (payload: unknown) => void): MockChannel
}
```

### 4.2 Exemplo

```ts
// services/mockApi/employees.ts
export const employeesApi = {
  list: async (orgId: string, opts: { limit: number; offset: number }): Promise<MockResponse<Employee[]>> => {
    await sleep(150)
    const all = MOCK_EMPLOYEES.filter(e => e.org_id === orgId)
    return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null, count: all.length }
  },
  getById: async (id: string): Promise<MockResponse<Employee>> => { ... },
  create: async (payload: Omit<Employee, 'id'>): Promise<MockResponse<Employee>> => { ... },
}
```

### 4.3 Realtime simulado

`mockApi.realtime.subscribeToAlerts(callback)` empurra eventos a cada N segundos com payloads variados. Permite validar layouts em alerta ativo, badge counts, animação de pin no mapa. Quando Supabase Realtime entrar, o contrato é o mesmo.

### 4.4 Migração para Supabase (fase 2)

Substituir o corpo de cada função em `services/mockApi/*.ts` por `supabase.from(...).select(...)`. Os componentes de tela não mudam. As subscriptions trocam de `mockApi.realtime` para `supabase.channel(...)` mantendo a interface.

## 5. Roadmap — 6 sprints de 1 semana

| Sprint | Telas | Foco |
|---|---|---|
| **S0** *(3–4 dias)* | — | Scaffold (Vite + RN Web + DS pinned + alias), Storybook do admin, CI (typecheck/lint/build), `mockApi` skeleton com tipos completos, AuthContext, layout + router, deploy Vercel |
| **S1** | 5 | login, sign-up, password-recovery-email, password-recovery-newpassword, dashboard |
| **S2** | 6 | admins, admin-details, admin-registration, employees, employee-details, employee-registration |
| **S3** | 5 | map-view-general, map-view-cameras, map-view-heat (leaflet.heat), map-metereologic-alerts, alerts (lista) |
| **S4** | 7 | alerts-heatmap, alerts-metereologic-map, alerts-rescue-route, alerts-rescue-route-selection, alerts-rescue-ongoing, monitoring-alerts, monitoring-good-conditions |
| **S5** | 6 + 3 modais | reports, report-details, new-report, chat-inbox, user-settings, user-profile, support-form-modal, privacy-policy-modal, responsables-modal |

**Total:** 29 telas + 3 modais.

**Buffer:** 1 semana implícita absorvendo overrun esperado em S3 (heatmap) e S4 (rescue route com states de transição).

## 6. Definition of Done por tela

1. Implementada usando componentes do DS (sem hardcoded de cor/spacing/tipografia — só tokens semânticos)
2. Conectada exclusivamente a `services/mockApi` (sem fetch inline ou dado hardcoded em componente)
3. Roteada e navegável a partir do dashboard
4. Estados visuais cobertos: loading, empty, error, populated
5. Acessibilidade básica: foco visível, labels em inputs, contraste WCAG AA
6. Story no Storybook do swi-admin com os 4 estados acima
7. Preview deployed na Vercel verde (typecheck + lint + build passando)

## 7. Protocolo de evolução do Design System

Quando uma tela do swi-admin precisar de componente que não existe em `@kavicki/swi-design-system@v0.1.x`:

1. **Para no swi-admin.** Não cria componente local "temporário".
2. Abre PR em `Kavicki-com/swi-design-system` adicionando o componente com a estrutura padrão (`<Name>.tsx`, `.types.ts`, `.styles.ts`, `.stories.tsx`, `.test.tsx`, `index.ts`)
3. Bump patch (v0.1.1, v0.1.2, ...). `git tag vX.Y.Z && git push --tags`.
4. No `swi-admin/package.json`, atualiza `git+...#v0.1.x` e segue.

**Hard rule (do README do DS):** componentes só leem tokens semânticos, nunca primitivos. Verificado em review.

**Componentes provavelmente a adicionar (priorizado pelo Figma):**
- S2: EmployeeCard, AdminCard, Avatar com badge, SearchInput, DataTable
- S3: LocationPin (avatar + badge de mensagem), MapMenuButton, ChipFilter
- S4: RescueRouteCard, AlertSeverityBadge, WeatherCard
- S5: ChatMessageCard, Combox, StepBar

## 8. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Mapa térmico renderiza mal com mock denso | S3 escorrega | Usar leaflet.heat desde dia 1 com 100 pontos seed; aceitar que perf real só é validada com back |
| Mapa meteorológico precisa de tile externo | S3 trava | Stub com GeoJSON estático de áreas fictícias; integração externa fica para fase 2 |
| Rescue route tem máquina de estados não trivial | S4 escorrega | Modelar AlertState como union TS desde S0; states transitam via mockApi.alerts.advanceState() |
| Camera view depende de stream real | S3 | `<video>` com placeholder/poster; comentário explícito no código |
| Bumps frequentes do DS quebram o admin | toda sprint | Pin estrito por tag; smoke test (storybook:build + typecheck) no DS antes de tagar |
| Refactor "fanfic→Supabase" no fim | médio | Apólice é a camada mockApi — shape idêntico ao @supabase/supabase-js |
| LGPD entra tarde demais | médio | privacy-policy-modal e flag `consent_given_at` no User mock entram no S1 |
| 29 telas em 6 semanas é justo | alto | DoD enxuta (sem responsividade mobile, sem E2E). Se atrasar, cortar primeiro chat-inbox e modais menos críticos |

## 9. Handoff para fase 2 (HANDOFF.md ao fim do MVP)

Ao final do MVP, gerar `HANDOFF.md` no repo do swi-admin contendo:

- Mapa do schema Postgres derivado dos types em `services/types/` (orgs, users, admins, employees, employee_locations, alerts, alert_states, journeys, reports, chat_messages)
- RLS policies sugeridas por tabela
- Edge Functions a criar (criar-alerta, encerrar-jornada-stale, ingerir-biometria-json)
- Realtime channels e tópicos
- Lista de chamadas `mockApi` a portar para Supabase
- Pendências LGPD: DPIA, base legal específica para dados sensíveis, retenção, direito de exclusão, exportação

## 10. Definition of Done do MVP

- 29 telas + 3 modais com stories no Storybook do admin
- Walking skeleton: navegação ponta-a-ponta funciona com mocks
- Realtime simulado disparando eventos de alerta a cada N segundos
- HANDOFF.md publicado
- Tag `v0.1.0-front` no repo `swi-admin`
- Preview Vercel estável e compartilhável

## 11. Fora do escopo deste plano (fase 2)

1. Provisionamento Supabase (schema, RLS, Edge Functions, Storage)
2. Substituição de mockApi por client Supabase real
3. swi-app mobile (Expo, BLE mock primeiro, real depois)
4. DPIA + LGPD compliance completo (consentimento, retenção, exclusão)
5. Push notifications (Expo Push)
6. GPS background iOS/Android e validação de aceitação Apple
7. Integração com smartband real quando hardware for definido
8. Deploy de produção (custom domain, observabilidade, backups)
