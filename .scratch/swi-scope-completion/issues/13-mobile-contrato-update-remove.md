# 13: Mobile: contrato e serviços de update/remove

**What to build:** o serviço de relatórios do mobile sabe editar e excluir contra a API real e contra o mock, com o mesmo contrato e os mesmos erros.

**Blocked by:** 12

**Status:** resolved

- [x] `ReportsBackend` ganha `update` e `remove`; o tipo `Report` expõe `version`
- [x] Implementação API chama `PATCH /reports/:id` e `DELETE /reports/:id`, propagando 403 e 409 como erros tipados
- [x] Implementação mock reproduz autoria, escopo e conflito de versão
- [x] Testes de contrato cobrindo as duas implementações
- [x] `lint`, `typecheck` e `test` do mobile verdes

## Comments

- 2026-08-28: resolvido. `ReportsBackend.update/remove` + `Report.version` + `ReportUpdateInput` (sem status por construção: campo é veredito de ADMIN). Erros tipados `ReportPermissionError` (403) e `ReportVersionConflictError` (409) em `services/reports/types.ts`; API traduz status em `traduzErroDeEscrita`, demais erros propagam intactos. Mock reproduz autoria (worker 'Você' só edita o que criou), OCC e "Relatório não encontrado"; id do create ganhou sufixo sequencial (Date.now() colidia no mesmo ms). `http.ts` aceita PATCH/DELETE. Gate: 927/927, tsc e eslint limpos. RED 12/22 → GREEN.
