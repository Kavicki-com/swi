# 10: MB-01, build do mobile morre por falta de memória com cache frio

**What to build:** `npm run verify` do mobile passa de forma determinística: `expo export --platform all` completa com cache frio e com cache quente, repetidas vezes, sem estouro de heap.

**Blocked by:** None (can start immediately). Não bloqueia a U01; bloqueia a U17 (gate integrado), então precisa fechar antes dela.

**Status:** ready-for-agent

- [ ] Loop de feedback construído antes de qualquer hipótese: um comando que reproduz a falha de propósito (cache frio forçado), conforme /diagnosing-bugs
- [ ] Causa registrada com evidência; o baseline mostra morte em NewSpace (geração jovem) com cerca de 873 MB de heap contra limite de 4144 MB e exit 134, então aumentar `--max-old-space-size` não é conclusão sustentada
- [ ] Correção aplicada e justificada, ou mitigação explícita no script de build, sem mascarar a causa
- [ ] `verify` completo do mobile verde em execuções repetidas partindo de cache frio

Evidência de partida: `baseline/01-gates.md` (seção MB-01) e seção 4.1 do plano.

## Comments

Criado em 2026-08-28 por decisão de priorização: U01 primeiro, MB-01 no próximo intervalo entre unidades. Não atacar junto com a U01.
