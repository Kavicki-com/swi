# 15: Mobile: exclusão confirmada

**What to build:** autor ou admin exclui um relatório com confirmação explícita; quem não pode excluir nem vê a ação. A lista responde na hora e restaura o item se o servidor recusar.

**Blocked by:** 13

**Status:** resolved

- [x] Ação de excluir visível só para autor/admin
- [x] Confirmação antes do DELETE; remoção otimista com rollback
- [x] 403 do servidor tratado com aviso (a UI esconde, o servidor decide)
- [x] Testes de tela verdes

## Comments

- 2026-08-28: resolvido, em duas fatias. Backend: `canEdit` no DTO (decisão aprovada: booleano computado por requisição em vez de expor `authorId`, pra régua "autor ou ADMIN" seguir vivendo só no serviço); `list`/`get` ganham `viewer` opcional vindo do token, default `false` é o fallback seguro; 6 testes novos, 593/593, lint e `nest build` verdes. Mobile: `Report.canEdit` no contrato (`fromApi` assume `false` de servidor antigo), mock espelha (seed alheio `false`, criado pelo usuário `true`); sem `canEdit` o detalhe esconde "Revisar relatório" e "Excluir relatório" (a UI esconde, o servidor decide); exclusão pede confirmação explícita ("ação definitiva"), o `ReportsProvider.remove` tira o item da lista na hora e restaura NA MESMA POSIÇÃO se o servidor recusar (snapshot da lista inteira, não filter de volta); recusa avisa o motivo e a pessoa fica na tela. 10 testes novos no mobile, 948/948, tsc e eslint limpos. Isso fecha também a pendência registrada no ticket 14 (botão de editar visível pra quem ia colher 403).
