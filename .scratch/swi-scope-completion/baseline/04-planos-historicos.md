# Baseline 04: Estado dos planos históricos

**Ticket:** 08: Classificar os planos históricos
**Commit-base:** `c93f02103075b8c432c8e9752f5837e41f42b3f7`
**Classificado em:** 2026-08-25

`docs/plans/` tem **90 documentos**, distribuídos assim:

| Coorte  | Quantidade |
| ------- | ---------: |
| 2026-05 |         14 |
| 2026-06 |         21 |
| 2026-07 |         47 |
| 2026-08 |          8 |

## Vocabulário

- **referência**: descreve decisão ou desenho ainda vigente; serve de consulta, não de fila de trabalho.
- **implementado**: o comportamento que o documento descreve está no código e coberto por teste no commit-base.
- **superado**: descreve arquitetura ou abordagem que o projeto abandonou. Ler como história, nunca executar.

## O divisor de águas está documentado, e é datado

`docs/plans/2026-07-01-swi-backend-container-pivot-design.md` abre declarando o pivô, com estas palavras:

> "Marca um pivô de arquitetura: sai o Amplify Gen 2 (as-code, deploy-gated, nunca rodou) e entra um backend conteinerizado".

E descreve o estado anterior: "código em `swi-backend/amplify/` (models/auth/Lambdas) (...) nunca deployado (sem conta AWS, R$0). O app roda 100% em mocks em memória".

**Verificação no código, não no texto:** nenhum dos três `package.json` declara `aws-amplify`; não existe diretório `amplify/` em nenhum dos três projetos; os únicos pacotes AWS são clientes S3 do backend (`@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`), usados para mídia, não para Amplify. O painel ainda mantém um teste que trava a regressão: `swi-admin/src/services/production-contract.test.ts` afirma que `amplifyApi` e `dataBackend.ts` não voltaram.

**Portanto:** todo plano anterior a 2026-07-01 que trate o Amplify Gen 2 ou o DynamoDB como arquitetura-alvo está **superado**. Isso cobre a coorte de junho de 2026 no que toca a arquitetura.

## Um aviso que os próprios planos dão sobre si mesmos

Os documentos da família `docs/plans/*backend*` trazem, no próprio cabeçalho:

> "Doc temporário (família `docs/plans/*backend*`): deletar quando o backend inteiro estiver implementado."

Ou seja, a maior parte do acervo se declara descartável. Isso não os torna superados hoje, mas explica por que o acervo chegou a 90 arquivos e por que a limpeza é trabalho legítimo, separado desta rodada.

## Método de classificação

Classificar 90 documentos um a um, cada um contra o código, seria uma rodada inteira e não é o que a U00 pede. O que a U00 pede é que ninguém execute um plano vencido por engano. Então a classificação é **por coorte, com regra explícita**, mais **justificativa individual** para os cinco documentos que a seção 10 do plano nomeia.

| Coorte / família                                                     | Estado       | Regra aplicada                                                                                                                            |
| -------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05 (admin S0/S1, mobile fidelidade, DS, fontes)                 | referência   | Antecedem o backend real e tratam de painel, DS e fidelidade visual. Nada neles depende da arquitetura pivotada.                           |
| 2026-06 anteriores ao pivô, família `*backend*`                      | **superado** | Assumem Amplify Gen 2 / DynamoDB como alvo. Arquitetura ausente do código.                                                                 |
| `2026-07-01-*container-pivot-*`                                      | referência   | É o documento que estabelece a arquitetura vigente.                                                                                        |
| 2026-07 posteriores ao pivô (`fatia0` a `fatia7`, hardening, perfil) | implementado | Descrevem os módulos que hoje existem em `swi-backend/src/` com specs. Verificado por amostragem estrutural, não linha a linha.            |
| 2026-08 (higiene de entrega, prontidão para o cliente)               | implementado | Os commits `a0f648e`, `8687cf9`, `4381f95`, `5779890` e `bc76466` estão na história, e `scripts/quality/assert-client-hygiene.mjs` existe. |

**Limite honesto deste método:** "implementado" por coorte significa que a capacidade existe estruturalmente no commit-base, não que cada item do plano foi conferido. Onde a matriz congelada (`03-matriz-congelada.md`) contradisser esta tabela, vale a matriz, que foi levantada arquivo por arquivo.

## Os cinco documentos nomeados pela seção 10

### 1. `2026-06-22-swi-backend-vitals-gps-design.md`

**Estado:** superado quanto à arquitetura; referência quanto ao domínio.

É anterior ao pivô e cita Amplify/DynamoDB. Porém é o único documento que modela vitals e GPS juntos, e a U11 e a U12 precisam desse desenho de domínio. Ler as decisões de domínio, descartar tudo sobre persistência e deploy.

**Cuidado concreto:** o resíduo dessa era ainda está no código. `mobile/services/telemetry/useTelemetrySampler.ts:8` documenta `expiresAt` como "DynamoDB TTL contract". Executar este plano como se estivesse vigente reforçaria o resíduo em vez de removê-lo.

### 2. `2026-06-23-swi-backend-notificacoes-design.md`

**Estado:** superado.

Anterior ao pivô e citando Amplify. O tema foi reexecutado depois em `2026-07-03-swi-backend-fatia5-notificacoes-{design,plan}.md`, já na arquitetura containerizada, e o resultado está em `swi-backend/src/notifications/` com 4 endpoints e 2 specs. O documento de junho não acrescenta nada que o de julho não cubra.

### 3. `2026-07-02-swi-backend-dominios-nao-saude-design.md`

**Estado:** referência, e vigente.

É posterior ao pivô e se declara sucessor explícito: "Sucede o roadmap Amplify (`2026-06-22-swi-backend-roadmap-design.md`, superado pelo pivô) e estende o pivô containerizado". É o documento que governa a sequência de domínios não-saúde, que é exatamente o recorte desta rodada. Deve ser lido antes das unidades U01 a U06.

### 4. `2026-07-23-swi-admin-weather-fidelity-design.md`

**Estado:** referência, com condição não verificada.

Descreve um defeito concreto e ainda plausível: o mapper do admin colapsava `clear/clouds/fog` em `sun`, mostrando "SOL INTENSO" em dia nublado, e não havia estado de noite. O próprio plano de 2026-08-25 manda reaproveitá-lo "apenas após verificar o estado atual e a disponibilidade dos assets".

**Não verifiquei o mapper nem os assets nesta rodada.** Isso pertence à U06, não à U00. O que a U00 registra é: o documento continua sendo referência válida, e sua execução depende de assets do DS cuja existência não foi confirmada aqui.

### 5. `2026-08-13-client-delivery-readiness-remediation.md`

**Estado:** implementado, com registro de execução embutido.

O próprio arquivo carrega a seção "Registro de execução (2026-08-14)", com baseline auditada `c62edd99282af098ef369ed64f894007ee4f3083` e as decisões do responsável. Os commits correspondentes estão na história (`a0f648e ci: enforce executable source hygiene`, `8687cf9 fix(quality): make the hygiene gate trustworthy`, mais os três de refatoração por app), e o portão `scripts/quality/assert-client-hygiene.mjs` está no disco.

Confirma também o runtime oficial: Node 22 LTS e npm 10, que batem com o ambiente medido no baseline (Node `v22.23.2`, npm `10.9.8`).

## Recomendação que não é desta rodada

O acervo tem 90 documentos, dos quais uma família inteira se declara descartável. Arquivar a coorte superada de junho em `docs/plans/superados/`, ou removê-la, reduziria a chance de alguém executar um plano vencido. Isso é decisão do usuário e mudança rastreada; não foi feito aqui.
