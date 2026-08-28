# 14: Mobile: edição de texto a partir do detalhe

**What to build:** o usuário abre um relatório seu, toca em editar, altera título/descrição e salva. A tela responde na hora (otimista) e desfaz com aviso se o servidor recusar; conflito 409 aparece como aviso claro com opção de recarregar. Tracer bullet da U01: primeira fatia completa schema-API-serviço-tela.

**Blocked by:** 13

**Status:** resolved

- [x] Fluxo detalhe, edição, salvar funciona contra a API
- [x] Estado otimista com rollback em falha
- [x] 409 vira mensagem de conflito com recarga; nunca sobrescrita silenciosa
- [x] UI só com componentes do DS via `useTheme()`; nenhum componente local novo (regra do projeto)
- [x] Testes de tela verdes

## Comments

- 2026-08-28: resolvido. Rota nova `app/(app)/reports/edit/[id].tsx` (mesmo aninhamento de `journey/task/[id]`), aberta pelo botão "Revisar relatório" do detalhe, que era `onPress={() => {}}`. Form espelha o de `new.tsx` nos três campos de texto; anexos e responsáveis ficam pro 16. Otimismo com rollback vive no `ReportsProvider.update`: a lista mostra o texto novo antes da resposta e volta ao anterior se o servidor recusar; a resposta do PATCH é MESCLADA (não substitui) porque vem sem comentários e os apagaria da tela. Recusa não tira a pessoa do form: 409 abre "Conflito de versão" com "Recarregar", que adota só a versão do servidor e preserva o texto digitado; 403 mostra a mensagem do servidor. O detalhe relê ao reganhar foco (primeiro foco é o da montagem, não paga requisição dobrada). Só componentes do DS via `useTheme()`, nenhum componente local novo. Gate: 938/938, tsc e eslint limpos.
- Pendência conhecida, some no ticket 15: o botão de editar aparece pra qualquer pessoa, e quem não é autor só descobre no 403. O mobile não tem como saber a autoria hoje: o `toDto` do backend não devolve `authorId`, e comparar `authorName` com o nome do perfil é frágil. Decidir no 15 entre expor `authorId` (ou um `canEdit`) no DTO.
