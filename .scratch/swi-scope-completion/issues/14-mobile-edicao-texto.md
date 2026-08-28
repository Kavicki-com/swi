# 14: Mobile: edição de texto a partir do detalhe

**What to build:** o usuário abre um relatório seu, toca em editar, altera título/descrição e salva. A tela responde na hora (otimista) e desfaz com aviso se o servidor recusar; conflito 409 aparece como aviso claro com opção de recarregar. Tracer bullet da U01: primeira fatia completa schema-API-serviço-tela.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] Fluxo detalhe, edição, salvar funciona contra a API
- [ ] Estado otimista com rollback em falha
- [ ] 409 vira mensagem de conflito com recarga; nunca sobrescrita silenciosa
- [ ] UI só com componentes do DS via `useTheme()`; nenhum componente local novo (regra do projeto)
- [ ] Testes de tela verdes

## Comments
