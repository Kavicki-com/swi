# Branch B — `AUTH_BACKEND` → `DATA_BACKEND` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Design: `docs/plans/2026-06-24-swi-backend-hardening-admin-design.md` (§ "Branch B").
> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado.

**Goal:** Renomear o flag global `AUTH_BACKEND` → `DATA_BACKEND` (e o tipo
`AuthBackendKind` → `DataBackendKind`) em todo o `mobile/`, sem mudar comportamento.

**Architecture:** É um **rename puro de token**, não feature. O flag já é o switch
único `'mock' | 'amplify'` que 10 selectors + `configure.ts` + 4 telas leem. A
verificação NÃO é TDD red-green (não há comportamento novo a dirigir — escrever
testes sintéticos aqui violaria YAGNI); a corretude é garantida por um **tripé**:
(1) `tsc --noEmit` pega todo arquivo-fonte que ainda importa o nome antigo;
(2) `jest` continua verde (107/107); (3) `git grep AUTH_BACKEND -- mobile/` fica
**vazio** — esse é o check definitivo, porque tsc/jest **não** pegam uma chave
`AUTH_BACKEND` velha dentro de uma factory `jest.mock` (retorno não-tipado →
lê `undefined` → cai no mock → teste passa pelo motivo errado).

**Tech Stack:** Expo / React Native / TypeScript, Jest (jest-expo), Git Bash.

**⚠️ Não confundir tokens:**
- Renomear: `AUTH_BACKEND` (SCREAMING_SNAKE, o flag) e `AuthBackendKind` (o tipo do valor do flag).
- **NÃO tocar:** `AuthBackend` (PascalCase) — é a interface do serviço de auth em
  `services/auth/types.ts`, sem relação. `sed` é case-sensitive, então o replace do
  token `AUTH_BACKEND` não atinge `AuthBackend`; ainda assim, confira no diff.

**⚠️ Execução (lição da fatia anterior):** o hook fact-forcing intercepta o 1º Bash
do turno e cada Edit/Write por arquivo — apresente os fatos pedidos e re-tente a
MESMA operação. Por isso este plano usa **replace scriptado** (1 gate de Bash) em
vez de ~15 Edits manuais (15 gates + risco de aplicação parcial).

**Branch:** `feat/mobile-data-backend-flag` off `feat/mobile-login @ b82648c`.

---

### Task 1: Criar a branch e capturar o baseline

**Files:** nenhum (só git + leitura de baseline).

**Step 1: Criar a branch**

Run:
```bash
git switch -c feat/mobile-data-backend-flag
git log --oneline -1   # esperado: b82648c (design doc)
```

**Step 2: Capturar baseline de verificação (guardar os números)**

Run:
```bash
cd mobile
npx jest 2>&1 | tail -5            # esperado: Tests: 107 passed
npx tsc --noEmit 2>&1 | tail -20   # esperado: 8 erros baseline (three.js, maplibre,
                                   # my-stats, MapHeatmapSource, Smartwatch3D)
git grep -c 'AUTH_BACKEND' -- . | wc -l   # nº de arquivos que contêm o token (anotar)
```
Expected: jest 107/107; tsc com **8** erros pré-existentes; anotar a contagem de
arquivos do grep (será o alvo "→ 0" no fim).

**Step 3: Confirmar árvore limpa**

Run: `cd .. && git status --short`
Expected: vazio.

---

### Task 2: Renomear o source-of-truth (`featureFlags.ts`) e ver o tsc "ficar vermelho"

**Files:**
- Modify: `mobile/lib/featureFlags.ts:48-49` (a const + o tipo)

**Step 1: Editar `featureFlags.ts` — tipo, const e comentário (um arquivo, um Edit)**

Trocar o bloco (linhas ~44-49):
```ts
// Selects the auth/profile data source. 'mock' = today's in-memory demo
// behavior (default; no AWS needed). 'amplify' = real Cognito/AppSync via
// aws-amplify — flip to this after `ampx sandbox` generates amplify_outputs
// (see docs/plans/2026-06-22-swi-backend-auth-profile-design.md, Seção 6).
export type AuthBackendKind = 'mock' | 'amplify';
export const AUTH_BACKEND: AuthBackendKind = 'mock';
```
por:
```ts
// Seleciona a fonte de dados de TODOS os domínios (auth, profile, vitals,
// reports, journey, chat, notifications, weather, evacuation, telemetry).
// 'mock' = comportamento de demo in-memory (default; sem AWS). 'amplify' = real
// Cognito/AppSync via aws-amplify — flip pra isto depois que `ampx sandbox`
// gerar amplify_outputs (ver docs/plans/2026-06-22-swi-backend-auth-profile-design.md, Seção 6).
export type DataBackendKind = 'mock' | 'amplify';
export const DATA_BACKEND: DataBackendKind = 'mock';
```

**Step 2: Rodar tsc e CONFIRMAR que ficou vermelho (sinal que dirige o rename)**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "TS2305\|AUTH_BACKEND"`
Expected: vários erros TS2305 ("Module has no exported member 'AUTH_BACKEND'") —
um por arquivo-fonte que ainda importa o nome antigo. Isso é o esperado; a Task 3
zera.

---

### Task 3: Propagar o rename pra todos os consumidores (replace scriptado)

**Files (todos os que `git grep -l` apontar — esperado ~15 fonte + ~9 teste):**
- `mobile/services/*/get*Backend.ts` (10 selectors) + `.test.ts` deles
- `mobile/services/amplify/configure.ts`
- `mobile/app/(auth)/account-confirmation.tsx`, `email-sent.tsx`,
  `password-recovery/new-password.tsx`, `password-recovery/email.tsx`,
  `password-recovery/email-sent.tsx` (comentário)
- quaisquer outros que o grep listar (fonte da verdade = o grep, não esta lista)

**Step 1: Replace do tipo `AuthBackendKind` → `DataBackendKind` (independente)**

Run (Git Bash, só arquivos rastreados — auto-exclui node_modules/.gitignore):
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
files=$(git grep -l 'AuthBackendKind' -- mobile/)
[ -n "$files" ] && sed -i 's/AuthBackendKind/DataBackendKind/g' $files
git grep -n 'AuthBackendKind' -- mobile/   # esperado: vazio
```

**Step 2: Replace do flag `AUTH_BACKEND` → `DATA_BACKEND` (pega imports, usos, chaves de mock e comentários)**

Run:
```bash
files=$(git grep -l 'AUTH_BACKEND' -- mobile/)
sed -i 's/AUTH_BACKEND/DATA_BACKEND/g' $files
git grep -n 'AUTH_BACKEND' -- mobile/   # esperado: VAZIO (check definitivo)
```

**Step 3: Conferir o diff — garantir que `AuthBackend` (interface) ficou intacto**

Run: `git diff --stat && git grep -n '\bAuthBackend\b' -- mobile/services/auth/`
Expected: `AuthBackend` (a interface) ainda presente em `services/auth/`; nenhum
`AUTH_BACKEND`/`AuthBackendKind` sobrou em lugar nenhum.

---

### Task 4: Verificação (o tripé) + build

**Step 1: tsc — 0 erros novos**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: de volta aos **8 erros baseline** (os mesmos da Task 1), **0 novos**. Se
aparecer algo novo mencionando `DATA_BACKEND`/`AUTH_BACKEND`, um consumidor escapou.

**Step 2: jest — verde**

Run: `npx jest 2>&1 | tail -5`
Expected: **107 passed** (igual ao baseline). Mesma contagem = nenhuma regressão de
estrutura de teste.

**Step 3: grep completeness (o check que tsc/jest não dão)**

Run:
```bash
cd .. && git grep -n 'AUTH_BACKEND\|AuthBackendKind' -- mobile/
```
Expected: **vazio**. Se algo aparecer (tipicamente uma chave em `jest.mock` ou um
comentário), é regressão mascarada — corrigir antes de seguir.

**Step 4: expo export web**

Run: `cd mobile && npx expo export --platform web 2>&1 | tail -5`
Expected: exit 0 (bundle web sem erro).

---

### Task 5: Commit

**Step 1: Stage + commit (na branch `feat/mobile-data-backend-flag`)**

> Commit só com OK do usuário (regra do projeto). Pedir luz verde antes de rodar.

Run:
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git add -A
git commit -F - <<'EOF'
refactor(mobile): rename AUTH_BACKEND -> DATA_BACKEND (flag global domain-neutral)

Branch B da fatia 7 (hardening). Rename puro, zero mudança de comportamento:
o switch já governava 10 domínios, não só auth. Verificado: tsc 0 novos,
jest 107/107, git grep AUTH_BACKEND vazio, expo export web OK.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
git log --oneline -1
```

**Step 2: (pós-review) merge — separado, com OK explícito**

FF-merge pra `feat/mobile-login` segue o padrão das fatias anteriores, mas é passo
separado que exige aprovação do usuário. NÃO mergear dentro deste plano.

---

## Definition of Done (branch B)

- [ ] `git grep 'AUTH_BACKEND\|AuthBackendKind' -- mobile/` → vazio
- [ ] `AuthBackend` (interface de auth) intacto
- [ ] tsc: 8 baseline / 0 novos
- [ ] jest: 107/107
- [ ] expo export web: exit 0
- [ ] commit na `feat/mobile-data-backend-flag` (com OK do usuário)
