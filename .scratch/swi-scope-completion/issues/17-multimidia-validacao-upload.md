# 17: Multimídia: validação de upload

**What to build:** o upload de anexo recusa, com mensagem clara, arquivo fora dos formatos e limites suportados. A validação vale no backend (fonte de verdade) e no picker do mobile (feedback imediato).

**Blocked by:** None (can start immediately; serializar na branch com os demais).

**Status:** ready-for-agent

- [ ] Formatos e limites definidos em um único módulo extensível (hoje: imagens)
- [ ] Backend valida MIME, extensão e tamanho no caminho de upload; teste RED primeiro
- [ ] Picker do mobile filtra formatos e explica a recusa
- [ ] Decisão pendente registrada: a lista multimídia final é do cliente (plano, U01)
- [ ] Suítes verdes

## Comments
