# Branch A — seam mock|amplify do swi-admin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Design: `docs/plans/2026-06-24-swi-admin-backend-seam-design.md`. Macro/sub-roadmap:
> `docs/plans/2026-06-24-swi-backend-hardening-admin-design.md` (Fatia 7, branch A).
> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado.

**Goal:** Introduzir no `swi-admin` um seam `mock`/`amplify` atrás da flag
`DATA_BACKEND` (default `mock`), espelhando o mobile, repointando as páginas do
`mockApi/*` direto para módulos selector. **Seam-only**: o amplify path é um stub
deploy-gated que lança; impls reais = pendência de deploy.

**Architecture:** Por domínio, um módulo selector `src/services/<domínio>.ts` faz
`export * from './mockApi/<domínio>'` (re-exporta tipos) e sobrescreve o
`<domínio>Api` const escolhendo mock vs amplify-stub via `DATA_BACKEND`. As páginas
trocam só o caminho do import (`@/services/mockApi/X` → `@/services/X`); símbolos e
tipos idênticos. Stub amplify = Proxy throwing compartilhado, **sem `aws-amplify`
nem acoplamento ao `swi-backend`**. Em modo mock (default) o comportamento é byte-
idêntico ao de hoje — **puro refactor**.

**Tech Stack:** Vite + React + TypeScript, **vitest** (não jest), Git Bash.
swi-admin usa alias `@/` → `src/`.

**⚠️ Execução:** o hook fact-forcing intercepta o 1º Bash do turno + cada Edit/Write
por arquivo — apresente os fatos e re-tente a MESMA op. Edits um de cada vez.

**Branch:** `feat/admin-backend-seam` off `feat/mobile-login @ 0c1a704`. **Só toca
`swi-admin/`** (regra de branch).

---

### Task 1: Branch + baseline

**Step 1:** `git switch -c feat/admin-backend-seam && git log --oneline -1` (espera `0c1a704`).

**Step 2:** capturar baseline (o admin pode ter erros/warnings pré-existentes — alvo = **0 novos**):
```bash
cd swi-admin
npm run typecheck 2>&1 | tail -20    # anotar nº de erros (baseline)
npm test 2>&1 | tail -15             # anotar nº de testes passando (baseline)
npm run build 2>&1 | tail -10        # anotar se passa hoje (tsc -b && vite build)
```
Anotar os 3 baselines. **Step 3:** `cd .. && git status --short` → vazio.

---

### Task 2: Flag + helper do stub

**Files:**
- Create: `swi-admin/src/services/dataBackend.ts`
- Create: `swi-admin/src/services/amplifyApi/notDeployed.ts`

**Step 1: `dataBackend.ts`**
```ts
// Seleciona a fonte de dados do swi-admin: 'mock' (default, demo in-memory, sem AWS)
// ou 'amplify' (Cognito/AppSync, flip pós-deploy). Espelha o DATA_BACKEND do mobile;
// apps isolados, cada um tem o seu. Deploy-gated: o amplify path são stubs até deploy.
export type DataBackendKind = 'mock' | 'amplify';
export const DATA_BACKEND: DataBackendKind = 'mock';
```

**Step 2: `amplifyApi/notDeployed.ts`** (Proxy DRY — qualquer método lança)
```ts
// Stub deploy-gated da Fatia 7: cada método do api amplify lança até as impls reais
// (generateClient<Schema>) existirem. NUNCA é invocado em modo mock (default).
export function notDeployedApi<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new Error(
          `amplify backend não deployado (chamou .${String(prop)}) — pendência de deploy da Fatia 7`,
        );
      };
    },
  });
}
```

**Step 3: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-admin/src/services/dataBackend.ts swi-admin/src/services/amplifyApi/notDeployed.ts
git commit -m "feat(admin): DATA_BACKEND flag + notDeployedApi stub helper (Fatia 7 branch A)"
```

---

### Task 3: TDD do seam de `reports` (template representativo)

**Files:**
- Test: `swi-admin/src/services/reports.test.ts`
- Create: `swi-admin/src/services/amplifyApi/reports.ts`
- Create: `swi-admin/src/services/reports.ts`

**Step 1: teste que falha** (`reports.test.ts`)
```ts
import { describe, it, expect } from 'vitest';

describe('reports selector', () => {
  it('usa a impl mock quando DATA_BACKEND=mock (default)', async () => {
    const { reportsApi } = await import('./reports');
    const { reportsApi: mock } = await import('./mockApi/reports');
    expect(reportsApi).toBe(mock);
  });

  it('o stub amplify lança "não deployado" em qualquer método', async () => {
    const { reportsApi } = await import('./amplifyApi/reports');
    await expect(async () => (reportsApi as { list: () => unknown }).list()).rejects.toThrow(
      /não deployado/,
    );
  });
});
```
> Nota: `notDeployedApi` retorna funções que **lançam síncrono**; `(...).list()` lança
> na hora. Se preferir `.toThrow` síncrono em vez de `.rejects`, ajuste — confirme o
> shape ao rodar. O ponto é: chamar qualquer método estoura.

**Step 2: rodar e ver falhar**
Run: `cd swi-admin && npx vitest run src/services/reports.test.ts`
Expected: FAIL (módulos `./reports` e `./amplifyApi/reports` não existem).

**Step 3: stub `amplifyApi/reports.ts`**
```ts
import { notDeployedApi } from './notDeployed';
// typeof import(...) = type query, NÃO emite import runtime → zero acoplamento ao mock.
export const reportsApi = notDeployedApi<typeof import('../mockApi/reports').reportsApi>();
```

**Step 4: selector `services/reports.ts`**
```ts
import { DATA_BACKEND } from './dataBackend';
import { reportsApi as mockReportsApi } from './mockApi/reports';
import { reportsApi as amplifyReportsApi } from './amplifyApi/reports';
export * from './mockApi/reports'; // re-exporta tipos (Report, ReportActivity, …)
export const reportsApi = DATA_BACKEND === 'amplify' ? amplifyReportsApi : mockReportsApi;
```
> Se o tsc reclamar de duplicidade do `reportsApi` (TS2308) por causa do `export *`,
> troque a linha do `export *` por enumeração explícita de tipos
> (`export type { Report, ReportActivity } from './mockApi/reports';`). O export
> explícito local de `reportsApi` deve sobrescrever o do `export *` sem erro.

**Step 5: rodar e ver passar**
Run: `npx vitest run src/services/reports.test.ts` → PASS (2/2).
Run: `npm run typecheck 2>&1 | tail -20` → 0 erros novos vs baseline.

**Step 6: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-admin/src/services/reports.ts swi-admin/src/services/reports.test.ts swi-admin/src/services/amplifyApi/reports.ts
git commit -m "feat(admin): seam de reports (mock|amplify-stub) + teste (Fatia 7 branch A)"
```

---

### Task 4: Aplicar o template aos outros 7 domínios

Para CADA domínio em **auth, admins, chats, dashboard, employees, monitoring, rescue**,
criar 2 arquivos copiando o template do reports (trocando `reports`→`<domínio>` e
`reportsApi`→`<domínio>Api`):

- `swi-admin/src/services/amplifyApi/<domínio>.ts`:
  ```ts
  import { notDeployedApi } from './notDeployed';
  export const <domínio>Api = notDeployedApi<typeof import('../mockApi/<domínio>').<domínio>Api>();
  ```
- `swi-admin/src/services/<domínio>.ts`:
  ```ts
  import { DATA_BACKEND } from './dataBackend';
  import { <domínio>Api as mock<Domínio>Api } from './mockApi/<domínio>';
  import { <domínio>Api as amplify<Domínio>Api } from './amplifyApi/<domínio>';
  export * from './mockApi/<domínio>';
  export const <domínio>Api = DATA_BACKEND === 'amplify' ? amplify<Domínio>Api : mock<Domínio>Api;
  ```

Símbolos confirmados do `mockApi/*`: `authApi, adminsApi, chatsApi, dashboardApi,
employeesApi, monitoringApi, rescueApi` (+ `reportsApi` já feito). Domínios fora do
seam: `roster/seed/sleep/types` (sem consumidor de página).

**Step final:** `cd swi-admin && npm run typecheck 2>&1 | tail -20` → 0 novos. Commit:
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-admin/src/services/
git commit -m "feat(admin): seam dos 7 domínios restantes (auth/admins/chats/dashboard/employees/monitoring/rescue)"
```

---

### Task 5: Repointar os consumidores (scripted) + completeness

Todos os consumidores importam `@/services/mockApi/<domínio>`. Os selectors/stubs/
mockApi internos usam imports **relativos** (`./mockApi/X`, `../mockApi/X`), então a
string absoluta `@/services/mockApi/` só aparece em consumidores → sed seguro.

**Step 1: replace**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
files=$(git grep -l '@/services/mockApi/' -- swi-admin/src)
sed -i 's#@/services/mockApi/#@/services/#g' $files
git grep -n '@/services/mockApi/' -- swi-admin/src   # esperado: VAZIO (completeness)
```
> Atenção: NÃO deve sobrar nenhum `@/services/mockApi/` — os testes do mock em
> `src/services/mockApi/*.test.ts` usam imports relativos (`./reports`, etc.), então
> não são tocados e continuam testando a impl mock direto. Se o grep não der vazio,
> investigar antes de seguir.

**Step 2: commit**
```bash
git add swi-admin/src
git commit -m "refactor(admin): repointar páginas/hooks mockApi/* -> services/* (seam)"
```

---

### Task 6: Verificação final (tripé + build)

```bash
cd swi-admin
npm run typecheck 2>&1 | tail -20   # 0 erros novos vs baseline da Task 1
npm test 2>&1 | tail -15            # baseline + os novos testes de reports, 0 quebras
npm run build 2>&1 | tail -10       # exit 0 (tsc -b && vite build)
cd .. && git grep -n '@/services/mockApi/' -- swi-admin/src  # VAZIO
```
Expected: typecheck 0 novos, vitest verde (baseline +2), build exit 0, grep vazio.
Se algo falhar, NÃO seguir — diagnosticar e corrigir.

---

### Task 7: (pós-review) merge — separado, com OK explícito

FF-merge pra `feat/mobile-login` é passo separado que exige aprovação do usuário.
NÃO mergear dentro do plano.

## Definition of Done (branch A)

- [ ] `src/services/dataBackend.ts` + `amplifyApi/notDeployed.ts` + 8 selectors + 8 stubs
- [ ] `git grep '@/services/mockApi/' -- swi-admin/src` → vazio (consumidores repointados)
- [ ] typecheck: 0 novos vs baseline · vitest: baseline +2 · build: exit 0
- [ ] DS intocado, nenhuma mudança visível (mock continua default)
- [ ] commits na `feat/admin-backend-seam`
