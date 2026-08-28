# 15: Mobile: exclusão confirmada

**What to build:** autor ou admin exclui um relatório com confirmação explícita; quem não pode excluir nem vê a ação. A lista responde na hora e restaura o item se o servidor recusar.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] Ação de excluir visível só para autor/admin
- [ ] Confirmação antes do DELETE; remoção otimista com rollback
- [ ] 403 do servidor tratado com aviso (a UI esconde, o servidor decide)
- [ ] Testes de tela verdes

## Comments
