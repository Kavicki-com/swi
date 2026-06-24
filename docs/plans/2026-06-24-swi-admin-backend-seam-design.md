# SWI Backend (AWS) — Fatia 7 / Branch A: seam do swi-admin (design)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Esta é a **branch A** da Fatia 7 (hardening),
> decomposta em `docs/plans/2026-06-24-swi-backend-hardening-admin-design.md`
> (ordem B→A→C; **B `DATA_BACKEND` já mergeada** em `494edcf`).

## Contexto

Branch A = introduzir no `swi-admin` o mesmo **seam `mock`/`amplify` atrás de flag**
que o mobile já tem, **Abordagem A deploy-gated**. Decisão do usuário (2026-06-24):
**seam-only, 1 branch** — estabelecer a arquitetura switchável com o amplify path
como **stub deferido**; as impls amplify reais (`generateClient<Schema>`) viram
pendência de deploy (não há conta AWS).

**Natureza:** em modo `mock` (default) o admin já funciona 100% sobre `mockApi` →
branch A é **puro refactor, zero mudança visível**. Valor = "prontidão de
arquitetura pra ligar no Amplify", não função nova. Por isso seam-only: não
escrever pilha de código amplify não-testável (sem deploy) agora.

## Estado atual (medido)

- `swi-admin` = **Vite + React, vitest** (+ Testing Library/jsdom). `import.meta.env.DEV`
  já usado pra gating de rota dev. **`aws-amplify` NÃO instalado.**
- Contrato do seam: **`MockResponse<T> = { data, error, count? }`** (+ `MockChannel`
  pro realtime do chat) em `src/services/mockApi/types.ts`.
- Páginas importam o api **direto**: `import { reportsApi, type Report } from
  '@/services/mockApi/reports'`. **~18 sites** (hooks/useAuth + páginas de
  auth/admins/chats/dashboard/employees/monitoring/reports/rescue + 1-2 testes de
  página). O símbolo (`<domínio>Api`) e os tipos são idênticos — **só o caminho do
  import muda** no repoint.
- Domínios do `mockApi/`: auth, admins, chats, dashboard, employees, monitoring,
  reports, rescue, roster (+ helpers seed/sleep/types).

## Decisões

### 1. Estrutura = módulo selector por domínio (espelha o mobile)
`src/services/<domínio>.ts` escolhe a impl e re-exporta os tipos:
```ts
// src/services/reports.ts
import { DATA_BACKEND } from './dataBackend';
import { reportsApi as mockReportsApi } from './mockApi/reports';
import { reportsApi as amplifyReportsApi } from './amplifyApi/reports';
export type { Report, ReportActivity } from './mockApi/reports';
export const reportsApi = DATA_BACKEND === 'amplify' ? amplifyReportsApi : mockReportsApi;
```
Páginas: `@/services/mockApi/<domínio>` → `@/services/<domínio>` (só o caminho).
(Rejeitado: barrel único `services/index.ts` = arquivo gordo, menos paralelo ao
mobile; ramificar dentro do `mockApi/<domínio>.ts` = polui o módulo "mock" com
amplify, semanticamente errado.)

### 2. Flag = const editada à mão
`src/services/dataBackend.ts`: `export const DATA_BACKEND: 'mock' | 'amplify' = 'mock';`
Espelha o mobile (não `import.meta.env`; paridade entre apps, deploy-gated, flip por
edição). Apps isolados → admin tem seu próprio `DATA_BACKEND` (sem código
compartilhado com o mobile).

### 3. Amplify stub = deferido, sem dependências novas
`src/services/amplifyApi/<domínio>.ts`: mesma interface do mock (`satisfies`), cada
método lança `Error('amplify backend não deployado — pendência de deploy da Fatia
7')`. **NÃO importa `aws-amplify` nem os tipos gerados do `swi-backend`** → zero dep
nova, zero acoplamento. Impls reais (`generateClient<Schema>`) = pendência de deploy.

### 4. Cobertura por domínio
Seam nos 8 domínios consumidos por páginas (auth, admins, chats, dashboard,
employees, monitoring, reports, rescue). Documentado:
- **Real-backed** (impl amplify real no deploy): `auth`→Cognito, `reports`→`Report`,
  `chats`→`Conversation/Message`, `employees`/`admins`→`Profile`.
- **Vitais/saúde-driven** (**ficam mock mesmo pós-deploy**, pelo pivô): `dashboard`,
  `monitoring`, `rescue`. O stub deles documenta "stays mock até smartband".
- `roster`/`seed`/`sleep`/`types` = sem consumidor de página direto → fora do seam.

## Testing + verificação

- **vitest:** teste de selector por domínio (ou representativo) — `<domínio>Api ===
  mock<Domínio>Api` quando `DATA_BACKEND='mock'`, e o stub quando `'amplify'` (stub
  mockado). Tripé conceitual do mobile. Testes do mock em `mockApi/*.test.ts`
  **continuam apontando pro `mockApi/` direto** (testam a impl mock).
- Verde alvo: `npm run typecheck` (tsc --noEmit), `npm test` (vitest run),
  `npm run build` (`tsc -b && vite build`) exit 0. Capturar baseline antes (o admin
  pode ter erros/warnings pré-existentes — alvo = 0 novos).

## Transversais

- Branch **`feat/admin-backend-seam`** off `feat/mobile-login @ 0c1a704`. **Só toca
  `swi-admin/`** (regra de branch ✅ — nunca mistura com `mobile/`).
- DS intocado (sem UI nova). Commit só com OK do usuário.

## Pendências de deploy (quando existir conta AWS)

- Instalar `aws-amplify` no swi-admin + `amplify_outputs` real.
- Escrever as impls `amplifyApi/<domínio>` reais (`generateClient<Schema>`) pros
  domínios real-backed; investigar `aws-amplify`/`generateClient` no bundle Vite
  (cf. blocker DS↔Vite — provavelmente OK, é ESM-friendly).
- Flip do `DATA_BACKEND` do admin → `amplify`; smoke das telas real-backed.
