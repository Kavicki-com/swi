# Mobile Font Audit — Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Executar a pipeline de auditoria de fontes do app mobile e produzir um único relatório `docs/audits/mobile/2026-05-20-font-audit.md` listando todos os erros (loading + per-tela) com severidade e fix recomendado — sem aplicar nenhuma correção.

**Architecture:** Pipeline de 4 fases sequenciais (Setup → Root-cause → Per-screen sweep → Consolidação). Phase 3 é um loop sobre ~35 telas mobile mapeadas para frames do Figma. Cada finding é registrado incrementalmente no relatório em construção, evitando perda de progresso entre fases.

**Tech Stack:** Read/Glob/Grep (filesystem), Figma MCP (`get_metadata`, `get_design_context`, fallback `get_variable_defs`), Write/Edit (relatório markdown).

**Design doc:** `docs/plans/2026-05-20-mobile-font-audit-design.md` (referência canônica para método, tabela Figma→DS variant, escopo, e não-objetivos).

**Commit policy:** Usuário aprova cada commit explicitamente (memória: `feedback_commit_only_when_approved`). Os checkpoints abaixo são pontos sugeridos — **não commitar sem luz verde**.

---

## Phase 0 — Setup

### Task 0.1: Criar diretório e skeleton do relatório

**Files:**
- Create: `docs/audits/mobile/2026-05-20-font-audit.md`

**Step 1: Verificar se `docs/audits/mobile/` existe**

Run: `ls C:/Users/Gabriel/Documents/SWI/docs/audits/`
Expected: pode existir só `mobile/_master-ds-audit.md` e `_ds-gap-log.md` (memória referencia). Se não existir, é criado pelo `Write`.

**Step 2: Gravar skeleton do relatório**

Conteúdo inicial:

```markdown
# Mobile Font Audit — 2026-05-20

**Escopo:** mobile only. Design doc: `docs/plans/2026-05-20-mobile-font-audit-design.md`.

## 1. Sumário executivo
_TBD — preenchido por último (Phase 4)._

## 2. Root cause — loading layer
_TBD — Phase 2._

## 3. Mapeamento rota → Figma
_TBD — Phase 1._

## 4. Findings per-tela
_TBD — Phase 3._

## 5. Findings cross-cutting
_TBD — Phase 4._

## 6. Gaps no DS
_TBD — Phase 4._

## 7. Ordem de correção sugerida
_TBD — Phase 4._

## 8. Lacunas / checks manuais
_TBD — Phase 4._
```

**Step 3 (checkpoint de commit — só com luz verde):**

```
git add docs/audits/mobile/2026-05-20-font-audit.md
git commit -m "audit(mobile): skeleton de relatório de fontes"
```

---

## Phase 1 — Mapeamento rota → Figma nodeId

### Task 1.1: Listar rotas do app

**Step 1: Glob das rotas**

Run: `Glob app/**/*.tsx` (já sabemos do design: 47 arquivos).

**Step 2: Classificar**

- **Layouts** (`_layout.tsx`) → fora do escopo (não renderizam UI textual própria).
- **Sistema** (`+not-found.tsx`, `index.tsx` que só redireciona) → marcar como "sem ground truth Figma".
- **Telas reais** → entram no mapeamento.

Saída: lista de rotas reais (~37–40 esperadas).

### Task 1.2: Puxar metadata do canvas Mobile do Figma

**Step 1: Chamar Figma MCP**

```
mcp__claude_ai_Figma__get_metadata({
  fileKey: "bzDUuPdSiKgl5xucBH0IYE",
  nodeId: "138:5997",
  clientFrameworks: "react-native",
  clientLanguages: "typescript"
})
```

Expected: lista de ~35 frames com `nodeId` e `name`.

**Step 2: Capturar resposta**

Guardar a lista de frames (id, nome) — material bruto para o mapeamento manual da Task 1.3.

### Task 1.3: Construir tabela rota → nodeId

**Step 1: Match heurístico por nome**

Para cada rota da Task 1.1, procurar frame de mesmo nome ou nome próximo no Figma (ex: `login.tsx` ↔ frame "Login", `dashboard.tsx` ↔ "Dashboard", `smartband/pairing.tsx` ↔ "Smartband — pairing"). Tolerar variações de capitalização, hífen vs espaço, prefixos numerados.

**Step 2: Marcar gaps**

Rotas sem frame Figma encontrado → status "manual review" (não bloqueia Phase 3, mas é registrado em §8 do relatório).

Frames Figma sem rota correspondente → também notar (pode indicar tela faltando no código).

**Step 3: Atualizar §3 do relatório**

Edit em `docs/audits/mobile/2026-05-20-font-audit.md` substituindo `_TBD — Phase 1._` por:

```markdown
## 3. Mapeamento rota → Figma

| Rota | Arquivo | nodeId Figma | Nome no Figma | Status |
|---|---|---|---|---|
| /(auth)/login | app/(auth)/login.tsx | NN:NNNN | Login | ok |
| ... | ... | ... | ... | ... |

**Rotas sem ground truth Figma:** _lista_
**Frames Figma sem rota:** _lista_
```

### Task 1.4 (checkpoint de commit — só com luz verde):

```
git add docs/audits/mobile/2026-05-20-font-audit.md
git commit -m "audit(mobile): preenche §3 — mapeamento rota → Figma"
```

---

## Phase 2 — Root-cause audit (loading layer)

### Task 2.1: Confirmar estado da camada de loading

**Step 1: Read `app/_layout.tsx`**

Confirmar: nenhuma chamada de `useFonts` / `loadAsync` / `expo-font`. (Já confirmado na sessão de brainstorming, mas reconfirmar para o relatório.)

**Step 2: Confirmar ausência de `assets/fonts/`**

Run: `Glob assets/fonts/**/*` → expected: 0 resultados.

**Step 3: Capturar versões em `package.json`**

Read `package.json`. Capturar versões de:
- `expo-font` (atualmente `~14.0.11`)
- `expo-splash-screen` (atualmente `~31.0.13`) — relevante porque a prática Expo é segurar splash até as fontes carregarem.

### Task 2.2: Confirmar expectativas do DS

**Step 1: Read `node_modules/@kavicki/swi-design-system/src/tokens/typography.ts`**

Capturar:
- `fontFamily.title = 'Montserrat'`
- `fontFamily.body = 'Inter'`
- `fontWeight`: 300 / 400 / 500 / 700
- Cobertura por variante (title só usa 700; body/subtitle/caption usam 400/500/700 conforme tabela do design doc).

### Task 2.3: Preencher §2 do relatório

Edit substituindo `_TBD — Phase 2._`. Conteúdo esperado:

```markdown
## 2. Root cause — loading layer

**Estado atual:**
- `mobile/app/_layout.tsx` não chama `useFonts` (verificado L1-L19).
- `mobile/assets/fonts/` não existe; nenhum `.ttf` no repositório.
- `expo-font@~14.0.11` instalado em `package.json` mas nunca importado.

**Expectativa do DS** (`@kavicki/swi-design-system/src/tokens/typography.ts:9-19`):
- `fontFamily.title = 'Montserrat'`
- `fontFamily.body = 'Inter'`
- Weights: 300 (light), 400 (regular), 500 (medium), 700 (bold)
- Uso real: Montserrat 700 (titles); Inter 400/500/700 (body/subtitle/caption).

**Impacto:**
- RN não encontra nenhuma família registrada → fallback para a fonte do sistema (San Francisco no iOS, Roboto no Android, sans-serif no Web).
- 100% das telas do mobile renderizam com fonte errada, independentemente de o código consumir os tokens corretamente.

**Fix recomendado (alto nível):**
1. Adicionar `.ttf` em `mobile/assets/fonts/` (Montserrat-Bold; Inter-Light/Regular/Medium/Bold).
2. Carregar via `useFonts` em `app/_layout.tsx`, segurando o splash com `expo-splash-screen` até `fontsLoaded`.
3. Garantir que as family keys passadas para `useFonts` batem exatamente com `'Montserrat'` e `'Inter'` (case-sensitive).

Detalhe (paths, snippets) fica para a rodada subsequente de `writing-plans` (plano de correção).
```

### Task 2.4 (checkpoint de commit — só com luz verde):

```
git add docs/audits/mobile/2026-05-20-font-audit.md
git commit -m "audit(mobile): preenche §2 — root cause loading"
```

---

## Phase 3 — Sweep per-tela (loop)

**Iterar sobre cada rota com `Status = ok` da tabela §3.** Para cada uma, executar Tasks 3.A → 3.E. Depois de cada bloco de 5 telas, fazer commit checkpoint (só com luz verde).

### Task 3.A: Leitura do código da tela

**Step 1: Read `app/<rota>.tsx`**

**Step 2: Catalogar cada elemento textual**

Para cada `<Text ...>...</Text>` (ou similar) no JSX:
- Linha do arquivo (`file:line`).
- Origem do componente `Text` (import path).
- Prop `variant` (valor textual ou ausente).
- Style overrides relevantes:
  - inline `style={{ fontFamily, fontWeight, fontSize }}`
  - StyleSheet ref que contenha `fontXxx`
  - `style={[a, b]}` arrays — analisar cada item.

**Step 3: Registrar provisoriamente**

Capturar lista interna `code_texts = [{ line, source, variant, overrides }]` para uso no diff (Task 3.D).

### Task 3.B: Ground truth Figma da tela

**Step 1: Chamar `get_design_context`**

```
mcp__claude_ai_Figma__get_design_context({
  fileKey: "bzDUuPdSiKgl5xucBH0IYE",
  nodeId: "<nodeId da tela>",
  clientFrameworks: "react-native",
  clientLanguages: "typescript"
})
```

**Step 2: Extrair specs de tipografia**

Para cada nó textual visível: triplet `(fontFamily, fontWeight, fontSize)`.

**Step 3: Fallback se necessário**

Se a resposta de `get_design_context` vier como código gerado (em vez de specs brutos) e ofuscar os triplets:
- Tentar `get_variable_defs` no mesmo nodeId.
- Tentar `get_metadata` no nodeId, pegando recursivamente nós com `type: TEXT`.

Capturar lista interna `figma_texts = [{ content_excerpt, fontFamily, fontWeight, fontSize }]`.

### Task 3.C: Tradução Figma → variante DS

Para cada `figma_texts[i]`, aplicar a tabela (referência: design doc §3 Phase 3 Passo 3):

| Figma triplet | → variante DS |
|---|---|
| Montserrat / 700 / 32 | `title.l` |
| Montserrat / 700 / 24 | `title.m` |
| Montserrat / 700 / 20 | `title.s` |
| Montserrat / 700 / 16 | `title.xs` |
| Inter / 500 / 24 | `subtitle.l` |
| Inter / 500 / 16 | `subtitle.m` |
| Inter / 500 / 12 | `subtitle.s` / `body.s` / `caption.s` (desambiguar por contexto) |
| Inter / 500 / 20 | `body.l` |
| Inter / 400 / 14 | `body.m` |
| Inter / 700 / 8 | `caption.xs` |

Triplet fora da tabela → marcar como **gap no DS** (entra em §6 do relatório).

Coincidência de 3 variantes → preferir `subtitle.s` se elemento é label/subtítulo de seção; `caption.s` se é metadado/legenda; `body.s` se é texto corrido pequeno. Quando ambíguo, status = "manual review".

### Task 3.D: Diff e classificação de findings

Cruzar `code_texts` × `figma_texts` (match por posição/conteúdo onde possível). Cada finding pertence a um destes tipos:

| Tipo | Descrição | Severidade |
|---|---|---|
| (a) | `Text` vem de `react-native` em vez do DS | alta |
| (b) | `Text` do DS sem `variant` | média |
| (c) | `variant` errada (esperava X, código tem Y) | alta |
| (d) | Override inline de `fontFamily`/`fontWeight`/`fontSize` | média |
| (e) | Figma usa triplet inexistente no DS (gap) | alta |
| (f) | Texto faltando no código ou sobrando vs Figma | alta |

### Task 3.E: Appendar findings da tela ao §4 do relatório

Edit em `docs/audits/mobile/2026-05-20-font-audit.md`, dentro de §4, adicionar bloco:

```markdown
### 4.N. <Nome da tela> (`app/<path>.tsx`)

**Figma:** [link com node-id](https://www.figma.com/design/bzDUuPdSiKgl5xucBH0IYE/SWI---UI?node-id=<nodeId>)

| file:line | tipo | esperado | encontrado | severidade |
|---|---|---|---|---|
| app/...:42 | (c) | `title.l` | `title.m` | alta |
| ... | ... | ... | ... | ... |

**Notas:** _opcional — desambiguações, decisões de "manual review", etc._
```

### Task 3.F (checkpoint a cada 5 telas — só com luz verde):

```
git add docs/audits/mobile/2026-05-20-font-audit.md
git commit -m "audit(mobile): findings telas N..N+4"
```

---

## Phase 4 — Consolidação

### Task 4.1: Agregação cross-cutting (§5)

**Step 1: Releer §4** do relatório.

**Step 2: Identificar padrões repetidos**

Critério: um mesmo finding de tipo (a)/(b)/(c)/(d) aparece em ≥3 telas → vira finding de §5 com contagem.

Exemplos esperados:
- "N telas usam `Text` de RN sem `variant`" — finding (a)+(b).
- "M telas têm override inline de `fontWeight` em headings" — finding (d).

**Step 3: Edit §5** substituindo `_TBD — Phase 4._`.

### Task 4.2: Gaps no DS (§6)

**Step 1: Filtrar findings de tipo (e)** do §4.

**Step 2: Deduplicar** por triplet `(fontFamily, fontWeight, fontSize)`.

**Step 3: Edit §6** com tabela de triplets faltando + lista de telas que pedem cada um + candidato a nome de variante.

### Task 4.3: Ordem de correção (§7)

Edit §7 com a sequência fixa:

```markdown
## 7. Ordem de correção sugerida

1. **Loading layer** (§2) — resolve 100% do impacto visual percebido com 1 mudança.
2. **Cross-cutting** (§5) — alto leverage, mesma alteração propaga por muitas telas.
3. **Per-tela**, em ordem de tráfego/visibilidade:
   1. Dashboard (`app/(app)/dashboard.tsx`)
   2. Auth (`(auth)/login`, `sign-up`, `password-recovery`, `account-confirmation`)
   3. Onboarding (`(onboarding)/smartband/*`)
   4. Resto.
4. **Gaps DS** (§6) — bloqueado por bump no `swi-design-system` (PR + retag); só corrigir telas afetadas depois que o bump existir.
```

### Task 4.4: Lacunas / manual review (§8)

Edit §8 listando:
- Rotas sem frame Figma (da Task 1.3).
- Frames Figma sem rota (idem).
- Findings que ficaram como "manual review" no §4 (ex: ambiguidade `subtitle.s`/`body.s`/`caption.s`).
- Qualquer chamada Figma que tenha falhado.

### Task 4.5: Sumário executivo (§1)

**Por último**, depois que as outras seções estiverem fechadas. Conteúdo:

```markdown
## 1. Sumário executivo

- **Total de findings:** N (alta: X, média: Y).
- **Root cause:** ausência de carregamento de fontes no host Expo causa fallback de sistema em 100% das telas (§2).
- **Top 3 padrões recorrentes** (de §5):
  1. ...
  2. ...
  3. ...
- **Gaps no DS:** K triplets de tipografia exigidos pelo Figma e não cobertos pelo DS (§6).
- **Ordem de correção:** loading → cross-cutting → per-tela → gaps DS (§7).
```

### Task 4.6 (checkpoint final — só com luz verde):

```
git add docs/audits/mobile/2026-05-20-font-audit.md
git commit -m "audit(mobile): relatório completo — root cause + sweep + consolidação"
```

---

## Verificação de pronto

Critérios para considerar a auditoria concluída (antes de pedir aprovação do usuário):

- [ ] §1–§8 todos preenchidos (nenhum `_TBD_` remanescente).
- [ ] §3 contém mapeamento completo (toda rota classificada como `ok` ou `manual review`).
- [ ] §4 contém uma subseção por rota `ok` em §3.
- [ ] §5 tem ≥1 padrão consolidado OU explicação de por que não houve padrão recorrente.
- [ ] §6 lista gaps OU declara "nenhum gap detectado".
- [ ] Total de findings em §1 confere com somatório de §4.

Se algum item falhar, voltar à fase responsável.

---

## Riscos durante a execução (lembretes operacionais)

- **Rate limit do Figma MCP:** se erros 429/timeout aparecerem, esperar e retomar — não pular telas; cada uma é importante para o "varredura completa" do usuário.
- **`get_design_context` vier como código gerado:** acionar fallback (Task 3.B Step 3) antes de marcar a tela como "manual review".
- **Coincidência de triplet Inter/500/12:** desambiguação por contexto — quando ambíguo, sempre registrar como "manual review" no §8, nunca chutar.
- **Componentes do DS embutidos (Button, Card, etc):** tipografia interna é responsabilidade do DS; ignorar nesse sweep. Só contar texto direto da tela.

---

## Não-objetivos (lembretes)

- Não aplicar nenhum fix nesta sessão.
- Não modificar o DS.
- Não cobrir `swi-admin`.
- Não rodar visual diff automatizado (Playwright contra screenshot Figma).
- Não commitar sem aprovação explícita do usuário.
