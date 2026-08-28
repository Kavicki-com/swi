# 16: Mobile: anexos na edição

**What to build:** na edição, o usuário mantém, adiciona e remove anexos; anexo adicionado por outra pessoa entre a abertura do formulário e o salvamento sobrevive, via o snapshot `imageKeysBase` que o backend já suporta.

**Blocked by:** 14

**Status:** resolved

- [x] Formulário captura `imageKeysBase` na abertura e envia no PATCH
- [x] Adicionar e remover refletidos; anexo concorrente preservado, com teste cobrindo o cenário
- [x] Upload reaproveita o fluxo de mídia existente do mobile
- [x] Testes verdes

## Comments

- 2026-08-28: resolvido, só mobile (o backend já tinha a prova de snapshot desde a fatia do painel). `Report.imageKeys` entra no contrato (keys crus na MESMA ordem de `images`; servidor antigo vira `[]`). `ReportUpdateInput` ganha `imageKeys` (mantidos), `imageUris` (novos, uris locais) e `imageKeysBase` (snapshot do load). O adapter da API sobe os novos com o `uploadImage` de sempre (prefixo reports/), concatena atrás dos mantidos e NUNCA envia `imageUris` ao servidor: campo desconhecido derrubaria o PATCH do worker com 403 pela allowlist. O mock reproduz a merge do backend com key=uri, incluindo teste de anexo concorrente sobrevivendo. A tela de edição ganhou a grade do form de criação, pré-preenchida, crescendo além de 4 slots pra caber todos os anexos (slot escondido viraria "removi" na prova de snapshot); `imageKeysBase` fica CONGELADO no recarregar pós-conflito, senão anexo concorrente pareceria remoção. 10 testes novos (4 adapter + 1 mock + 5 tela); gate 957/957, tsc e eslint limpos.
