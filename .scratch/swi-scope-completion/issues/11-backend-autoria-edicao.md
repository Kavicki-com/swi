# 11: Backend: autoria na edição de relatório

**What to build:** editar um relatório passa a seguir a mesma régua da exclusão: só o autor ou um admin conseguem. Um worker que tenta editar relatório de colega recebe 403 e nada é alterado.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Teste RED primeiro: worker não-autor recebe Forbidden no update e o relatório não muda
- [x] Autor edita o próprio relatório; admin edita relatório de qualquer autor no escopo da empresa
- [x] `_userId` deixa de ser ignorado; a assinatura recebe o papel (role) como o `remove` já recebe
- [x] Premissa registrada: régua igual à da exclusão (pergunta 8, assumida em 2026-08-28); reverter é um commit se o cliente contrariar
- [x] Worker autor edita só os campos que preenche na criação; `status` e `statusLabel` (veredito da revisão, ausentes do CreateReportDto) exigem ADMIN e devolvem 403 explícito
- [x] Validação estrutural por allowlist (`WORKER_EDITABLE_FIELDS`): campo fora do conjunto de criação devolve 403 nomeando os campos; campo novo no `UpdateReportDto` nasce restrito a ADMIN por omissão
- [x] Suíte do backend verde

## Comments

## Answer

Implementado em `feat/backend-reports-mobile-crud`. RED: 1 falha em 49 (worker não-autor não recebia 403; a chamada seguia até o `report.update`). GREEN: regra espelhada do `remove` dentro da mesma transação do update, `select` ganhou `authorId`, assinatura virou `update(id, userId, role, dto, companyId)` e o controller passa `user.role`.

Achado registrado: a assimetria NÃO era esquecimento. O docstring do `remove` a justificava com "editar é reversível, apagar não". A justificativa não sobrevive à U01: sem histórico de versões a edição sobrescreve o registro de segurança de forma tão definitiva quanto a exclusão, e o mobile expõe editar a todo worker. Os dois docstrings foram atualizados para contar essa história.

Gate: lint 0 erros, `tsc --noEmit` limpo, suíte completa do backend 578/578 em 55 arquivos.

## Comments

Premissa da pergunta 8 (régua igual à da exclusão) aplicada conforme aprovado em 2026-08-28.

Refinamento do usuário (2026-08-28, durante o ticket): "o editar do worker tem que ser relacionado apenas às informações que ele tem permissão pra preencher". O corte caiu dos próprios DTOs: os dois únicos campos do UpdateReportDto que não existem no CreateReportDto são status e statusLabel. RED (1 em 41) e GREEN de novo; gate final 579/579.

Segundo refinamento do usuário (2026-08-28): "tem que adicionar validação, caso ele tente". A checagem pontual de status/statusLabel virou allowlist estrutural, mesmo padrão de `common/staff.ts`. O `ValidationPipe` global (`whitelist: true`) já derruba chave desconhecida na borda HTTP; a allowlist cobre os campos declarados no DTO, atuais e futuros. Gate final: 580/580, lint e typecheck limpos.
