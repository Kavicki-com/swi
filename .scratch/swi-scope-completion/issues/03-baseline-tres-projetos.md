# 03: Baseline verificável dos três projetos

**What to build:** o estado de saúde real de mobile, admin e backend no commit-base fica medido e anexado: lint, tipos, testes, cobertura e build de cada um, cada comando com sua saída, seu código de saída e sua duração. Falha encontrada aqui é registrada como falha conhecida, não corrigida, para que ninguém confunda "consertei durante a medição" com "já estava verde".

**Blocked by:** 01, 02

**Status:** resolved

- [x] Para cada um dos três projetos, lint, typecheck, testes, cobertura e build foram executados e têm saída anexada
- [x] Cada execução registra comando exato, diretório de origem, código de saída e duração
- [x] O percentual de cobertura global está registrado para os três projetos
- [x] Cada falha traz mensagem e local, e é classificada como falha conhecida sem correção neste ticket
- [x] Ao final, `git status` não mostra alteração em código de produto além da introduzida pelo ticket 02

## Answer

Evidência em `baseline/01-gates.md`.

**14 comandos executados, 13 verdes.** Cobertura global: admin 88,72% statements, backend 95,65%, mobile 85,59%. Os três passam o piso de 80% do plano nas quatro métricas.

Suítes somadas: 252 arquivos de teste, 2.468 testes, todos passando (978 admin, 575 backend, 915 mobile).

**Única falha, registrada como MB-01 e não corrigida:** `npm run build:all` do mobile morreu com `FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed`, exit 134, aos 194s. A repetição imediata passou em 47s com cache Metro quente, então a falha é intermitente e ligada a cache frio, não determinística.

O detalhe que impede o diagnóstico errado: a heap usada no momento da morte era ~873 MB contra limite de 4144 MB, e o estouro foi em `NewSpace`, não em old space. Aumentar `--max-old-space-size` não é conclusão sustentada pela evidência.

MB-01 não tem dono: não é da U00B (que trata da suíte do backend) e bloqueia o `verify` agregado do mobile, logo também a U17. Precisa de ticket próprio.

`git status` ao final mostra apenas `swi-admin/package.json` modificado, a linha do ticket 02. Nenhum outro código de produto tocado. `coverage/` e `dist/` são ignorados pelo git.

## Comments

E2E gerenciado (`test:e2e:managed`) fica fora deste ticket: a unidade U00 pede "lint, tipos, testes, cobertura e builds", e o E2E pertence ao gate integrado (U17) e às unidades que cruzam aplicações.
