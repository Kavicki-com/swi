# 05: Evidência da matriz: gestão, comunicação e relatórios

**What to build:** as linhas da matriz que tratam de gestão de pessoas, ordens de serviço, chat e relatórios deixam de depender da palavra de um plano antigo e passam a ter evidência checável hoje: uma rota, um endpoint, um teste ou um estado observado no código atual. Onde o plano e o código discordam, o código ganha e a divergência fica escrita.

**Blocked by:** 03

**Status:** resolved

Linhas da matriz cobertas por este ticket:

1. Ordens de serviço
2. Gestão de funcionários
3. Gestão de administradores
4. Chat integrado
5. Relatórios admin
6. Relatórios mobile
7. SOLID/MVC

- [x] Cada uma das sete linhas tem ao menos uma evidência do tipo rota, endpoint, teste ou estado observado, com caminho verificável
- [x] A lacuna declarada pelo plano em relatórios mobile ("contrato do serviço não expõe editar/excluir") foi confirmada ou refutada lendo o contrato atual
- [x] Divergências entre a baseline descrita no plano e o código atual estão registradas explicitamente
- [x] Nenhuma linha é marcada como implementada com base apenas em citação de plano histórico
- [x] Cada linha recebe a classificação do vocabulário do plano: executável agora, preparação agnóstica, bloqueado por hardware/fornecedor ou bloqueado por decisão do cliente

## Answer

Evidência no grupo A de `baseline/03-matriz-congelada.md`.

As sete linhas são `EXECUTÁVEL AGORA` no seu núcleo. Nenhuma surpresa negativa neste grupo.

**A lacuna de relatórios mobile se confirma, e é menor do que o plano sugere.** `mobile/services/reports/types.ts:53-59` define `ReportsBackend` com apenas `list`, `get`, `create` e `addComment`. Mas `swi-backend/src/reports/reports.controller.ts` **já expõe** `PATCH /:id` e `DELETE /:id` (204). A U01 portanto não tem trabalho de schema nem de controller: é contrato, adaptador, UI, concorrência e permissão. Isso deve ser recalibrado no tamanho da unidade.

**Divergência registrada nas linhas 2 e 3:** cadastro de funcionários e de administradores está real, mas `EmployeeDetails.tsx` e `AdminDetails.tsx` importam `simulatedVitals`. A linha só é executável agora na parte de cadastro; a telemetria exibida no mesmo ecrã pertence ao grupo C.

## Comments

Distinguir sempre "existe o endpoint" de "a jornada inteira funciona". A U00 não precisa provar a jornada; precisa registrar honestamente qual dos dois foi verificado.
