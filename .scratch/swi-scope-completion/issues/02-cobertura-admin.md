# 02: Expor cobertura verificável no painel admin

**What to build:** o painel admin passa a responder ao mesmo comando de cobertura que os outros dois projetos, com o limiar global mínimo de 80% escrito na configuração (não no comando, para que ninguém o afrouxe passando flag). O número real de cobertura do admin fica medido e registrado, mesmo que reprove o limiar hoje.

**Blocked by:** 01

**Status:** resolved

- [x] `npm run test:coverage` existe no admin e produz relatório de cobertura
- [x] O limiar global mínimo de 80% está declarado na configuração do Vitest, não como argumento de linha de comando
- [x] O percentual real de cobertura do admin (linhas, branches, funções, statements) está registrado no baseline
- [x] Se o limiar reprovar, a reprovação é registrada como falha conhecida; o limiar não é reduzido para forçar verde
- [x] `npm run lint` e `npm run typecheck` do admin continuam com o mesmo resultado de antes do ticket

## Answer

O plano superestimou o trabalho. A configuração de cobertura **já existia** em `swi-admin/vitest.config.ts`, com `provider: 'istanbul'`, `include`/`exclude` da árvore de produção e `thresholds` de 80% nas quatro métricas. `@vitest/coverage-istanbul@2.1.9` já estava declarado e instalado. Faltava apenas o script no `package.json`.

**RED:** `npm run test:coverage` no admin, `npm error Missing script: "test:coverage"`, exit 1.

**GREEN:** adicionada uma linha em `swi-admin/package.json`, `"test:coverage": "vitest run --coverage"`. Nenhuma dependência nova, nenhuma alteração na configuração de limiar.

Resultado (exit 0, 67s): 91 arquivos de teste, 978 testes, todos passando.

| Métrica    | Cobertura | Absoluto  | Limiar |
| ---------- | --------- | --------- | ------ |
| statements | 88,72%    | 3840/4328 | 80%    |
| branches   | 81,66%    | 2173/2661 | 80%    |
| functions  | 82,59%    | 1011/1224 | 80%    |
| lines      | 91,18%    | 3465/3800 | 80%    |

O limiar passa hoje, sem afrouxamento. `branches` a 81,66% é a métrica com menor folga.

`npm run lint` exit 0 (47s) e `npm run typecheck` exit 0 (15s), inalterados. `coverage/` já é ignorado pelo git (`.gitignore:55`), então o relatório não suja a árvore.

Evidência consolidada em `baseline/01-gates.md`.

## Comments

Este é o único ticket da U00 que altera código, e por exigência explícita do plano (seção 7): "o primeiro ticket que executar este gate deve criar o script/configuração Vitest e fixar limiar global mínimo de 80%".

RED esperado: `npm run test:coverage` falha por script inexistente. GREEN: comando roda e reporta cobertura.
