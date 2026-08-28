# Mapa: conclusão do escopo SWI sem smartband

**Plano de origem:** `docs/plans/2026-08-25-swi-conclusao-escopo-sem-smartband.md`
**Unidade decomposta nesta rodada:** U00: Congelar a matriz executável (`EXECUTÁVEL AGORA`, sem dependências)

## Regra de execução

Trabalhar sempre a **fronteira**: qualquer ticket cujos bloqueios estejam todos resolvidos.
Unidades seguintes (U00A, U00B, U01, ...) não começam antes de U00 fechar.

## Tickets da U00

| NN                                        | Título                                               | Blocked by         | Status         |
| ----------------------------------------- | ---------------------------------------------------- | ------------------ | -------------- |
| [01](issues/01-fundacao-baseline.md)      | Fundação do baseline e registro de ambiente          | nenhum                  | resolved        |
| [02](issues/02-cobertura-admin.md)        | Expor cobertura verificável no painel admin          | 01                 | resolved        |
| [03](issues/03-baseline-tres-projetos.md) | Baseline verificável dos três projetos               | 01, 02             | resolved        |
| [04](issues/04-flake-bootstrap.md)        | Caracterizar o flake do bootstrap do backend         | 03                 | resolved        |
| [05](issues/05-evidencia-gestao.md)       | Evidência da matriz: gestão, comunicação, relatórios | 03                 | resolved        |
| [06](issues/06-evidencia-campo.md)        | Evidência da matriz: campo, mapas e continuidade     | 03                 | resolved        |
| [07](issues/07-evidencia-telemetria.md)   | Evidência da matriz: telemetria, saúde e derivados   | 03                 | resolved        |
| [08](issues/08-planos-historicos.md)      | Classificar os planos históricos                     | 01                 | resolved        |
| [09](issues/09-congelar-matriz.md)        | Congelar a matriz e fechar U00                       | 04, 05, 06, 07, 08 | resolved        |

**U00 encerrada em 2026-08-25.** Registro durável na seção 4.1 do plano.

## Fila seguinte, na ordem das dependências

| Próximo         | Estado do bloqueio                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [10](issues/10-mb01-build-mobile-oom.md) | **MB-01** ganhou dono (ticket 10, criado em 2026-08-28). Atacar no próximo intervalo entre unidades; bloqueia o `verify` do mobile e a U17.                     |
| U00B            | **Encerrada em 2026-08-28** por decisão do usuário: BE-01 retirado como não reproduzível, sem mudança de código.       |
| U00A            | **Decisão do usuário:** setor não existe como escopo, e `companyId` é nullable. Modelagem precede a implementação.        |
| U01             | **Decomposta** nos tickets 11 a 18 (2026-08-28), aprovada pelo usuário; ver a tabela abaixo.                                                 |

## Evidências

- Baseline de ambiente: `baseline/00-ambiente.md`
- Saída dos gates: `baseline/01-gates.md`
- Flake do bootstrap: `baseline/02-flake-main-spec.md`
- Matriz congelada: `baseline/03-matriz-congelada.md`
- Planos históricos: `baseline/04-planos-historicos.md`

## Fora do escopo desta decomposição

U00A e U00B são unidades próprias no plano; U00 apenas **reproduz e registra** o que elas vão corrigir.
Nenhum defeito encontrado durante U00 é corrigido dentro de U00.

## Tickets da U01 (decomposta em 2026-08-28)

**Branch de trabalho:** `feat/backend-reports-mobile-crud` (backend pode tocar mobile, convenção do CLAUDE.md).
**Premissas assumidas:** edição segue a régua da exclusão (autor ou admin); campo de versão só em `Report`. Trocar qualquer uma é barato antes dos tickets 11 e 12 fecharem.

| NN                                               | Título                                  | Blocked by     | Status          |
| ------------------------------------------------ | --------------------------------------- | -------------- | --------------- |
| [11](issues/11-backend-autoria-edicao.md)        | Backend: autoria na edição              | nenhum         | resolved        |
| [12](issues/12-backend-versao-report.md)         | Backend: versão no Report e 409         | 11             | resolved        |
| [13](issues/13-mobile-contrato-update-remove.md) | Mobile: contrato e serviços             | 12             | resolved |
| [14](issues/14-mobile-edicao-texto.md)           | Mobile: edição de texto (tracer bullet) | 13             | resolved |
| [15](issues/15-mobile-exclusao.md)               | Mobile: exclusão confirmada             | 13             | resolved |
| [16](issues/16-mobile-anexos-edicao.md)          | Mobile: anexos na edição                | 14             | resolved |
| [17](issues/17-multimidia-validacao-upload.md)   | Multimídia: validação de upload         | nenhum         | ready-for-agent |
| [18](issues/18-e2e-permissoes.md)                | E2E e permissões (aceite da U01)        | 14, 15, 16, 17 | ready-for-agent |
