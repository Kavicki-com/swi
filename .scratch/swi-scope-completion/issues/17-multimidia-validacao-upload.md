# 17: Multimídia: validação de upload

**What to build:** o upload de anexo recusa, com mensagem clara, arquivo fora dos formatos e limites suportados. A validação vale no backend (fonte de verdade) e no picker do mobile (feedback imediato).

**Blocked by:** None (can start immediately; serializar na branch com os demais).

**Status:** resolved

- [x] Formatos e limites definidos em um único módulo extensível (hoje: imagens)
- [x] Backend valida MIME, extensão e tamanho no caminho de upload; teste RED primeiro
- [x] Picker do mobile filtra formatos e explica a recusa
- [x] Decisão pendente registrada: a lista multimídia final é do cliente (plano, U01)
- [x] Suítes verdes

## Comments

- 2026-08-28: resolvido. O lado backend JÁ cumpria o checklist de unidades anteriores: módulo único extensível `media/allowed-content-types.ts` (tipos por prefixo), MIME e tamanho validados ANTES de assinar o presign (400 legível, teto `MAX_UPLOAD_BYTES` 15 MB), extensão derivada do tipo validado por mapa exaustivo (erro de compilação se faltar), key regex nos pontos de anexo; tudo com specs (allowed-content-types.spec, media.service.spec, media.controller.spec). O gap era o mobile: nasceu `lib/media/mediaConstraints.ts` (extensões por kind imagem/exame + teto, espelhando o backend, com comentário apontando a fonte de verdade), consumido em três pontos: `useMediaPicker` valida o asset da galeria/câmera (formato fora da lista ou >15 MB viram "Arquivo recusado" + null, mesmo contrato de cancelamento), `pickExamDocument` valida o laudo (o filtro de tipo do DocumentPicker não impõe teto) e `uploadImage` re-checa o teto antes do presign (mensagem clara, sem ida à rede). Decisão pendente REGISTRADA no módulo e aqui: a lista multimídia final (vídeo? áudio?) é do cliente, conforme o plano da U01; estender é uma extensão aqui + um content-type no backend. 13 testes novos; gate mobile 971/971, tsc e eslint limpos; backend intacto.
