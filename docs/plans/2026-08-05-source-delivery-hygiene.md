# Higienização e Entrega do Código-Fonte SWI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Higienizar mobile, painel administrativo e backend para um snapshot seguro e orientado a produção e, somente após todos os portões verdes, gerar uma entrega BagIt 1.0 composta exclusivamente por arquivos `.txt`.

**Architecture:** O trabalho ocorre apenas na worktree isolada e em commits pequenos por domínio. Primeiro tornam-se executáveis os portões de qualidade; depois são corrigidos contratos de configuração, caminhos de produção, legado e riscos de segurança; por fim, um exportador determinístico lê o commit aprovado, transforma cada fonte textual em `arquivo.ext.txt` e produz manifestos SHA-256 verificáveis. A geração final nunca lê arquivos não commitados e nunca altera o checkout principal.

**Tech Stack:** TypeScript, Expo/React Native/Jest, React/Vite/Vitest/Playwright, NestJS/Prisma/PostgreSQL/Jest, Node.js 22 com módulos nativos (`node:test`, `node:crypto`, `node:fs`, `node:child_process`), Git e BagIt 1.0.

---

## Regras de execução

- Executar tudo em `C:\Users\Gabriel\.config\superpowers\worktrees\SWI-mobile\source-delivery` na branch `chore/repo-source-delivery`.
- Tratar `C:\Users\Gabriel\Documents\SWI-mobile` como somente leitura. Não instalar dependências, gerar builds ou editar arquivos nesse checkout.
- Não mesclar, enviar ao remoto ou produzir a entrega do cliente sem autorização expressa.
- Usar `@superpowers:test-driven-development` em toda mudança de comportamento, `@superpowers:systematic-debugging` em falhas inesperadas e `@superpowers:verification-before-completion` antes de cada afirmação de sucesso.
- Manter um único assunto por commit. Antes de cada commit: `git diff --check`, `git diff --stat`, testes afetados e inspeção de segredos.
- Não fazer formatação massiva junto com correções funcionais.
- Não reduzir cobertura, afrouxar lint, esconder warnings, aumentar limites de bundle ou adicionar exclusões apenas para tornar um portão verde.
- O design system permanece uma dependência externa. Não copiar, desempacotar ou reimplementar seu código.
- Relatórios temporários, coverage, screenshots, traces, vídeos, builds e artefatos de QA ficam ignorados e fora da entrega.

## Portões obrigatórios

| Portão | Condição para avançar |
|---|---|
| G1: Ferramentas | instalação limpa, lint, typecheck, testes e build reproduzíveis nos três projetos |
| G2: Configuração e segurança | nenhum segredo no snapshot; ambiente validado; auth, autorização, CORS, limites e uploads cobertos |
| G3: Produção real | API real por padrão; mocks, seeds e simuladores apenas por ativação explícita em dev/teste, exceto vitais de saúde, que permanecem simulados por decisão de produto; nenhum caminho Amplify |
| G4: Qualidade | zero erro/warning aceito pelos gates; arquivos de produção abaixo de 800 linhas; código morto e supressões injustificadas removidos |
| G5: Verificação | 80% de cobertura por projeto, E2E críticos, builds limpos, auditoria revisada e CI verde |
| G6: Entrega | commit final limpo e aprovado; BagIt validado; somente `.txt`; hashes e reconstrução de amostra corretos |

### Task 1: Fechar o Gate 0 e os guardrails do trabalho isolado

**Files:**
- Modify: `.gitignore`
- Create: `scripts/quality/assert-worktree.mjs`
- Test: `scripts/quality/assert-worktree.test.mjs`

**Step 1: Write the failing test**

Antes de qualquer mudança, registrar no checkpoint que o escopo já confirmado é o monorepo funcional (`mobile/`, `swi-admin/`, `swi-backend/`), que documentação, histórico, Amplify, QA local, binários e pacote/fonte do design system não entram no payload, e que o cliente exige exclusivamente TXT.

Essa restrição torna a entrega deliberadamente **não buildável de forma autônoma**: assets binários e o design system precisam ser obtidos pelos canais autorizados indicados no inventário externo. Não prometer reconstrução executável a partir dos TXT; a reconstrução validada neste plano é apenas de caminhos e conteúdos textuais.

Fazer também um preflight read-only de segredos antes de editar: revisar os `.env*` rastreados, executar o scanner da Task 16 já neste ponto e abortar diante de valor real. Confirmar por escrito a autorização para entregar o código e inventariar hashes/nomes dos assets excluídos; nenhum conteúdo de terceiro excluído será redistribuído.

Expected: escopo e limitação registrados, zero segredo real no snapshot ou incidente aberto com rotação antes de prosseguir.

**Step 2: Write the failing guard test**

Criar testes com `node:test` que injetam caminhos e estados Git em funções puras:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertExecutionContext } from './assert-worktree.mjs'

test('aceita somente a branch e a worktree de entrega', () => {
  const expected = { root: 'C:/isolated/source-delivery', branch: 'chore/repo-source-delivery' }
  assert.doesNotThrow(() => assertExecutionContext(expected, expected))
})

test('recusa o checkout principal', () => {
  const expected = { root: 'C:/isolated/source-delivery', branch: 'chore/repo-source-delivery' }
  const actual = { root: 'C:/repo', branch: 'main' }
  assert.throws(() => assertExecutionContext(actual, expected), /worktree isolada/)
})
```

**Step 3: Run test to verify it fails**

Run: `node --test scripts/quality/assert-worktree.test.mjs`

Expected: FAIL com `ERR_MODULE_NOT_FOUND` ou export ausente.

**Step 4: Write minimal implementation**

Implementar `assertExecutionContext`, obter a raiz com `git rev-parse --show-toplevel` e a branch com `git branch --show-current`, normalizar `\` para `/` e abortar fora da combinação recebida por `--expected-root` e `--expected-branch`. Não gravar caminho de usuário no script. Adicionar ao `.gitignore`: `**/coverage/`, `**/dist/`, `**/test-results/`, `**/playwright-report/`, `.audit/` e `SWI-source-delivery-*/`.

**Step 5: Run test and guard**

Run: `node --test scripts/quality/assert-worktree.test.mjs`

Expected: 2 testes PASS.

Run: `node scripts/quality/assert-worktree.mjs --expected-root C:\Users\Gabriel\.config\superpowers\worktrees\SWI-mobile\source-delivery --expected-branch chore/repo-source-delivery`

Expected: saída identifica a worktree e a branch aprovadas; exit code 0.

Run: `git -C C:\Users\Gabriel\Documents\SWI-mobile status --short --branch`

Expected: `main` limpa, sem arquivos gerados.

**Step 6: Commit**

```bash
git add .gitignore scripts/quality/assert-worktree.mjs scripts/quality/assert-worktree.test.mjs
git commit -m "chore: add isolated worktree guard"
```

### Task 2: Tornar os portões do mobile executáveis e zerar o typecheck

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`
- Create: `mobile/eslint.config.js`
- Create: `mobile/types/assets.d.ts`
- Modify: `mobile/app/(app)/dashboard.tsx:339`
- Modify: `mobile/app/(app)/map-weather.tsx:327`
- Modify: `mobile/app/(app)/map.tsx:357`
- Modify: `mobile/app/(app)/my-stats.tsx:563`
- Modify: `mobile/components/MapHeatmapSource.native.tsx:27`
- Modify: `mobile/components/MapHeatmapSource.web.tsx:25`
- Modify: `mobile/lib/useMapLibre.ts:21`
- Test: `mobile/components/MapHeatmapSource.test.ts`

**Step 1: Confirm the red gate**

Run: `cd mobile && npx tsc --noEmit`

Expected: FAIL apenas com os oito problemas registrados no desenho: três `@ts-expect-error` sem uso, tupla do gradiente, duas expressões MapLibre, tipos de `three` e import de CSS.

**Step 2: Add a focused expression test**

Extrair `buildColorExpression` para `mobile/components/MapHeatmapSource.types.ts` e testar a saída sem `any`:

```ts
it('gera uma expressão de cor MapLibre válida', () => {
  expect(buildColorExpression([[0, 'transparent'], [1, '#ff0000']])).toEqual([
    'interpolate', ['linear'], ['heatmap-density'], 0, 'transparent', 1, '#ff0000',
  ])
})
```

Run: `cd mobile && npm test -- MapHeatmapSource.test.ts --runInBand`

Expected: FAIL porque a função ainda não é exportada com tipo estrito.

**Step 3: Apply minimal type-safe fixes**

- Remover as três diretivas obsoletas e tipar os estilos web com `ViewStyle`/`TextStyle`, sem `as any`.
- Declarar os gradientes como tuplas readonly compatíveis com a prop do design system.
- Usar `ExpressionSpecification` no renderer web e o tipo de expressão exposto pela biblioteca nativa no renderer native; manter os casts somente na fronteira entre bibliotecas e explicar o motivo.
- Declarar `declare module '*.css'` em `mobile/types/assets.d.ts`.
- Instalar o pacote de tipos compatível: `cd mobile && npm install --save-dev @types/three`.
- Adicionar ESLint conforme a versão do Expo com `npx expo install eslint eslint-config-expo` e criar flat config sem desligar regras TypeScript ou hooks.
- Adicionar scripts:

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --max-warnings=0",
  "test:coverage": "jest --coverage --runInBand",
  "verify": "npm run lint && npm run typecheck && npm test -- --runInBand && npm run build:all",
  "build:all": "expo export --platform all"
}
```

**Step 4: Verify the mobile gate**

Run: `cd mobile && npm run lint`

Expected: exit code 0 e zero warnings.

Run: `cd mobile && npm run typecheck`

Expected: exit code 0 e nenhuma saída de erro.

Run: `cd mobile && npm test -- --runInBand`

Expected: pelo menos 72 suítes e 350 testes PASS.

Run: `cd mobile && npm run build:all`

Expected: bundles Android, iOS e web concluídos; `dist/` permanece ignorado.

**Step 5: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/eslint.config.js mobile/types mobile/app mobile/components mobile/lib/useMapLibre.ts
git commit -m "fix: restore mobile quality gates"
```

### Task 3: Fazer o mobile usar a API real por padrão de produção

**Files:**
- Modify: `mobile/lib/featureFlags.ts`
- Modify: `mobile/lib/featureFlags.test.ts`
- Modify: `mobile/services/auth/apiConfig.ts`
- Create: `mobile/services/auth/apiConfig.test.ts`
- Create: `mobile/.env.example`
- Modify: `mobile/eas.json`
- Test: `mobile/services/**/get*Backend.test.ts`

**Step 1: Write failing runtime-contract tests**

Adicionar funções puras `resolveDataBackend`, `resolveAuthBackend`, `resolveApiUrl` e cobrir:

```ts
expect(resolveDataBackend(undefined, { isDev: false, isTest: false })).toBe('api')
expect(resolveAuthBackend(undefined, { isDev: false, isTest: false })).toBe('api')
expect(resolveDataBackend('mock', { isDev: false, isTest: false })).toBe('api')
expect(resolveDataBackend('mock', { isDev: true, isTest: false })).toBe('mock')
expect(() => resolveApiUrl(undefined, { isDev: false, isTest: false })).toThrow(/EXPO_PUBLIC_API_URL/)
expect(resolveApiUrl('http://localhost:3000', { isDev: true, isTest: false })).toBe('http://localhost:3000')
```

Run: `cd mobile && npm test -- featureFlags.test.ts apiConfig.test.ts --runInBand`

Expected: FAIL porque hoje os defaults são `mock` e `localhost`.

**Step 2: Implement the production-safe resolver**

- Tratar `api` como padrão fora de dev/teste.
- Honrar `mock` somente com `__DEV__`, `NODE_ENV=test` ou uma chave de demonstração explicitamente documentada e nunca presente nos perfis de produção.
- Recusar valores desconhecidos em vez de fazer cast direto de `process.env`.
- Exigir `EXPO_PUBLIC_API_URL` em produção e permitir localhost apenas em dev/teste.
- Manter cenários de clima e evacuação fora da configuração de produção; vitais são exceção deliberada e permanecem simulados em produção (decisão de produto de 2026-07-30, reafirmada em 2026-08-05).
- Sanitizar `mobile/.env.example` apenas com placeholders públicos; nenhuma credencial.
- Confirmar que todos os perfis de release em `mobile/eas.json` declaram API real e URL válida por ambiente.

**Step 3: Update selector tests**

Para cada seletor em `mobile/services/{auth,profile,reports,journey,chat,notifications,weather,evacuation,positions}`, testar explicitamente `api` e `mock`, e alterar expectativas antigas de “mock por padrão”. Não testar por detalhes internos; afirmar a identidade do adaptador retornado.

**Step 4: Verify**

Run: `cd mobile && npm test -- featureFlags.test.ts getAuthBackend.test.ts getProfileBackend.test.ts getReportsBackend.test.ts getJourneyBackend.test.ts getChatBackend.test.ts getNotificationBackend.test.ts getWeatherBackend.test.ts getEvacuationBackend.test.ts --runInBand`

Expected: todas as suítes PASS.

Run: `cd mobile && npm run verify`

Expected: lint, typecheck, testes e export web PASS.

**Step 5: Commit**

```bash
git add mobile/lib mobile/services mobile/.env.example mobile/eas.json
git commit -m "fix: make mobile api the production default"
```

### Task 4: Remover Amplify do mobile preservando os vitais simulados

**Exceção de produto:** os vitais de saúde (batimentos, temperatura) permanecem simulados em todos os ambientes, inclusive produção, até a integração do smartband real (decisão de 2026-07-30, reafirmada em 2026-08-05). Esta task remove apenas os providers Amplify legados; não introduz estado "hardware indisponível".

**Files:**
- Delete: `mobile/services/vitals/amplifyVitalsBackend.ts`
- Delete: `mobile/services/telemetry/amplifyTelemetrySink.ts`
- Modify: `mobile/services/vitals/getVitalsBackend.ts`
- Modify: `mobile/services/vitals/getVitalsBackend.test.ts`
- Modify: `mobile/services/telemetry/getTelemetrySink.ts`
- Modify: `mobile/services/telemetry/getTelemetrySink.test.ts`
- Create: `mobile/services/telemetry/noopTelemetrySink.ts`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`
- Modify: comments containing the obsolete provider under `mobile/app/` and `mobile/services/`

**Step 1: Write characterization and failing tests**

```ts
it('mantém vitais simulados como padrão, inclusive em produção', () => {
  expect(getVitalsBackend({ isDev: false, isTest: false }))
    .toBe(mockVitalsBackend)
})

it('nunca resolve para o provider legado', () => {
  expect(() => getVitalsBackend({ isDev: false, isTest: false, backend: 'amplify' as never }))
    .not.toBe(amplifyVitalsBackend)
})
```

Para telemetria: produção sem hardware usa sink no-op claramente nomeado, nunca o provider legado.

Run: `cd mobile && npm test -- getVitalsBackend.test.ts getTelemetrySink.test.ts --runInBand`

Expected: o teste de caracterização dos vitais PASS no código atual; os casos que referenciam o provider legado FAIL até a remoção.

**Step 2: Implement the cleanup**

- `getVitalsBackend` continua devolvendo `mockVitalsBackend` por padrão em todos os ambientes; apenas a rota Amplify é removida.
- `noopTelemetrySink` deve descartar somente porque não há fonte real de hardware, sem fingir persistência.
- Documentar no seletor de vitais, em comentário curto, que a simulação é decisão de produto até o smartband real.

**Step 3: Remove the legacy dependency**

Run: `rg -n "aws-amplify|Amplify|amplify" mobile --glob "!package-lock.json"`

Remover arquivos, imports, comentários obsoletos e `aws-amplify` do manifest; executar `npm install --package-lock-only` para atualizar o lockfile.

Run novamente o `rg`.

Expected: nenhuma ocorrência, exceto histórico fora do snapshot atual, que não será exportado.

**Step 4: Verify and commit**

Run: `cd mobile && npm run verify`

Expected: PASS.

```bash
git add -A mobile
git commit -m "refactor: remove mobile legacy provider paths"
```

### Task 5: Decompor a tela mobile acima do limite sem alterar comportamento

**Emenda de 2026-08-05 (aprovada pelo usuário):** a estrutura original desta task
(`DashboardHeader`, `HealthSummary`, `RecentAlerts`, `useDashboardSnapshot`) foi
escrita antes de o arquivo ser lido e não corresponde ao que ele tem. Não existe
cabeçalho, não existe lista de alertas recentes, e quase não há estado a extrair
para um hook: os dados vêm todos de providers já existentes.

O que o `dashboard.tsx` tem de fato são **duas telas convivendo**, `Dashboard`
(a normal) e `AlertActiveView` (o branch `?alert=active`), mais três componentes
locais e um bloco de constantes de desenho. A decomposição segue essa divisão,
que sozinha resolve o limite de 800 linhas sem recortes artificiais.

A árvore também muda: o repo não tem `features/`, e sim `components/<domínio>/`
(`chat`, `journey`, `modals`, `notifications`, `reports`, `vitals`) com as
constantes de desenho em `lib/dashboard*.ts`. Seguir a convenção existente em vez
de introduzir uma segunda.

**Files:**
- Modify: `mobile/app/(app)/dashboard.tsx`
- Create: `mobile/components/dashboard/AlertActiveView.tsx`
- Create: `mobile/components/dashboard/StatCol.tsx`
- Create: `mobile/components/dashboard/StatDivider.tsx`
- Create: `mobile/components/dashboard/BadgedButton.tsx`
- Create: `mobile/lib/dashboardDecor.ts`
- Test: `mobile/__tests__/app/(app)/dashboard.integration.test.tsx`

**Step 1: Write the characterization suite**

A suíte NÃO existe ainda; é preciso escrevê-la antes de mover qualquer JSX. Ela
não afirma estrutura de arquivo nem hierarquia de componentes, só o que a tela
mostra e para onde navega, que é o que precisa sobreviver à mudança.

Cobrir, no `Dashboard`: as quatro fases dos vitais (carregando, vazio, erro,
pronto), a origem real dos três números, o selo de coração escondido no estado
`stale`, as contagens de pendências com concordância de número, e o destino de
cada botão.

Cobrir, no `AlertActiveView`: o título, os quatro passos, o fallback estático do
clima, a precedência sobre a fase dos vitais e os três destinos de navegação. É
tela de segurança e não pode regredir em silêncio.

Run: `cd mobile && npm test -- dashboard.integration.test.tsx --runInBand`

Expected: PASS no código atual; a suíte registra o comportamento a preservar.

**Step 2: Extract one cohesive unit at a time**

Ordem: constantes de desenho, depois os três componentes locais, depois a tela de
evacuação. Nenhum extraído importa backend diretamente. Não duplicar tokens nem
componentes do design system.

Após cada arquivo:

Run: `cd mobile && npm test -- dashboard.integration.test.tsx --runInBand`

Expected: PASS após cada extração.

**Step 3: Enforce size and quality**

Run: `$n=(Get-Content -LiteralPath 'mobile/app/(app)/dashboard.tsx').Count; if ($n -ge 800) { throw "dashboard ainda tem $n linhas" }`

Expected: menos de 800 linhas.

Run: `cd mobile && npm run verify`

Expected: PASS.

**Step 4: Commit**

```bash
git add mobile/app mobile/components mobile/lib mobile/__tests__
git commit -m "refactor: split mobile dashboard responsibilities"
```

### Task 6: Tornar o admin exclusivamente REST em produção e remover Amplify

**Files:**
- Modify: `swi-admin/src/services/admins.ts`
- Modify: `swi-admin/src/services/chats.ts`
- Modify: `swi-admin/src/services/auth.ts`
- Modify: `swi-admin/src/services/types/index.ts`
- Modify: type imports under `swi-admin/src/services/api/`
- Delete: `swi-admin/src/services/dataBackend.ts`
- Delete: `swi-admin/src/services/amplifyApi/admins.ts`
- Delete: `swi-admin/src/services/amplifyApi/auth.ts`
- Delete: `swi-admin/src/services/amplifyApi/chats.ts`
- Delete: `swi-admin/src/services/amplifyApi/employees.ts`
- Delete: `swi-admin/src/services/amplifyApi/monitoring.ts`
- Delete: `swi-admin/src/services/amplifyApi/notDeployed.ts`
- Create: `swi-admin/src/services/production-contract.test.ts`
- Modify: `swi-admin/.env.example`
- Modify: `swi-admin/src/services/api/http.ts`
- Modify: `swi-admin/vite.config.ts`
- Modify: `swi-admin/src/app/App.tsx`
- Modify: `swi-admin/src/app/AppLayout.tsx`
- Modify: `swi-admin/src/pages/dashboard/Dashboard.tsx`
- Modify: `swi-admin/src/pages/maps/MapsGeneral.tsx`
- Modify: `swi-admin/src/types/rn-web-augment.d.ts`
- Delete: `swi-admin/src/dev/fidelity/FidelityReview.tsx`
- Delete: `swi-admin/src/dev/fidelity/snapshots/dashboard-frame-4-2.png`
- Test: `swi-admin/src/services/api/http.test.ts`

**Step 1: Write failing production-contract tests**

```ts
it('expõe chat e admins vindos da API REST', async () => {
  expect((await import('./chats')).chatsApi).toBe((await import('./api/chats')).chatsApi)
  expect((await import('./admins')).adminsApi).toBe((await import('./api/users')).adminsApi)
})

it('recusa URL local quando o build é de produção', () => {
  expect(() => resolveApiUrl(undefined, true)).toThrow(/VITE_API_URL/)
  expect(() => resolveApiUrl('http://localhost:3000', true)).toThrow(/produção/)
})
```

Run: `cd swi-admin && npm test -- src/services/production-contract.test.ts src/services/api/http.test.ts`

Expected: FAIL porque `admins.ts` e `chats.ts` ainda selecionam mock/provider legado e a URL possui fallback permissivo.

**Step 2: Replace production seams**

- Reexportar `adminsApi` de `./api/users` e `chatsApi` de `./api/chats`.
- Fazer `authApi` enumerar apenas operações reais; se um método ainda não possuir endpoint, removê-lo da interface produtiva e ajustar o consumidor sob teste, sem espalhar `mockAuthApi`.
- Mover DTOs compartilhados de `mockApi` para `services/types`; mocks e API passam a importar os mesmos contratos neutros.
- Validar `VITE_API_URL` no bootstrap: produção sem URL ou com localhost falha cedo; dev/teste pode usar localhost.
- Remover de `.env.example` qualquer variável de design, token pessoal ou metadado de ferramenta e manter somente placeholders de runtime.

**Step 3: Delete legacy files and prove absence**

Run: `rg -n "amplifyApi|Amplify|amplify" swi-admin/src swi-admin/package.json`

Expected após a remoção: nenhuma ocorrência.

Remover também o overlay experimental de fidelidade, sua rota `/dev/fidelity`, o endpoint local que gravava notas em `docs/audits`, a captura versionada e os atributos `data-fidelity`. Em `vite.config.ts`, remover o alias/watcher para uma cópia local do design system: o admin deve resolver somente a dependência declarada, cuja fonte e pacote não serão entregues. Manter o design system apenas nos imports normais e no manifest.

Run: `rg -n "fidelity|Fidelity|FIGMA|figma|dsLocalRoot|dsLocalWatcher" swi-admin/src swi-admin/vite.config.ts swi-admin/.env.example`

Expected: nenhuma ferramenta, rota, token, captura ou marcador local de revisão visual. Referências históricas em comentários funcionais devem ser reescritas como requisitos de layout, sem depender de ferramenta externa.

Run: `rg -n "mockApi" swi-admin/src --glob "!**/*.test.*" --glob "!**/*.stories.*"`

Expected: somente módulos explicitamente de simulação de saúde, se ainda necessários, e nenhum import de valor no grafo de produção. Imports de tipos devem ter sido movidos para `services/types`.

**Step 4: Verify and commit**

Run: `cd swi-admin && npm run typecheck && npm run lint && npm test && npm run build`

Expected: todos PASS.

```bash
git add -A swi-admin
git commit -m "refactor: make admin rest api authoritative"
```

### Task 7: Zerar warnings de hooks e assincronismo do admin

**Files:**
- Modify: `swi-admin/src/hooks/useRescueRoute.ts`
- Modify: `swi-admin/src/hooks/useRescueRoute.test.tsx`
- Modify: testes que emitirem `act(...)` em `swi-admin/src/**/*.test.tsx`
- Modify: `swi-admin/src/test-setup.ts`
- Modify: `swi-admin/package.json`
- Modify: `swi-admin/package-lock.json`

**Step 1: Capture the warnings as failures**

No teste do hook, rerenderizar com arrays de mesma coordenada e com coordenada alterada; afirmar que não refaz a chamada no primeiro caso e refaz no segundo. No setup de teste, capturar `console.error` e falhar para mensagens inesperadas de `act(...)`, restaurando o spy após cada teste.

Run: `cd swi-admin && npm test -- src/hooks/useRescueRoute.test.tsx`

Expected: teste caracteriza o comportamento; lint ainda retorna cinco warnings.

**Step 2: Fix dependencies without suppressions**

Extrair escalares antes do efeito:

```ts
const fromLng = from?.[0]
const fromLat = from?.[1]
const toLng = to?.[0]
const toLat = to?.[1]
```

Construir as tuplas dentro do efeito e listar apenas os quatro escalares como dependências. Não desabilitar `react-hooks/exhaustive-deps`.

**Step 3: Fix React async tests**

Para cada warning capturado, envolver interações em `act` quando necessário e aguardar efeitos com `findBy*`/`waitFor`. Não silenciar `console.error`; testes que exercitam erro esperado devem fazer whitelist local da mensagem exata.

Adicionar `--max-warnings=0` ao script `lint`.

**Step 4: Verify and commit**

Run: `cd swi-admin && npm run lint`

Expected: zero warnings.

Run: `cd swi-admin && npm test`

Expected: todas as suítes PASS e nenhum warning de `act(...)`.

```bash
git add swi-admin/src swi-admin/package.json swi-admin/package-lock.json
git commit -m "test: eliminate admin async warnings"
```

### Task 8: Decompor os arquivos grandes do admin sob testes de caracterização

**Files** (reconciliado com a árvore depois da execução; a fronteira real de cada
página só apareceu ao ler o arquivo inteiro, então vários nomes previstos deram
lugar a outros, sempre nomeando o arquivo pelo componente que ele exporta):

Chat, 1394 → 362 linhas:
- Modify: `swi-admin/src/pages/chat/ChatInbox.tsx`
- Modify: `swi-admin/src/pages/chat/ChatInbox.test.tsx`
- Create: `swi-admin/src/pages/chat/components/ChatBubble.tsx`
- Create: `swi-admin/src/pages/chat/components/ContactInfoPanel.tsx`
- Create: `swi-admin/src/pages/chat/components/ConversationList.tsx`
- Create: `swi-admin/src/pages/chat/components/MessageThread.tsx`
- Create: `swi-admin/src/pages/chat/hooks/useChatInbox.ts`

Dashboard, 992 → 232 linhas (seis seções visuais, cada uma com seu `testID` de
topo, em vez dos dois arquivos previstos):
- Modify: `swi-admin/src/pages/dashboard/Dashboard.tsx`
- Create: `swi-admin/src/pages/dashboard/components/ActivitiesSection.tsx`
- Create: `swi-admin/src/pages/dashboard/components/DashboardKpis.tsx`
- Create: `swi-admin/src/pages/dashboard/components/HealthDonuts.tsx`
- Create: `swi-admin/src/pages/dashboard/components/MapBanner.tsx`
- Create: `swi-admin/src/pages/dashboard/components/WearAlertsSection.tsx`
- Create: `swi-admin/src/pages/dashboard/components/WeatherStrip.tsx`

Configurações do usuário, 1001 → 494 linhas:
- Modify: `swi-admin/src/pages/user/UserSettings.tsx`
- Create: `swi-admin/src/pages/user/hooks/useUserSettings.ts`
- Create: `swi-admin/src/pages/user/components/ExamsSection.tsx`
- Create: `swi-admin/src/pages/user/components/PasswordInput.tsx`
- Create: `swi-admin/src/pages/user/components/PasswordSection.tsx`
- Create: `swi-admin/src/pages/user/components/PermissionsSection.tsx`
- Create: `swi-admin/src/pages/user/components/PrivacyPolicyModal.tsx`

Formulário de tarefa, 810 → 420 linhas, e a suíte de 967 dividida em três por
tema (o bloco `vi.hoisted`/`vi.mock` se repete em cada uma porque o hoisting do
Vitest é por arquivo):
- Modify: `swi-admin/src/pages/tasks/TaskForm.tsx`
- Create: `swi-admin/src/pages/tasks/hooks/useTaskForm.ts`
- Create: `swi-admin/src/pages/tasks/components/AttachmentSlot.tsx`
- Delete: `swi-admin/src/pages/tasks/TaskForm.test.tsx`
- Create: `swi-admin/src/pages/tasks/TaskForm.testKit.tsx`
- Create: `swi-admin/src/pages/tasks/TaskForm.create.test.tsx`
- Create: `swi-admin/src/pages/tasks/TaskForm.attachments.test.tsx`
- Create: `swi-admin/src/pages/tasks/TaskForm.edit.test.tsx`

Mapas, 809 → 229 linhas, precedido de 11 testes novos (a única página cuja
cobertura não sustentava a extração; ver Step 1):
- Modify: `swi-admin/src/pages/maps/MapsGeneral.tsx`
- Modify: `swi-admin/src/pages/maps/MapsGeneral.test.tsx`
- Create: `swi-admin/src/pages/maps/hooks/useMapsGeneral.ts`
- Create: `swi-admin/src/pages/maps/pinBuilders.tsx`
- Create: `swi-admin/src/pages/maps/components/HeatmapLegend.tsx`
- Create: `swi-admin/src/pages/maps/components/BackToDashboardButton.tsx`

Code splitting (Step 3) e gate de tamanho (Step 4):
- Modify: `swi-admin/src/app/App.tsx`
- Modify: `swi-admin/src/app/AppLayout.tsx`
- Modify: `swi-admin/src/pages/monitoring/MonitoringLayout.tsx`
- Create: `swi-admin/src/app/RouteFallback.tsx`
- Create: `swi-admin/src/app/lazyRoutes.test.tsx`
- Modify: `swi-admin/vite.config.ts`
- Modify: `swi-admin/package.json`
- Create: `scripts/quality/assert-file-size.mjs`
- Create: `scripts/quality/assert-file-size.test.mjs`

**Step 1: Lock current behavior**

Executar primeiro os testes existentes de cada página. Acrescentar somente os cenários críticos ausentes: loading, erro, vazio, sucesso, permissão, submit e realtime. Todos devem passar antes da primeira extração.

Run: `cd swi-admin && npm test -- src/pages/chat/ChatInbox.test.tsx src/pages/dashboard/Dashboard.test.tsx src/pages/user/UserSettings.test.tsx src/pages/tasks/TaskForm.test.tsx src/pages/maps/MapsGeneral.test.tsx`

Expected: PASS.

**Step 2: Extract one page per commit**

Para cada página, mover um hook ou componente por vez, executar apenas sua suíte, depois typecheck e lint. Props são readonly; atualizações de estado criam novos arrays/objetos. Nenhum novo arquivo deve importar mock, fixture ou token de design bruto.

Commits esperados, um por página:

```bash
git commit -m "refactor: split admin chat inbox"
git commit -m "refactor: split admin dashboard"
git commit -m "refactor: split admin user settings"
git commit -m "refactor: split admin task form"
git commit -m "refactor: split admin maps page"
```

**Step 3: Lazy-load heavy routes**

Em `swi-admin/src/app/App.tsx`, usar `React.lazy`/`Suspense` para chat, mapas, dashboard e formulários pesados, mantendo guardas e rotas públicas. Adicionar teste de rota que aguarda o fallback e a página final.

Run: `cd swi-admin && npm run build`

Expected: build PASS; MapLibre e páginas pesadas fora do chunk inicial. Não resolver alerta elevando `chunkSizeWarningLimit`.

Medição feita antes de executar: dos 974 kB do chunk inicial, só 246 kB eram código da aplicação; os outros 728 kB eram vendor que toda rota usa, inclusive o `/login` (react-native-web 232, design system 210, react-dom 130, styled-components e resto ~156). Ou seja, `React.lazy` sozinho deixaria o índice em ~770 kB e o alerta continuaria, porque o peso não está nas páginas. Por isso o passo também separa o vendor em três grupos via `build.rollupOptions.output.manualChunks` (decidido com o usuário). Isso é code splitting, não elevar limite.

Resultado: índice 93,6 kB; vendor-react 163,7; vendor-react-native 261,1; vendor-design-system 263,4; 22 chunks de página (0,06 a 22,2 kB). O alerta de 500 kB permanece **apenas** para `maplibre-gl` (1053,9 kB), que já carrega sob demanda por `lib/useMapLibre` e é uma biblioteca única, sem fronteira interna para dividir.

Verificado em navegador, não só no build: `vite preview` mais Playwright, `/login` monta com zero erro de console e navegar para `/tasks` busca `TasksList-*.js` sob demanda com o chrome do AppLayout na tela. O teste de fronteira é `swi-admin/src/app/lazyRoutes.test.tsx`.

**Step 4: Enforce file-size gate**

Run: `cd swi-admin && npm run gate:file-size`

Expected: nenhum arquivo listado, inclusive testes anteriormente grandes.

O gate mora em `scripts/quality/assert-file-size.mjs`, ao lado do `assert-worktree.mjs`, com suíte própria em `assert-file-size.test.mjs` (`node --test "scripts/quality/*.test.mjs"`).

A conferência que estava escrita aqui era um snippet PowerShell começando por `rg --files`. Foi substituída porque **falhava aberto**: onde o ripgrep não está no PATH, o comando erra, `$bad` fica vazio, o `if ($bad)` não dispara e a saída se lê exatamente como aprovação. Foi o que aconteceu ao executá-la. O script substituto não depende de ferramenta externa (varre com `node:fs`) e trata varredura vazia ou menor que `--min-scanned` como reprovação, não como sucesso.

Run: `cd swi-admin && npm run typecheck && npm run lint && npm test && npm run build`

Expected: PASS.

### Task 9: Padronizar lint, typecheck e cobertura do backend

**Reconciliação pós-execução (2026-08-10):** o config nasceu como
`eslint.config.mjs`, não `.js`: o pacote é CommonJS e os presets do
typescript-eslint são ESM, e a extensão explícita evita converter o pacote
inteiro (motivo registrado no header do próprio arquivo). Os dois tsconfigs
não precisaram de mudança: o `tsconfig.json` já era `strict: true` e, sem
`include`, já cobre src, test e prisma. O `coverageThreshold` de 80 previsto
no Step 2 entrou na Task 13, que é onde a cobertura foi de fato atingida e
travada; ligar o threshold aqui reprovaria a suíte no mesmo commit que
instala a ferramenta.

**Files** (como executado):
- Modify: `swi-backend/package.json`
- Modify: `swi-backend/package-lock.json`
- Create: `swi-backend/eslint.config.mjs`

**Step 1: Confirm missing gates**

Run: `cd swi-backend && npm run lint`

Expected: FAIL com `Missing script: lint`.

Run: `cd swi-backend && npm run typecheck`

Expected: FAIL com `Missing script: typecheck`.

**Step 2: Install and configure the minimal toolchain**

Instalar ESLint 9, `@eslint/js`, `typescript-eslint` e globals em versões compatíveis com Node 18 e 22. Configurar TypeScript estrito sobre `src`, `test` e `prisma`, ignorando apenas `dist`, `coverage` e código gerado.

Adicionar scripts:

```json
{
  "lint": "eslint src test prisma --max-warnings=0",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "test:coverage": "jest --coverage --runInBand",
  "verify": "npm run lint && npm run typecheck && npm test -- --runInBand && npm run build"
}
```

Adicionar `coverageThreshold.global` com 80 para branches, functions, lines e statements. Não excluir controllers, services ou guards.

**Step 3: Fix findings in focused commits**

Corrigir imports, promises, tipos e código morto por módulo. Se houver mudança de comportamento, escrever teste falho antes e separar do commit de ferramenta. Não adicionar `eslint-disable` amplo.

**Step 4: Verify and commit**

Run: `cd swi-backend && npm run lint && npm run typecheck && npm test -- --runInBand && npm run build`

Expected: zero warnings/erros; ao menos 43 suítes e 440 testes PASS; build PASS.

```bash
git add swi-backend/package.json swi-backend/package-lock.json swi-backend/eslint.config.js swi-backend/tsconfig*.json swi-backend/src swi-backend/test swi-backend/prisma
git commit -m "chore: add backend quality gates"
```

### Task 10: Centralizar e validar o contrato de ambiente do backend

**Reconciliação pós-execução (2026-08-10):** a centralização escolhida é a de
VALIDAÇÃO, não a de consumo. `parseRuntimeEnv` valida o ambiente inteiro no
boot, antes do `NestFactory.create` (ordem provada em `main.env.spec.ts`), e
uma produção incompleta derruba a inicialização, que é o objetivo de segurança
da task. `cors.ts`, `mail.service.ts` e `media.service.ts` seguem lendo
`process.env` localmente: depois do boot validado essas leituras são seguras,
e convertê-las pra injeção do config mexeria na construção dos módulos sem
ganho de comportamento. A única regra duplicada, a força do JWT em produção,
compartilha a constante `MIN_JWT_SECRET_LENGTH` do contrato e o comentário em
`jwt-secret.ts` faz a referência cruzada. Entraram também
`src/main.env.spec.ts` e `src/auth/jwt-secret.spec.ts`, que não estavam na
lista.

**Files** (como executado):
- Create: `swi-backend/src/config/runtime-env.ts`
- Create: `swi-backend/src/config/runtime-env.spec.ts`
- Create: `swi-backend/src/main.env.spec.ts`
- Create: `swi-backend/src/auth/jwt-secret.spec.ts`
- Modify: `swi-backend/src/main.ts`
- Modify: `swi-backend/src/auth/jwt-secret.ts`
- Modify: `swi-backend/.env.example`
- Modify: `swi-backend/docker-compose.yml`
- Modify: `swi-backend/package.json`

**Step 1: Write failing environment tests**

```ts
it('recusa produção sem variáveis obrigatórias', () => {
  expect(() => parseRuntimeEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/)
})

it('recusa segredo JWT fraco em produção', () => {
  expect(() => parseRuntimeEnv(validProd({ JWT_SECRET: 'curto' }))).toThrow(/JWT_SECRET/)
})

it('recusa localhost e wildcard no CORS de produção', () => {
  expect(() => parseRuntimeEnv(validProd({ CORS_ORIGINS: '*' }))).toThrow(/CORS_ORIGINS/)
})

it('permite defaults locais apenas em development e test', () => {
  expect(parseRuntimeEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only' }).nodeEnv).toBe('test')
})
```

Run: `cd swi-backend && npm test -- runtime-env.spec.ts --runInBand`

Expected: FAIL porque o parser central ainda não existe.

**Step 2: Implement a typed immutable config**

`parseRuntimeEnv` deve retornar `Readonly<RuntimeEnv>` e validar, sem imprimir valores:

- `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PORT`, `LISTEN_SOCKET`;
- `ADMIN_APP_URL`, `CORS_ORIGINS`, `CORS_PROXY_SETS_ORIGIN`;
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `REPORT_TO_EMAIL`;
- `MINIO_PUBLIC_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_REGION`;
- `MAPBOX_TOKEN`, `WEATHER_CRON`, `WEATHER_SCENARIO`, `SIM_POSITIONS`.

Em produção, exigir banco, JWT forte, origem HTTPS explícita, remetente e destinatário de moderação. Credenciais S3 podem ficar ausentes quando a cadeia de credenciais da infraestrutura for usada; pares incompletos devem falhar. `main.ts` valida antes de criar a aplicação.

**Step 3: Align examples and compose**

- Tornar `.env.example` a lista completa, com placeholders, comentários de dev/produção e sem segredo funcional.
- Definir `NODE_ENV=development` no compose.
- Usar os nomes externos `API_SMTP_*` apenas para interpolação do compose e documentar o mapeamento para `SMTP_*` dentro do container.
- Não inserir valores de produção no repositório.

**Step 4: Verify and commit**

Run: `cd swi-backend && npm test -- runtime-env.spec.ts main.spec.ts jwt-secret.spec.ts cors.spec.ts --runInBand`

Expected: PASS.

Run: `cd swi-backend && npm run verify`

Expected: PASS.

```bash
git add swi-backend/src/config swi-backend/src/main.ts swi-backend/src/auth swi-backend/src/cors.ts swi-backend/src/mail swi-backend/src/media swi-backend/.env.example swi-backend/docker-compose.yml
git commit -m "fix: validate backend runtime configuration"
```

### Task 11: Confinar simuladores e seeds a dev/teste e remover backend legado

**Files:**
- Modify: `swi-backend/src/positions/position-simulator.service.ts`
- Modify: `swi-backend/src/positions/position-simulator.service.spec.ts`
- Modify: `swi-backend/src/weather/weather.service.ts`
- Modify: `swi-backend/src/weather/weather.service.spec.ts`
- Modify: `swi-backend/prisma/seed.ts`
- Create: `swi-backend/src/config/seed-guard.ts`
- Create: `swi-backend/src/config/seed-guard.spec.ts`
- Modify: `swi-backend/docker-compose.yml`
- Delete: `swi-backend/amplify/auth/resource.ts`
- Delete: `swi-backend/amplify/tsconfig.json`

**Step 1: Write failing production-safety tests**

```ts
it('não inicia simulador em production mesmo com SIM_POSITIONS=1', async () => {
  process.env.NODE_ENV = 'production'
  process.env.SIM_POSITIONS = '1'
  await service.onModuleInit()
  expect(prisma.user.findMany).not.toHaveBeenCalled()
})

it('não fabrica alerta em production mesmo com WEATHER_SCENARIO=alert', async () => {
  process.env.NODE_ENV = 'production'
  process.env.WEATHER_SCENARIO = 'alert'
  expect((await service.getWeather()).alerts).toEqual([])
})

it('recusa seed sem ALLOW_DEV_SEED=1 e fora de test', () => {
  expect(() => assertSeedAllowed({ NODE_ENV: 'production', ALLOW_DEV_SEED: '1' })).toThrow()
})
```

Run: `cd swi-backend && npm test -- position-simulator.service.spec.ts weather.service.spec.ts seed-guard.spec.ts --runInBand`

Expected: os novos casos de produção FAIL.

**Step 2: Implement explicit dev/test gates**

- Simulador requer simultaneamente `NODE_ENV !== production` e `SIM_POSITIONS=1`.
- Clima artificial requer simultaneamente `NODE_ENV !== production` e `WEATHER_SCENARIO=alert`.
- Seed requer `NODE_ENV` dev/teste e `ALLOW_DEV_SEED=1`; testes podem injetar configuração isolada.
- Compose declara as flags apenas como conveniência de desenvolvimento.

**Step 3: Remove legacy directory**

Run: `rg -n "amplify|Amplify" swi-backend --glob "!package-lock.json"`

Excluir `swi-backend/amplify/` e atualizar comentários restantes que descrevem arquitetura antiga.

Run novamente o `rg`.

Expected: nenhuma ocorrência no snapshot atual.

**Step 4: Verify and commit**

Run: `cd swi-backend && npm run verify`

Expected: PASS.

```bash
git add -A swi-backend
git commit -m "fix: isolate backend development simulators"
```

### Task 12: Fechar a matriz de segurança do backend

**Files:**
- Create: `swi-backend/test/security.e2e-spec.ts`
- Create: `swi-backend/docker-compose.e2e.yml`
- Modify: `swi-backend/src/auth/jwt-auth.guard.ts`
- Modify: `swi-backend/src/auth/roles.guard.ts`
- Modify: `swi-backend/src/app.module.ts`
- Modify: `swi-backend/src/media/media.controller.ts`
- Modify: `swi-backend/src/media/media.service.ts`
- Modify: `swi-backend/src/media/allowed-content-types.ts`
- Modify only if tests prove leakage: `swi-backend/src/main.ts`

**Step 1: Write the security E2E matrix**

Cobrir no mínimo:

```ts
it.each([
  ['sem token', undefined, 401],
  ['token inválido', 'Bearer inválido', 401],
])('protege rota administrativa: %s', async (_name, auth, status) => {
  const req = request(app.getHttpServer()).get('/users')
  if (auth) req.set('Authorization', auth)
  await req.expect(status)
})

it('nega operação ADMIN para WORKER', async () => { /* token real de worker; expect 403 */ })
it('aplica rate limit a login e presign', async () => { /* exceder limite; expect 429 */ })
it('não devolve stack, segredo ou SQL no erro 500', async () => { /* expect body sanitizado */ })
it('nega content-type e tamanho fora da política de upload', async () => { /* expect 400 */ })
```

**Step 2: Run against isolated PostgreSQL**

Criar `docker-compose.e2e.yml` com portas de host exclusivas e volume nomeado pelo projeto; nenhum serviço usa as portas do stack principal.

Run: `cd swi-backend && docker compose -p swi-source-delivery-security -f docker-compose.yml -f docker-compose.e2e.yml up -d db mailhog minio minio-init`

Run: `cd swi-backend && $env:DATABASE_URL='postgresql://swi:swi@localhost:55432/swi'; npx prisma migrate deploy`

Run: `cd swi-backend && $env:DATABASE_URL='postgresql://swi:swi@localhost:55432/swi'; npm run test:e2e -- --runInBand security.e2e-spec.ts`

Expected: os casos que revelarem lacunas FAIL; registrar cada lacuna antes de alterar a implementação.

Teardown obrigatório, inclusive após falha: `cd swi-backend && docker compose -p swi-source-delivery-security -f docker-compose.yml -f docker-compose.e2e.yml down -v --remove-orphans`.

**Step 3: Apply minimal fixes**

Corrigir somente falhas demonstradas. Manter validação global com whitelist/forbidNonWhitelisted/transform, autorização por função, throttling habilitado fora de teste unitário, uploads por tipo/tamanho/prefixo e erros sem detalhes internos. Não mudar o envelope de sucesso global se isso quebrar clientes; segurança não justifica refatoração de contrato sem teste de compatibilidade.

**Step 4: Verify and commit**

Repetir o start isolado, migration e teardown da Step 2. Com `DATABASE_URL=postgresql://swi:swi@localhost:55432/swi`:

Run: `cd swi-backend && npm run test:e2e -- --runInBand`

Expected: todas as 11 suítes E2E existentes mais `security.e2e-spec.ts` PASS.

Run: `cd swi-backend && npm run verify`

Expected: PASS.

```bash
git add swi-backend/src swi-backend/test/security.e2e-spec.ts swi-backend/docker-compose.e2e.yml
git commit -m "test: enforce backend security boundaries"
```

### Task 13: Atingir e travar 80% de cobertura útil

**Files:**
- Modify: `mobile/package.json`
- Modify: `swi-admin/vite.config.ts`
- Modify: `swi-admin/package.json`
- Modify: `swi-admin/package-lock.json`
- Modify: `swi-backend/package.json`
- Test: arquivos `*.test.ts`, `*.test.tsx`, `*.spec.ts` próximos dos módulos descobertos pelo relatório

**Step 1: Generate honest reports**

Antes de medir, configurar inclusão explícita da árvore de produção:

- mobile/Jest: `collectCoverageFrom` cobre `app/**/*.{ts,tsx}`, `components/**/*.{ts,tsx}`, `features/**/*.{ts,tsx}`, `lib/**/*.ts` e `services/**/*.ts`;
- admin/Vitest: `coverage.include` cobre `src/**/*.{ts,tsx}`;
- backend/Jest: `collectCoverageFrom` cobre `src/**/*.ts`.

Excluir somente declarations, arquivos gerados, stories, testes, entrypoints sem lógica e shims de plataforma comprovadamente não executáveis no runner. Gerar o baseline antes de ativar o threshold para não confundir ausência de teste com falha de ferramenta.

Run: `cd mobile && npm run test:coverage`

Run: `cd swi-admin && npm install --save-dev @vitest/coverage-v8 && npm test -- --coverage`

Run: `cd swi-backend && npm run test:coverage`

Expected: relatórios mostram o baseline real; algum projeto pode falhar inicialmente no threshold de 80%.

**Step 2: Close gaps by risk, not by line count**

Ordem obrigatória:

1. autenticação, autorização, sessão e recuperação;
2. configuração e seletores de backend;
3. cadastro/perfil, relatórios, tarefas/jornada e chat;
4. upload, notificações, posições, clima e evacuação;
5. estados de tela: loading, vazio, erro e retry;
6. utilitários restantes apontados pelo relatório.

Para cada módulo: escrever um caso falho que cubra uma decisão real, executar somente a suíte, implementar se necessário e executar cobertura novamente. Não criar testes que apenas chamam linhas sem afirmar comportamento.

**Step 3: Enforce all four metrics**

Configurar branches, functions, lines e statements em 80% global nos três projetos somente depois de fechar os gaps. Cada exclusão deve ser explícita e justificada no diff; não remover da inclusão um arquivo que apareceu vermelho no baseline.

**Nota de execução (2026-08-09): o escopo do mobile exclui os providers `.tsx`.**

O `collectCoverageFrom` do mobile lista `services/**/*.ts`, conforme escrito acima. O glob `.ts` não casa com os 10 providers React, que são `.tsx`: eles ficam fora do denominador, e 8 deles não têm teste algum (Auth, Chat, Evacuation, Location, Notification, Reports, Vitals, Weather; só Journey e Profile têm).

Isso foi medido, não estimado. Com o escopo expandido para `services/**/*.{ts,tsx}` e `lib/**/*.{ts,tsx}`, o denominador ganha 128 funções e a cobertura cai de 84,51/81,62/80,56/85,50 para 76,65/77,56/72,00/78,27 (statements/branches/functions/lines). Voltar aos 80% com o escopo expandido custa cerca de 82 funções cobertas, ou seja, várias sessões.

Decisão: manter `services/**/*.ts` para travar o portão agora, e registrar aqui que o número publicado NÃO cobre os providers. Não é uma exclusão nova (o glob nunca os incluiu, então nenhum arquivo vermelho no baseline foi removido), mas é uma limitação real do que "80%" significa neste projeto, e quem ler o relatório da entrega precisa saber disso.

Pendência aberta: cobrir os 8 providers sem teste e expandir o glob. Enquanto não acontecer, o número do mobile mede a árvore de telas, componentes, libs e backends de serviço, não a camada de providers.

**Step 4: Verify and commit per project**

Run: `cd mobile && npm run test:coverage`

Run: `cd swi-admin && npm test -- --coverage`

Run: `cd swi-backend && npm run test:coverage`

Expected: as quatro métricas >= 80% em cada projeto.

Commits:

```bash
git commit -m "test: enforce mobile coverage threshold"
git commit -m "test: enforce admin coverage threshold"
git commit -m "test: enforce backend coverage threshold"
```

### Task 14: Adicionar E2E de navegador para admin e smoke web do mobile

**Files:**
- Modify: `swi-backend/docker-compose.e2e.yml`
- Create: `scripts/e2e/run-test-stack.mjs`
- Create: `scripts/e2e/run-test-stack.test.mjs`
- Modify: `swi-backend/package.json`
- Create: `swi-admin/playwright.config.ts`
- Create: `swi-admin/e2e/auth-dashboard.spec.ts`
- Create: `swi-admin/e2e/chat-tasks.spec.ts`
- Modify: `swi-admin/package.json`
- Modify: `swi-admin/package-lock.json`
- Create: `mobile/playwright.config.ts`
- Create: `mobile/e2e/web-smoke.spec.ts`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

**Step 1: Install deterministic browser tooling**

Adicionar `@playwright/test` como devDependency nos dois projetos e instalar Chromium no ambiente de execução. Configurar `screenshot: 'off'`, `video: 'off'`, `trace: 'off'` por padrão; falhas podem ser investigadas localmente, mas artefatos permanecem ignorados.

Criar um runner raiz que sempre use o project name `swi-source-delivery-e2e`, portas exclusivas (`55432` Postgres, `3300` API, `4173` admin, `8081` mobile), espere health checks, aplique migrations e execute teardown em `finally` com `down -v --remove-orphans`. O teste unitário do runner deve injetar um executor falso e provar que o teardown ocorre também quando Playwright falha.

**Step 2: Write failing admin flows**

Com backend e banco de teste reais, cobrir login, dashboard, criação/edição de tarefa e envio/leitura de chat. Usar dados sem PII real e ids produzidos pelo setup.

Run: `cd swi-admin && npx playwright test e2e/auth-dashboard.spec.ts e2e/chat-tasks.spec.ts`

Expected: FAIL até webServer, seed de teste e seletores acessíveis estarem corretos.

**Step 3: Write failing mobile web smoke**

Cobrir boot, login, redirecionamento autenticado e abertura das rotas principais contra API de teste. Não validar pixel; validar ausência de crash, acessibilidade básica e requisições reais.

Run: `cd mobile && npx playwright test e2e/web-smoke.spec.ts`

Expected: FAIL até o servidor Expo web e configuração de teste estarem conectados.

**Step 4: Make test setup reproducible**

Adicionar `test:e2e:managed` aos três manifests; cada script chama `scripts/e2e/run-test-stack.mjs` com o alvo correspondente. O runner gerencia webServers, banco efêmero e teardown. `swi-backend/docker-compose.e2e.yml` sobrescreve portas/volumes e usa somente credenciais descartáveis de teste. Nunca embutir senha de cliente. Se um fluxo nativo depender de hardware indisponível, manter teste de integração do adaptador, executar `npx expo-doctor` e registrar o smoke manual antes da entrega, sem fingir automação.

**Step 5: Verify and commit**

Run: `cd swi-admin && npm run test:e2e:managed`

Run: `cd mobile && npm run test:e2e:managed`

Expected: PASS, sem screenshots/traces persistidos.

Run: `cd mobile && npx expo-doctor`

Expected: zero problema acionável; incompatibilidades justificadas são resolvidas antes do commit.

```bash
git add scripts/e2e swi-backend/docker-compose.e2e.yml swi-backend/package.json swi-admin/e2e swi-admin/playwright.config.ts swi-admin/package*.json mobile/e2e mobile/playwright.config.ts mobile/package*.json
git commit -m "test: add critical browser smoke coverage"
```

**Nota de execução (2026-08-10): o smoke web do mobile não passa do login, e a causa é de plataforma.**

O Step 3 pede boot, login, redirecionamento autenticado e abertura das rotas principais. Os dois primeiros estão cobertos; os dois últimos são impossíveis no navegador, e isso foi medido, não presumido.

O `expo-secure-store` não tem implementação web: `mobile/node_modules/expo-secure-store/build/ExpoSecureStore.web.js` é `export default {}`. O POST `/auth/login` volta 200 com o token (verificado na rede do navegador e por `curl`), mas o `SecureStore.setItemAsync` seguinte chama um método inexistente e estoura. O `catch` do login manda a mensagem pro `Alert.alert`, que no react-native-web é um método vazio, então a falha não aparece nem no console nem na tela. Sem token guardado não há sessão, e todo o `(app)/*` fica inalcançável.

Nenhum truque de teste contorna isso; só um adaptador web de armazenamento no app, que é mudança de produto e não de higiene. Decisão: o smoke afirma o que o navegador prova de verdade (bundle de produção subindo sem erro de página, guards de rota, o login batendo na API real e sendo aceito, a senha errada sendo recusada com 401, ausência de 5xx) e declara a fronteira no cabeçalho do próprio spec. Quem cobre a fatia autenticada é `mobile/services/auth/apiAuthBackend.test.ts`, no nível do adaptador, mais o smoke manual em aparelho previsto no Step 4 deste plano.

**Nota de execução (2026-08-10): defeito do painel encontrado pelo E2E de chat.**

`openConversation` (`swi-admin/src/services/chat/ChatProvider.tsx`) desiste quando a conversa ainda não está em `conversationsRef`, e num carregamento frio de `/chat/<id>` o efeito de seleção roda antes de o `GET /chat/conversations` responder. Nada o redispara quando a lista chega, então abrir uma conversa por deep link, ou dar F5 dentro dela, mostra a thread vazia mesmo com as mensagens gravadas (confirmado no banco).

Não foi corrigido aqui: é código de produção do painel, fora do escopo desta higienização, e a correção é decisão do usuário. Efeito no teste: o spec `swi-admin/e2e/chat-tasks.spec.ts` não afirma a releitura depois do F5, porque o defeito a torna dependente de timing (numa base com a conversa preexistente a thread às vezes se recupera; numa base limpa, não), e asserção instável num portão de entrega é pior que asserção estreita. No lugar dela, o teste afirma o `201` do `POST /chat/conversations/<id>/messages`, que é a prova de gravação, e deixa o diagnóstico no comentário. Corrigido o defeito, o refresh volta a ser afirmável.

**Nota de execução (2026-08-10): a espera de saúde do runner não podia ser a porta.**

A primeira versão do `run-test-stack.mjs` esperava a porta 55432 aceitar conexão. O Docker atende na porta publicada assim que o container sobe, antes de o Postgres inicializar, então a espera voltava na hora e o `prisma migrate deploy` seguinte morria com `P1001: Can't reach database server`. A sonda agora é `pg_isready` por TCP dentro do container (o mesmo comando do healthcheck do compose), com dois testes unitários cercando o caso.

**Nota de execução (2026-08-10): o smoke do mobile precisa exportar com `--clear`, e o motivo não é zelo.**

Na primeira execução completa da suíte, os três testes que dependem do login falharam em `waitForResponse` (timeout de 30s esperando o POST `/auth/login`) enquanto os três que não fazem login passaram, inclusive o que afirma bundle sem erro de console. A causa foi medida, não deduzida.

O bundle exportado tinha `getApiUrl` reduzido a `return u??=s(void 0, o.RUNTIME_ENV)`: o acesso `process.env.EXPO_PUBLIC_API_URL` virou `void 0`. As três `EXPO_PUBLIC_*` do `webServer` sofreram o mesmo. Com a variável ausente, `resolveApiUrl` lança em produção, o `catch` do login manda a mensagem pro `Alert.alert` (vazio no react-native-web) e nenhuma requisição chega a sair, o que explica exatamente o timeout e o silêncio no console.

Dois experimentos isolaram a causa. Exportar com a variável presente no ambiente do shell, sem `--clear`, continuou produzindo `void 0`, o que descarta falha de propagação do Playwright. O mesmo export com `--clear` embutiu a URL. Ou seja: as `EXPO_PUBLIC_*` são inlineadas em tempo de transformação e o cache do Metro não as considera parte da chave, então um `expo export` anterior sem elas (o `build:all` do `verify` é o candidato óbvio, e roda no mesmo portão) deixa `services/auth/apiConfig.ts` cacheado com o valor já reduzido a `undefined`.

A ausência de `babel.config.js` no projeto apareceu no meio da investigação e é pista falsa: o SDK 54 resolve `babel-preset-expo` sozinho, e o inline funciona quando o cache está limpo. O que confirma é o próprio bundle, que preserva `process.env.NODE_ENV` e elimina só as `EXPO_PUBLIC_*`, ou seja, o inline seletivo está rodando.

O risco que isso cria é pior que a falha: com o cache quente de uma execução ANTERIOR e correta, a suíte passaria medindo um bundle que não corresponde ao código atual. Por isso o `--clear` fica no comando do `webServer`, com o diagnóstico escrito ao lado dele. Custo: o export deixa de aproveitar cache e fica mais lento. Com o `--clear`, os 6 testes passam.

### Task 15: Tornar a CI equivalente aos portões locais

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Add red gates one group at a time**

Atualizar os jobs:

- mobile: Node 20, `npm ci`, `expo-doctor`, lint, typecheck, coverage, export Android/iOS/web e smoke web;
- admin: Node 20, `npm ci`, lint sem warnings, typecheck, coverage, build, Storybook build e E2E;
- backend unit: matriz Node 18 e 22 para lint, typecheck, unit e build;
- backend integration: Node 22, service container PostgreSQL 16, `prisma generate`, `prisma migrate deploy` e todos os E2E;
- security: auditoria de dependências e scanner de segredos do snapshot, com saída mascarada.

Não duplicar E2E de banco na matriz 18/22.

Os jobs Playwright executam `npx playwright install --with-deps chromium`, iniciam o stack E2E isolado, aguardam health checks e sempre fazem teardown. Nenhum job usa containers, redes, volumes ou portas do checkout principal.

**Step 2: Validate workflow syntax locally**

Run: `npx --yes yaml-lint .github/workflows/ci.yml`

Expected: sintaxe válida.

Run todos os comandos dos jobs localmente na mesma ordem.

Expected: PASS.

**Step 3: Review permissions and secrets**

Definir permissões mínimas (`contents: read`), não imprimir env e não usar credenciais de produção. O job de integração usa apenas serviços e segredos descartáveis do runner.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce source delivery quality gates"
```

**Nota de execução (2026-08-10): a CI cobre tudo que a HEAD sustenta; os passos Playwright entram com a Task 14.**

- Os jobs Playwright do Step 1 (E2E do admin e smoke web do mobile) ficaram fora desta rodada, com o porquê comentado no próprio workflow: `mobile/e2e/` ainda não está na HEAD, e a sonda de prontidão do `run-test-stack.mjs` na HEAD é a versão que espera só a porta TCP (o fix `pg_isready` pertence à Task 14). Ligar o E2E na CI agora herdaria a corrida com o `migrate deploy` documentada na nota da Task 14.
- A auditoria de dependências do job security roda visível mas não bloqueante: mobile e backend carregam achados transitivos sem correção publicada (metro/image-size; tar via node-pre-gyp), e um portão duro nasceria vermelho sem ação possível. Endurece quando a Task 16 zerar o que tem conserto.
- O scanner de segredos bloqueia, com `.gitleaks.toml` novo na raiz allowlistando só falso-positivos verificados um a um: artefatos de auditoria do Figma em `docs/` (fora da entrega) e props `key` de JSX das telas de evacuação. Snapshot da HEAD: 76 achados antes da config, 0 depois, nenhum segredo real.
- A favor da equivalência com os portões locais, o job do admin ganhou o `gate:file-size` e a matriz do backend roda `test:coverage` em vez de `test` seco, travando na CI os mesmos thresholds de 80.
- O Step 2 pegou um portão local quebrado: o `test:coverage` do mobile saía exit 1 com os 868 testes verdes, porque árvores da suíte da jornada sobreviviam ao teardown com um interval de 1s armado. Consertado na própria suíte (afterEach desmonta o que o render montou) antes do commit da CI.

### Task 16: Auditar dependências, segredos e resíduos do snapshot

**Files:**
- Modify only when a finding is fixed: `mobile/package*.json`, `swi-admin/package*.json`, `swi-backend/package*.json`, affected source files
- No report file is committed

**Step 1: Scan the current snapshot for secrets**

Executar Gitleaks fixado em versão sobre o snapshot atual, com redaction, escrevendo o relatório fora do repositório:

```powershell
$auditRoot = Join-Path $env:TEMP 'swi-source-audit'
New-Item -ItemType Directory -Force -Path $auditRoot | Out-Null
docker run --rm `
  --mount "type=bind,source=$((Get-Location).Path),target=/repo,readonly" `
  --mount "type=bind,source=$auditRoot,target=/audit" `
  zricethezav/gitleaks:v8.28.0 dir /repo --redact --report-format json --report-path /audit/gitleaks-snapshot.json
```

Confirmar manualmente `.env*`, chaves privadas, tokens AWS/GitHub/Mapbox, JWT, SMTP e PATs. Não colocar o valor encontrado em issue, commit ou resposta.

Expected: zero segredo real. Placeholder óbvio pode ser classificado como falso positivo; segredo real exige parar, revogar/rotacionar e procurar usos semelhantes antes de continuar.

**Step 2: Audit each dependency tree**

Run: `cd mobile && npm audit --omit=dev`

Run: `cd mobile && npm audit`

Repetir em `swi-admin` e `swi-backend`.

Expected: cada achado classificado por severidade, alcance de runtime, caminho transitivo e correção disponível. Não executar `npm audit fix --force`.

**Step 3: Apply safe upgrades one package at a time**

Para correções patch/minor compatíveis, atualizar um grupo coeso, executar o portão completo do projeto e commit separado. Major upgrades viram trabalho explícito se exigirem migração; não esconder risco no pacote de higiene.

**Step 4: Review redistribution metadata**

Gerar fora do repositório um inventário de dependências diretas/transitivas e identificadores de licença a partir dos três lockfiles/instalações. Marcar `UNKNOWN` onde o pacote não declarar licença; confirmar que nenhum pacote ou asset excluído será redistribuído. Obter aprovação do responsável sobre a entrega do código próprio e sobre a simples menção, sem conteúdo, do design system e dos binários.

Expected: nenhuma dependência ou asset de terceiro copiado para o payload; nomes, versões, origem e licença declarada disponíveis para `external-dependencies.txt`.

**Step 5: Scan source residue**

Run:

```powershell
rg -n "TODO|FIXME|HACK|console\.(log|debug)|@ts-ignore|@ts-expect-error|eslint-disable|\bany\b" mobile swi-admin/src swi-backend/src
```

Expected: zero ocorrência injustificada. Comentários de dívida válidos devem referir requisito concreto; supressões devem ter escopo de uma linha e teste que demonstre a fronteira.

**Step 6: Commit only actual fixes**

Exemplo: `git commit -m "chore: remediate reviewed dependency findings"`.

### Task 17: Implementar a política determinística de seleção da entrega

**Files:**
- Create: `scripts/source-delivery/policy.mjs`
- Create: `scripts/source-delivery/policy.test.mjs`

**Step 1: Write failing policy tests**

```js
test('preserva a árvore e acrescenta .txt', () => {
  assert.equal(deliveryPath('mobile/app/index.tsx'), 'data/mobile/app/index.tsx.txt')
  assert.equal(deliveryPath('mobile/NOTICE.txt'), 'data/mobile/NOTICE.txt.txt')
})

test('inclui texto e template de ambiente', () => {
  assert.equal(classify('swi-backend/src/main.ts'), 'payload-text')
  assert.equal(classify('swi-backend/.env.example'), 'payload-text')
  assert.equal(classify('mobile/assets/icon.svg'), 'payload-text')
})

test('exclui valores, legado, documentação e artefatos', () => {
  assert.equal(classify('swi-admin/.env.production'), 'excluded-env')
  assert.equal(classify('swi-backend/amplify/auth/resource.ts'), 'excluded-legacy')
  assert.equal(classify('docs/plans/a.md'), 'excluded-docs')
  assert.equal(classify('mobile/dist/index.html'), 'excluded-build')
})

test('inventaria binário funcional sem transformá-lo', () => {
  assert.equal(classify('mobile/assets/icon.png'), 'binary-inventory')
})

test('recusa caminho absoluto ou traversal', () => {
  assert.throws(() => deliveryPath('../secret.env'))
  assert.throws(() => deliveryPath('C:/secret.env'))
})

test('codifica caracteres reservados somente no caminho do manifesto', () => {
  assert.equal(manifestPath('data/mobile/100%.ts.txt'), 'data/mobile/100%25.ts.txt')
  assert.equal(manifestPath('data/mobile/a\nb.ts.txt'), 'data/mobile/a%0Ab.ts.txt')
})
```

Run: `node --test scripts/source-delivery/policy.test.mjs`

Expected: FAIL porque a política ainda não existe.

**Step 2: Implement explicit allowlists**

Raízes permitidas: `mobile/`, `swi-admin/`, `swi-backend/`. Incluir código, testes, migrations, schemas, manifests, lockfiles, configs textuais e SVG. Incluir `.env.example`; excluir qualquer outro `.env*`. Excluir `docs`, `amplify`, `vendor`, `.git`, `node_modules`, builds, caches, coverage, QA local, screenshots e arquivos temporários.

Arquivos do design system em `vendor/*.tgz` não entram no payload nem são abertos; sua versão é extraída dos `package.json` e registrada como dependência externa.

O mapeamento de nomes é literal e reversível: sempre acrescenta um único sufixo `.txt`, inclusive quando a origem já termina em `.txt`. Normalizar os caminhos para Unicode NFC antes da validação e abortar se dois caminhos colidirem após NFC, normalização POSIX ou comparação case-insensitive; nunca escolher um silenciosamente.

**Step 3: Detect text safely**

Além da extensão permitida, rejeitar NUL e UTF-8 inválido usando `new TextDecoder('utf-8', { fatal: true })`. Normalizar BOM inicial e CRLF/CR para UTF-8 sem BOM e LF. Registrar hash/tamanho de origem e de payload separadamente.

**Step 4: Verify and commit**

Run: `node --test scripts/source-delivery/policy.test.mjs`

Expected: PASS.

```bash
git add scripts/source-delivery/policy.mjs scripts/source-delivery/policy.test.mjs
git commit -m "feat: define source delivery selection policy"
```

### Task 18: Construir o exportador BagIt a partir do commit aprovado

**Files:**
- Create: `scripts/source-delivery/export.mjs`
- Create: `scripts/source-delivery/export.test.mjs`

**Step 1: Write failing exporter tests with a temporary Git fixture**

O fixture deve criar um repositório temporário com texto LF/CRLF, SVG, binário, `.env.production`, `.env.example`, docs, legado e vendor. Testar:

```js
assert.equal(read('data/mobile/app/index.tsx.txt'), normalizedSource)
assert.match(read('manifest-sha256.txt'), /^[a-f0-9]{64}  data\/mobile\/app\/index\.tsx\.txt$/m)
assert.doesNotMatch(allOutputNames, /\.png$|\.tgz$|\.env\.production/)
assert.match(read('external-dependencies.txt'), /@kavicki\/swi-design-system/)
assert.doesNotMatch(read('git-metadata.txt'), /message|author|diff/i)
```

Run: `node --test scripts/source-delivery/export.test.mjs`

Expected: FAIL porque o exportador não existe.

**Step 2: Read a committed snapshot, never the working tree**

- Exigir `git status --porcelain` vazio.
- Resolver `HEAD` e listar blobs com `git ls-tree -r -z --full-tree HEAD`.
- Ler cada blob com argumentos seguros de processo, sem interpolar caminhos em shell.
- Recusar links simbólicos, submódulos e modos Git desconhecidos até haver política explícita.
- Ordenar tudo lexicograficamente por caminho POSIX para saída determinística.
- Validar no exportador, antes de escrever, que não existe colisão exata, Unicode-normalizada ou case-insensitive entre caminhos entregues.
- Criar a saída primeiro em diretório temporário irmão e renomear atomicamente apenas após validação.

**Step 3: Emit only TXT files**

Produzir:

```text
bagit.txt
bag-info.txt
manifest-sha256.txt
tagmanifest-sha256.txt
git-metadata.txt
file-map.tsv.txt
external-dependencies.txt
binary-assets.txt
scope-exclusions.txt
data/mobile/**/<original>.txt
data/swi-admin/**/<original>.txt
data/swi-backend/**/<original>.txt
```

`git-metadata.txt` contém somente commit, data do commit em ISO 8601 UTC e branch aprovada. A data deve vir do commit e ser serializada de modo idêntico em qualquer timezone. `file-map.tsv.txt` contém caminho original, caminho entregue, extensão, modo Git, blob ID, bytes/hash de origem e bytes/hash do payload. `external-dependencies.txt` contém nome, versão, origem e licença declarada; para o design system, apenas referência/versionamento e instrução de obtenção pelo canal autorizado, sem conteúdo. `binary-assets.txt` contém caminho, MIME/extensão, tamanho, SHA-256 e razão da exclusão. `scope-exclusions.txt` lista regras e contagens, sem copiar conteúdo excluído.

**Step 4: Build manifests correctly**

- `manifest-sha256.txt`: todos e somente os payloads em `data/`.
- `tagmanifest-sha256.txt`: todos os arquivos de controle, exceto ele próprio.
- Caminhos relativos com `/`, dois espaços entre hash e caminho, newline LF final.
- Nos manifestos, percent-encode de `%`, CR e LF conforme BagIt; o caminho físico e o `file-map` permanecem reversíveis e o verificador deve decodificar antes de localizar o arquivo.
- `bagit.txt`: `BagIt-Version: 1.0` e `Tag-File-Character-Encoding: UTF-8`.
- `bag-info.txt`: somente `Bag-Software-Agent`, `External-Identifier` baseado no commit e `Payload-Oxum`; nenhum dado pessoal e nenhuma data variável de execução. Ele é UTF-8 sem BOM, termina com LF e aparece obrigatoriamente no tagmanifest.

**Step 5: Verify determinism and commit**

Executar o exportador duas vezes no mesmo fixture e comparar a árvore byte a byte.

Run: `node --test scripts/source-delivery/export.test.mjs`

Expected: PASS.

```bash
git add scripts/source-delivery/export.mjs scripts/source-delivery/export.test.mjs
git commit -m "feat: export committed source as bagit text"
```

### Task 19: Construir o verificador independente da entrega

**Files:**
- Create: `scripts/source-delivery/verify.mjs`
- Create: `scripts/source-delivery/verify.test.mjs`

**Step 1: Write failing tamper tests**

```js
test('aceita pacote íntegro', () => assert.doesNotThrow(() => verifyBag(path)))
test('detecta payload alterado', () => {
  appendFileSync(payload, 'x')
  assert.throws(() => verifyBag(path), /hash/)
})
test('detecta arquivo não TXT', () => {
  writeFileSync(join(path, 'data', 'rogue.png'), Buffer.from([0]))
  assert.throws(() => verifyBag(path), /somente \.txt/)
})
test('detecta payload não mapeado', () => assert.throws(() => verifyBag(path), /file-map/))
```

Run: `node --test scripts/source-delivery/verify.test.mjs`

Expected: FAIL porque o verificador ainda não existe.

**Step 2: Implement independent checks**

O verificador não importa funções internas do exportador, apenas utilitários criptográficos neutros. Validar:

- presença e conteúdo de `bagit.txt`;
- UTF-8 válido, sem BOM, LF e newline final em todos os arquivos;
- extensão `.txt` para todos os arquivos regulares;
- ausência de caminho absoluto, `..`, `\` e duplicata case-insensitive;
- hashes e cobertura completa dos dois manifestos;
- percent-encoding canônico de `%`, CR e LF nos caminhos de manifesto, sem dupla codificação;
- correspondência 1:1 entre payload e `file-map.tsv.txt`;
- cobertura exata entre todo blob classificado como `binary-inventory` no snapshot e uma única linha de `binary-assets.txt`; ausência, duplicata ou linha excedente falha;
- ausência das classes excluídas;
- metadados Git sem histórico, mensagem, autor, diff ou patch;
- nenhuma ocorrência de padrões de segredo configurados.

**Step 3: Verify and commit**

Run: `node --test scripts/source-delivery/*.test.mjs`

Expected: todas as suítes PASS, inclusive adulteração detectada.

```bash
git add scripts/source-delivery/verify.mjs scripts/source-delivery/verify.test.mjs
git commit -m "test: validate bagit source deliveries"
```

**Nota de execução (2026-08-10): sem BagIt, a referência de integridade passa a ser o commit.**

Os Steps 1 e 2 acima descrevem um verificador de BagIt: `bagit.txt`, os dois manifestos, `file-map.tsv.txt`, `binary-assets.txt`, percent-encoding e metadados Git. Nada disso existe no pacote. A decisão do responsável em 2026-08-10, registrada no cabeçalho do `export.mjs`, foi entregar somente o código: o contrato pede o código-fonte, e o cliente vai ler o material numa IA para avaliar qualidade, não auditar um pacote arquivístico. O exportador da Task 18 já foi escrito assim, e por isso o commit dela é `feat: export committed source as delivery text`, não `as bagit text`.

Some o manifesto, some a prova de integridade que vivia dentro do pacote. A substituição é o próprio commit: o verificador relê cada blob do snapshot aprovado e compara com o payload. Na prática ele ficou mais forte que o manifesto, porque manifesto só prova que o pacote é consistente consigo mesmo, enquanto isto prova que ele é consistente com o código aprovado. O custo é a dependência do repositório, que é aceitável porque quem valida antes de entregar é quem tem o repositório.

O que o verificador afirma, então: todo arquivo sob `data/` e terminando em `.txt`; nenhum caminho absoluto, com `..`, com `\` ou que colida sem distinção de caixa; todo payload em UTF-8 válido, sem BOM e sem CR; correspondência exata nos dois sentidos com os blobs que a política classifica como `payload-text`, o que cobre de uma vez as classes excluídas (um `.env` de valor ou um `.md` no pacote aparece como "sobrando"); conteúdo idêntico ao blob normalizado; e nenhum padrão de segredo de alto sinal.

Duas decisões de desenho que o Step 2 original não previa:

A independência é parcial, e de propósito. A normalização de texto é reimplementada no verificador, para que um erro nela apareça como divergência em vez de se cancelar dos dois lados. Já `classify` vem de `policy.mjs`: a política é a especificação do que a entrega contém, não um detalhe do exportador, e duplicá-la criaria duas listas para manter, com a cópia errada virando gabarito.

A checagem de colisão é exercitada como função pura, não gravando o par no disco. Em NTFS e APFS o segundo arquivo não é criado, ele sobrescreve o primeiro, então o cenário que o verificador precisa pegar só existe depois que o pacote atravessa um sistema de arquivo sensível a caixa, que é justamente onde ele não seria produzido nesta máquina.

Validado além do fixture: exportado o HEAD para um clone descartável e conferido o pacote real, 766 arquivos, exit 0. Adulterando `schema.prisma.txt` no pacote real, o verificador nomeia o arquivo e sai com exit 1.

### Task 20: Executar a verificação integral e revisão final do código

**Files:**
- Modify only for findings proven by the gates
- Do not create committed QA reports

**Step 1: Verify clean installations**

Em cada projeto, remover somente o `node_modules` e o build da worktree após confirmar os caminhos absolutos, executar `npm ci` e todos os gates. Não tocar no checkout principal.

Run:

```powershell
cd mobile; npm ci; npx expo-doctor; npm run lint; npm run typecheck; npm run test:coverage; npm run build:all; npm run test:e2e:managed
cd ..\swi-admin; npm ci; npm run lint; npm run typecheck; npm test -- --coverage; npm run build; npm run storybook:build; npm run test:e2e:managed
cd ..\swi-backend; npm ci; npm run prisma:generate; npm run lint; npm run typecheck; npm run test:coverage; npm run build; npm run test:e2e:managed
```

Expected: todos PASS, cobertura >= 80%, zero warning aceito.

**Step 2: Review the complete diff**

Usar revisões especializadas de qualidade e segurança sobre `git diff 42141fa...HEAD`. Corrigir CRITICAL e HIGH antes de avançar; MEDIUM deve ser resolvido ou explicitamente aceito pelo responsável. Reexecutar os testes afetados após cada correção.

**Step 3: Confirm repository hygiene**

Run: `git diff --check 42141fa...HEAD`

Run: `git status --short --branch`

Run: `git -C C:\Users\Gabriel\Documents\SWI-mobile status --short --branch`

Expected: diff sem whitespace inválido; worktree limpa depois dos commits; checkout principal ainda em `main` e limpo.

**Step 4: Create the final hygiene checkpoint**

Se houve correções de revisão, commitá-las por assunto. Não criar commit vazio e não fazer squash antes da aprovação.

### Task 21: Gerar, validar e inspecionar o pacote TXT final

**Files:**
- Output outside repository: `C:\Users\Gabriel\Documents\SWI-source-delivery-<commit-curto>\`
- No repository file is modified

**Step 1: Obtain explicit generation approval**

Apresentar: commit candidato, gates, cobertura, auditoria, exclusões e diffstat. Só executar a geração após autorização expressa.

**Step 2: Export atomically**

Run:

```powershell
$commit = git rev-parse --short=12 HEAD
$out = "C:\Users\Gabriel\Documents\SWI-source-delivery-$commit"
node scripts/source-delivery/export.mjs --commit HEAD --output $out
```

Expected: uma pasta nova fora do repositório; o exportador recusa sobrescrever destino existente.

**Step 3: Validate independently**

Run: `node scripts/source-delivery/verify.mjs --input $out`

Expected: PASS com contagem de payloads, binários inventariados e hashes validados.

Run:

```powershell
$bad = Get-ChildItem -LiteralPath $out -Recurse -File | Where-Object Extension -ne '.txt'
if ($bad) { throw "Arquivo não TXT encontrado: $($bad.FullName -join ', ')" }
```

Expected: nenhum arquivo não TXT.

**Step 4: Reconstruct a sample**

Selecionar ao menos um arquivo de cada projeto, remover apenas o sufixo final `.txt`, normalizar o blob do commit com as mesmas regras UTF-8 sem BOM/LF usadas pelo exportador e comparar com o payload. Verificar manualmente um SVG, migration SQL, arquivo TSX e lockfile.

Expected: conteúdo normalizado e hashes de payload idênticos; caminho recuperado exatamente pelo `file-map.tsv.txt`.

**Step 5: Inspect control files**

Confirmar:

- nenhum commit anterior, mensagem, diff ou autor;
- nenhum `.env` real ou segredo;
- nenhum conteúdo de documentação, Amplify, QA local, build, cache ou design system;
- versões externas do design system corretas para mobile e admin;
- inventário binário completo, sem Base64;
- `bag-info.txt` sem dados pessoais desnecessários.

**Step 6: Obtain delivery approval**

Entregar ao cliente somente após aprovação final. A pasta gerada é descartável e pode ser recriada do commit; a branch permanece isolada até decisão posterior de merge, push ou descarte.

## Checklist final de aceite

- [ ] Checkout principal permaneceu limpo durante todo o processo.
- [ ] Mobile: lint, typecheck, unit/integration, coverage, build web e smoke PASS.
- [ ] Admin: lint sem warnings, typecheck, unit/integration, coverage, build, Storybook e E2E PASS.
- [ ] Backend: lint, typecheck, unit, coverage, build e todos os E2E PASS.
- [ ] Cobertura global >= 80% nas quatro métricas por projeto.
- [ ] API real é o padrão de produção; mocks/simuladores exigem ativação dev/teste, com exceção dos vitais de saúde, que permanecem simulados por decisão de produto.
- [ ] Nenhuma referência ou diretório Amplify no snapshot final.
- [ ] Nenhum segredo; achados de dependências revisados e tratados.
- [ ] Arquivos de produção abaixo de 800 linhas e sem supressões injustificadas.
- [ ] CI representa os mesmos portões locais.
- [ ] Commit final aprovado e worktree limpa.
- [ ] BagIt 1.0 passa no verificador independente.
- [ ] Todos os arquivos entregues terminam em `.txt`.
- [ ] Manifestos SHA-256, mapa 1:1 e reconstrução de amostra conferidos.
- [ ] Histórico Git, documentação, binários, artefatos de QA, builds, caches e design system ausentes do payload.
- [ ] Autorização expressa obtida antes da entrega ao cliente.
