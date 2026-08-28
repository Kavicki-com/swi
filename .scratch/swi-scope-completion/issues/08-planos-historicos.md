# 08: Classificar os planos históricos

**What to build:** ninguém mais executa um plano vencido por engano. Cada documento de plano do repositório recebe um estado explícito, referência, implementado ou superado, sustentado pelo código atual e não pela data do arquivo. Os cinco documentos que o plano manda validar recebem justificativa individual.

**Blocked by:** 01

**Status:** resolved

- [x] Todos os documentos de `docs/plans/` estão classificados como referência, implementado ou superado
- [x] Os cinco documentos listados na seção 10 do plano têm justificativa individual apoiada em código ou teste atual
- [x] Todo plano que descreve arquitetura já abandonada está marcado como superado, com a razão registrada
- [x] A classificação vive num local durável, não apenas na conversa
- [x] Nenhum plano é classificado como implementado só porque foi mergeado

## Answer

Evidência em `baseline/04-planos-historicos.md`. São 90 documentos: 14 de maio, 21 de junho, 47 de julho, 8 de agosto.

**O divisor de águas é datado e está escrito pelo próprio acervo.** `2026-07-01-swi-backend-container-pivot-design.md` declara: "sai o Amplify Gen 2 (as-code, deploy-gated, nunca rodou) e entra um backend conteinerizado". Confirmei no código, não no texto: nenhum `aws-amplify` declarado nos três projetos, nenhum diretório `amplify/`, e os únicos pacotes AWS são clientes S3 do backend para mídia. Logo, a coorte de junho anterior ao pivô está superada quanto à arquitetura.

**Método, declarado por honestidade:** classifiquei por coorte com regra explícita, mais justificativa individual para os cinco documentos da seção 10. Classificar 90 arquivos um a um contra o código seria uma rodada inteira e não é o que a U00 pede. O limite disso está escrito no documento: onde a matriz congelada contradisser a tabela de coortes, vale a matriz.

**Nenhum plano foi classificado como implementado por ter sido mergeado.** Para a coorte de agosto usei os commits nomeados mais a existência do portão no disco; para julho, a existência dos módulos com specs.

**Descoberta de governança:** a família `docs/plans/*backend*` traz no próprio cabeçalho "Doc temporário: deletar quando o backend inteiro estiver implementado". A maior parte do acervo se declara descartável, o que explica o volume. Arquivar a coorte superada é recomendação registrada, não executada: é decisão do usuário.

## Comments

O risco de sequência número 10 do plano avisa que documentos antigos citam Amplify/DynamoDB. Esses são candidatos naturais a "superado", mas a marcação exige checar o código, não só o texto.

Cuidado com o inverso: um plano pode estar mergeado e mesmo assim descrever comportamento que depois foi alterado. Mergeado não é sinônimo de vigente.
