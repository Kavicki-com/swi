# 09: Congelar a matriz e fechar U00

**What to build:** a matriz de rastreabilidade do escopo passa a refletir o que o código prova, com evidência anexada linha a linha e com a separação explícita entre implementado e homologado. O time recebe um ponto de partida congelado: o que já existe, o que falha hoje, e o que cada unidade seguinte precisa antes de começar.

**Blocked by:** 04, 05, 06, 07, 08

**Status:** resolved

- [x] A matriz congelada traz, por linha, a evidência coletada, a classificação e o commit em que foi observada
- [x] As falhas conhecidas dos três projetos estão consolidadas num único lugar, com quem as herda (U00B e demais)
- [x] Nenhuma linha aparece como implementada sem evidência de código ou teste
- [x] Os bloqueios de entrada de U00A, U00B e U01 estão nomeados a partir da evidência, não do plano
- [x] O documento do plano recebe apenas evidência durável; andamento fica nos tickets locais

## Answer

Matriz congelada em `baseline/03-matriz-congelada.md`, seção "Congelamento (ticket 09)". Registro durável inserido no plano como seção 4.1.

**As 21 linhas têm evidência de código.** Contagem: 15 com núcleo `EXECUTÁVEL AGORA`, 6 com `PREPARAÇÃO AGNÓSTICA`, 4 com componente bloqueado por decisão do cliente, 5 com componente bloqueado por hardware/fornecedor.

**Duas falhas conhecidas, com destinos opostos:**

- **MB-01** (build do mobile estoura heap com cache frio) é real, reproduziu 1 em 2, e **não tem dono**. Bloqueia o `verify` do mobile e a U17.
- **BE-01** (flake do `main.spec.ts`) **não existe como descrito**: 0 falhas em 33 execuções. Vira alegação a retirar, não defeito a corrigir.

**Bloqueios de entrada nomeados:**

- **U00A** precisa de decisão antes de codar: setor não existe como escopo em lugar nenhum (`sector` é texto livre em `Profile`, sem taxonomia nem uso em autorização; corrigido em 2026-08-28), e `companyId` é nullable por desenho, então usuário sem empresa fura o escopo. Há 38 condicionais de cargo a consolidar.
- **U00B** perdeu a premissa. Encerrar ou reescopar, decisão do usuário.
- **U01** encolheu: o backend já faz `PATCH`/`DELETE` com escopo de empresa e concorrência de anexos; o admin já consome. Restam o porte para o mobile, a UI, e duas lacunas reais (autoria não verificada no `update`, ausência de campo de versão em todo o schema).

**Ressalva de honestidade sobre o aceite da U00.** O plano exige "baseline reproduzível". É reproduzível quanto a código de produto, mas a árvore de trabalho não está limpa: o plano desta rodada, o ADR 0001 e `docs/agents/` não estão versionados, e `CLAUDE.md` está modificado. Um checkout limpo de `c93f021` não os encontra. Registrado em `00-ambiente.md`; a decisão de commitá-los é do usuário.

## Comments

Aceite da U00 conforme o plano: "baseline reproduzível, falhas conhecidas registradas e nenhuma afirmação de implementado baseada apenas em plano histórico".

Este ticket encerra U00. Ele não autoriza começar U00A nem U00B: essas unidades têm tickets próprios, a serem criados depois do aceite.
