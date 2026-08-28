# 12: Backend: versão no Report e 409 em edição concorrente

**What to build:** duas edições simultâneas do mesmo relatório nunca se sobrescrevem em silêncio: a segunda, baseada em versão velha, recebe 409 e o cliente pode recarregar antes de tentar de novo.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Teste RED primeiro: PATCH com `baseVersion` desatualizada devolve 409 sem alterar nada
- [ ] Campo `version` em `Report` (default 0), incrementado a cada update na mesma transação; migration criada
- [ ] `baseVersion` opcional no DTO: sem ele o PATCH mantém o comportamento atual (painel admin não quebra; adoção no admin fica para branch admin futura)
- [ ] Respostas de list/get/create/update expõem `version`
- [ ] Premissa registrada: versão só em `Report` por enquanto (pergunta 9, assumida em 2026-08-28)
- [ ] Suíte do backend verde

## Comments
