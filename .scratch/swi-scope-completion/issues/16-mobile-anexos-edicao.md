# 16: Mobile: anexos na edição

**What to build:** na edição, o usuário mantém, adiciona e remove anexos; anexo adicionado por outra pessoa entre a abertura do formulário e o salvamento sobrevive, via o snapshot `imageKeysBase` que o backend já suporta.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Formulário captura `imageKeysBase` na abertura e envia no PATCH
- [ ] Adicionar e remover refletidos; anexo concorrente preservado, com teste cobrindo o cenário
- [ ] Upload reaproveita o fluxo de mídia existente do mobile
- [ ] Testes verdes

## Comments
