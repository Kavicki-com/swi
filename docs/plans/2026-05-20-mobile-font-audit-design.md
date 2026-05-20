# Mobile font audit — design doc

**Data:** 2026-05-20
**Autor:** Gabriel + Claude (brainstorming session)
**Status:** Design aprovado, aguardando `writing-plans` para detalhar execução
**Próximo passo:** invocar skill `writing-plans` para destrinchar a pipeline de execução

---

## Contexto

QA reportou verbalmente que "as fontes estão erradas em praticamente todas as telas" do app mobile. Não há lista escrita do QA — esta auditoria deriva a lista do zero comparando código vs Figma.

Investigação preliminar nesta sessão confirmou um **smoking gun** que explica o feedback "todas as telas":

- `mobile/app/_layout.tsx` **não chama `useFonts`** do `expo-font`.
- `mobile/assets/fonts/` não existe; não há `.ttf` no repositório.
- `expo-font` está em `package.json` mas nunca é importado em nenhum arquivo do app.
- O DS declara `fontFamily.title = 'Montserrat'` e `fontFamily.body = 'Inter'` em `node_modules/@kavicki/swi-design-system/src/tokens/typography.ts:10-11` mas **não carrega as fontes** — é responsabilidade do host.

Conclusão: RN cai para a fonte do sistema (San Francisco no iOS, Roboto no Android, sans-serif no Web) em **toda** tela. A memória `feedback_token_consumption.md` já alertava sobre exatamente este modo de falha (caveat de fonte no mobile).

Existe risco de, depois de corrigir o loading, ainda sobrarem erros estruturais no código (variantes erradas, overrides hardcoded, uso de `Text` de RN em vez do DS). A auditoria cobre as **duas camadas**.

---

## Escopo

**Dentro:**
- Mobile only (`mobile/app/**/*.tsx`, ~47 rotas mapeadas).
- Camada de loading (host).
- Camada de uso (código por tela vs Figma).

**Fora:**
- `swi-admin/` (web) — auditoria separada se necessário.
- Componentes do DS embutidos em telas (responsabilidade do repositório do DS).
- Correção dos erros — esta auditoria produz apenas o relatório; o plano de correção será uma rodada subsequente de `writing-plans`.

---

## Entregável

**Arquivo único:** `docs/audits/mobile/2026-05-20-font-audit.md`

Estrutura:

```
# Mobile Font Audit — 2026-05-20

## 1. Sumário executivo
- N findings totais, breakdown por severidade
- Root cause em uma linha
- Top 3 padrões recorrentes

## 2. Root cause — loading layer
- Estado atual e por que toda tela renderiza errada
- O que o DS espera (Inter 300/400/500/700 + Montserrat 700)
- Fix recomendado (detalhado no writing-plans subsequente)

## 3. Mapeamento rota → Figma
Tabela: rota | arquivo | nodeId Figma | nome no Figma

## 4. Findings per-tela
Uma seção por rota. Cada uma: link Figma, tabela
(linha | tipo | esperado | encontrado | severidade), notas.

## 5. Findings cross-cutting
Padrões repetidos consolidados.

## 6. Gaps no DS
Triplets de tipografia que o Figma exige e o DS não tem.

## 7. Ordem de correção sugerida
1. Loading
2. Cross-cutting
3. Per-tela (dashboard → auth → onboarding → resto)
4. Gaps DS (depende de bump)

## 8. Lacunas / checks manuais
Rotas sem Figma frame óbvio, ambiguidades de variante, etc.
```

---

## Pipeline (4 estágios)

### 1. Setup do mapeamento

- `get_metadata` no canvas Mobile (`fileKey=bzDUuPdSiKgl5xucBH0IYE`, `nodeId=138:5997`) → lista ~35 frames com `nodeId` e nome.
- Cruzar com `mobile/app/**/*.tsx` (47 rotas) e produzir tabela `rota → nodeId`.
- Rotas sem frame Figma óbvio (`+not-found.tsx`, layouts, modais sem design) ficam marcadas como "sem ground truth — manual review".

### 2. Auditoria root-cause (loading layer)

Não-por-tela. Verifica:

- `mobile/app/_layout.tsx` — chama `useFonts`? Carrega que famílias / weights?
- `mobile/assets/fonts/` — existem `.ttf`? Quais?
- `mobile/package.json` — versões de `expo-font`, `expo-splash-screen` (para gating).
- `node_modules/@kavicki/swi-design-system/src/tokens/typography.ts` — quais famílias e weights o DS espera.

Saída: diagnóstico fechado da camada de loading e fix recomendado (alto nível; detalhe vai pro plano de correção).

### 3. Sweep per-tela

Para cada rota mapeada, ciclo determinístico:

**Passo 1 — Leitura do código.** `Read` no `.tsx`. Catalogar cada elemento textual:

- Origem do `Text`: `@kavicki/swi-design-system` (ok) vs `react-native` (bug).
- Prop `variant` presente? Qual valor?
- Override inline de `fontFamily`/`fontWeight`/`fontSize` (proibido pelo padrão de tokens do projeto).
- Estilos via `StyleSheet.create({ ... fontXxx ... })` (idem).

**Passo 2 — Ground truth Figma.** `get_design_context` no `nodeId`, com `clientFrameworks: 'react-native'` e `clientLanguages: 'typescript'`. Extrair `(fontFamily, fontWeight, fontSize)` de cada nó textual visível.

**Passo 3 — Tradução Figma → variante DS.** Tabela (derivada de `typography.ts`):

| Figma (family / weight / size) | Variante DS |
| --- | --- |
| Montserrat / 700 / 32 | `title.l` |
| Montserrat / 700 / 24 | `title.m` |
| Montserrat / 700 / 20 | `title.s` |
| Montserrat / 700 / 16 | `title.xs` |
| Inter / 500 / 24 | `subtitle.l` |
| Inter / 500 / 16 | `subtitle.m` |
| Inter / 500 / 12 | `subtitle.s` ⚠ colide |
| Inter / 500 / 20 | `body.l` |
| Inter / 400 / 14 | `body.m` |
| Inter / 500 / 12 | `body.s` ⚠ colide |
| Inter / 500 / 12 | `caption.s` ⚠ colide |
| Inter / 700 / 8 | `caption.xs` |

Triplet fora da tabela = gap real no DS (candidato a bump).

Coincidências de triplet (`subtitle.s` / `body.s` / `caption.s` todas Inter/500/12) só são desambiguáveis por contexto. Quando não der, registra como "manual review".

**Passo 4 — Diff.** Confronta cada texto do Figma com o correspondente no código:

- (a) `Text` de RN em vez do DS;
- (b) Sem `variant` no `Text` do DS;
- (c) `variant` errada (esperava `title.l`, código tem `title.m`);
- (d) Override inline de family/weight/size;
- (e) Figma usa triplet inexistente no DS (gap);
- (f) Texto faltando ou sobrando.

**Passo 5 — Registro.** Cada finding entra na tabela com `route | file:line | nodeId | tipo (a-f) | esperado | encontrado | severidade`.

Severidade: **alta** (a, c, e, f), **média** (b, d).

### 4. Consolidação

Agrega per-tela em cross-cutting, classifica severidade, recomenda ordem de fix.

---

## Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| Rate limit do Figma MCP nas ~35 chamadas | Execução serial com retry suave; aceitar ordem parcial |
| Drift entre nome de rota e frame Figma | Tabela de mapeamento (seção 3) é fonte de verdade explícita; usuário revisa antes do sweep |
| Telas pesadas com DS (Dashboard) — pouco texto direto | Ignorar texto interno de componentes do DS; só o que a tela renderiza diretamente |
| Coincidência `subtitle.s` / `body.s` / `caption.s` | Desambiguar por contexto; quando impossível, registrar como manual review |
| `get_design_context` retorna código gerado em vez de specs brutos | Fallback para `get_variable_defs` ou `get_metadata` no frame |
| Rotas com texto dinâmico (mocks) | Comparar só estilo, não conteúdo |

---

## Sequência de execução

1. **(esta sessão)** Brainstorm + design doc → este arquivo.
2. **(esta sessão)** Invocar `writing-plans` para detalhar plano de execução da pipeline.
3. **(sessão seguinte)** Executar pipeline → produzir `docs/audits/mobile/2026-05-20-font-audit.md`.
4. **(revisão usuário)** Validar relatório.
5. **(sessão subsequente)** Nova rodada de `writing-plans` para o plano de correção baseado no relatório.
6. **(execução)** Aplicar fixes em ordem recomendada, verificando visualmente em Expo Go / Web.

---

## Não-objetivos desta auditoria

- Não aplica nenhum fix.
- Não modifica o DS (apenas registra gaps).
- Não cobre web (`swi-admin`).
- Não roda visual diff automatizado (Playwright contra screenshot Figma) — verificação visual após fixes é manual no Expo Go / Web.

---

## Referências

- `mobile/app/_layout.tsx` — ponto onde `useFonts` deveria existir.
- `mobile/node_modules/@kavicki/swi-design-system/src/tokens/typography.ts` — tokens declarados.
- Figma file `bzDUuPdSiKgl5xucBH0IYE`, canvas Mobile `nodeId=138:5997`.
- Memórias relevantes: `feedback_token_consumption`, `project_swi_mobile_scope`, `reference_swi_figma`, `reference_swi_design_system`.
- `mobile/README.md` — escopo "demo frontend-only" (fidelidade visual = critério de pronto).
