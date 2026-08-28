# 13: Mobile: contrato e serviços de update/remove

**What to build:** o serviço de relatórios do mobile sabe editar e excluir contra a API real e contra o mock, com o mesmo contrato e os mesmos erros.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] `ReportsBackend` ganha `update` e `remove`; o tipo `Report` expõe `version`
- [ ] Implementação API chama `PATCH /reports/:id` e `DELETE /reports/:id`, propagando 403 e 409 como erros tipados
- [ ] Implementação mock reproduz autoria, escopo e conflito de versão
- [ ] Testes de contrato cobrindo as duas implementações
- [ ] `lint`, `typecheck` e `test` do mobile verdes

## Comments
