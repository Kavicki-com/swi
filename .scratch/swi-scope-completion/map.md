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
| U01             | **Desbloqueada** (U00B encerrada em 2026-08-28). Decomposição proposta nesta rodada; escopo menor do que o plano estima, ver ticket 09.                                                 |

## Evidências

- Baseline de ambiente: `baseline/00-ambiente.md`
- Saída dos gates: `baseline/01-gates.md`
- Flake do bootstrap: `baseline/02-flake-main-spec.md`
- Matriz congelada: `baseline/03-matriz-congelada.md`
- Planos históricos: `baseline/04-planos-historicos.md`

## Fora do escopo desta decomposição

U00A e U00B são unidades próprias no plano; U00 apenas **reproduz e registra** o que elas vão corrigir.
Nenhum defeito encontrado durante U00 é corrigido dentro de U00.
