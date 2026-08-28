# 12: Backend: versão no Report e 409 em edição concorrente

**What to build:** duas edições simultâneas do mesmo relatório nunca se sobrescrevem em silêncio: a segunda, baseada em versão velha, recebe 409 e o cliente pode recarregar antes de tentar de novo.

**Blocked by:** 11

**Status:** resolved

- [x] Teste RED primeiro: PATCH com `baseVersion` desatualizada devolve 409 sem alterar nada
- [x] Campo `version` em `Report` (default 0), incrementado a cada update na mesma transação; migration criada
- [x] `baseVersion` opcional no DTO: sem ele o PATCH mantém o comportamento atual (painel admin não quebra; adoção no admin fica para branch admin futura)
- [x] Respostas de list/get/create/update expõem `version`
- [x] Premissa registrada: versão só em `Report` por enquanto (pergunta 9, assumida em 2026-08-28)
- [x] Suíte do backend verde

## Comments

## Answer

Implementado em `feat/backend-reports-mobile-crud`. RED: compilação acusou a lacuna do contrato (`out.version` inexistente no DTO) e, liberada, 4 falhas comportamentais em 46. GREEN em duas camadas:

- **Caminho amigável:** `existing.version !== dto.baseVersion` responde 409 antes do write, com mensagem de recarga.
- **Corrida fechada:** o write é `where: { id, version: baseVersion }` (extendedWhereUnique); P2025 com baseVersion vira 409, sem baseVersion mantém o 404 histórico.

`version` incrementa em TODO update, com ou sem baseVersion: sem isso uma edição do painel (contrato antigo) seria invisível para quem trava por versão. `baseVersion` entrou na allowlist do worker (é token de concorrência, não campo de conteúdo) e no DTO com `@IsInt() @Min(0)` (3 testes novos de validação).

Migration `20260828100000_report_version` escrita à mão (ALTER TABLE ... DEFAULT 0), sem banco de dev rodando nesta rodada: `prisma migrate dev` não foi executado, `prisma generate` sim. Fica para o próximo `migrate deploy`, e o deploy Cloudez não roda migration sozinho (nota de infra conhecida).

Gate: 587/587, lint e typecheck limpos, `nest build` verde.

## Comments

Premissa da pergunta 9 (versão só em Report) aplicada conforme aprovado em 2026-08-28.
