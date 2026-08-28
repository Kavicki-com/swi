# Baseline 00: Ambiente e ponto de partida

**Ticket:** 01: Fundação do baseline e registro de ambiente
**Coletado em:** 2026-08-25

## Ponto de partida

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Commit-base    | `c93f02103075b8c432c8e9752f5837e41f42b3f7`                            |
| Data do commit | `2026-08-24T10:01:48-03:00`                                           |
| Assunto        | Merge pull request #134 from Kavicki-com/feat/admin-excluir-relatorio  |
| Branch         | `main`                                                                |
| Worktree       | `C:/Users/Gabriel/Documents/SWI-mobile`                               |
| Node           | `v22.23.2`                                                            |
| npm            | `10.9.8`                                                              |
| SO             | Windows 10.0.19045.6466                                               |

O repositório principal está em `C:/Users/Gabriel/Documents/SWI`, na branch `feat/admin-real-maps-and-fixes`. Esta rodada roda no worktree `SWI-mobile`, em `main`. Comandos devem ser executados a partir do worktree, nunca do checkout principal.

## A árvore de trabalho não está limpa no commit-base

`git status --porcelain` no momento da coleta:

| Código | Caminho                                                       | Natureza                                        |
| ------ | ------------------------------------------------------------- | ----------------------------------------------- |
| ` M`   | `CLAUDE.md`                                                   | regras do projeto, modificado sem commit        |
| `??`   | `CONTEXT.md`                                                  | não versionado                                  |
| `??`   | `docs/adr/`                                                   | contém o ADR 0001 citado pela U11 do plano      |
| `??`   | `docs/agents/`                                                | contém as convenções citadas pelo CLAUDE.md     |
| `??`   | `docs/plans/2026-08-25-swi-conclusao-escopo-sem-smartband.md` | o próprio plano desta rodada                    |
| `??`   | `mobile/.agents/`                                             | skills vendorizadas                             |
| `??`   | `mobile/skills-lock.json`                                     | lock das skills                                 |
| `??`   | `output/`                                                     | artefatos locais                                |
| `??`   | `tmp/`                                                        | artefatos locais                                |
| `??`   | `.scratch/`                                                   | tracker local criado por esta rodada            |

**Consequência para o baseline:** o commit `c93f021` não contém o plano, o ADR nem as convenções de agentes. Quem fizer um checkout limpo desse commit não encontra esses arquivos. O baseline é reproduzível quanto a código de produto (os três projetos estão limpos no git), mas a documentação de governança desta rodada só existe no disco.

**Herdado por:** ticket 09, e decisão de commit pendente do usuário.

### Aparição posterior, não produzida por esta rodada

Ao fechar a U00, `git status` passou a listar também `docs/research/`, contendo `2026-08-25-wearables-custo-beneficio-swi.md` (carimbo de 09:26). Esse arquivo **não foi criado por esta rodada** e não estava presente na coleta inicial. Pelo tema, custo-benefício de wearables, ele toca diretamente a decisão de hardware que a matriz classifica como bloqueada por fornecedor.

Registrado aqui em vez de ignorado, porque o baseline precisa dizer a verdade sobre o que estava no disco. Não foi lido nem usado como evidência em nenhuma linha da matriz: a U00 só aceita código e teste como evidência.

## Scripts de gate realmente disponíveis

Levantado lendo os `package.json`, não o plano.

### mobile

| Script             | Existe  | Comando                                                  |
| ------------------ | ------- | -------------------------------------------------------- |
| `lint`             | sim     | `eslint . --max-warnings=0`                              |
| `typecheck`        | sim     | `tsc --noEmit`                                           |
| `test`             | sim     | `jest`                                                   |
| `test:coverage`    | sim     | `jest --coverage --runInBand`                            |
| `build`            | **não** | usa `build:all`                                          |
| `build:all`        | sim     | `expo export --platform all`                             |
| `verify`           | sim     | `lint && typecheck && test -- --runInBand && build:all`  |
| `test:e2e:managed` | sim     | `node ../scripts/e2e/run-test-stack.mjs --target mobile` |

### swi-admin

| Script             | Existe  | Comando                                                  |
| ------------------ | ------- | -------------------------------------------------------- |
| `lint`             | sim     | `eslint src --ext .ts,.tsx --max-warnings=0`             |
| `typecheck`        | sim     | `tsc --noEmit`                                           |
| `test`             | sim     | `vitest run`                                             |
| `test:coverage`    | **não** | ausente; é o objeto do ticket 02                         |
| `build`            | sim     | `tsc -b && vite build`                                   |
| `verify`           | **não** | admin não tem gate agregado como os outros dois          |
| `test:e2e:managed` | sim     | `node ../scripts/e2e/run-test-stack.mjs --target admin`  |
| `gate:file-size`   | sim     | `node ../scripts/quality/assert-file-size.mjs --dir src` |

### swi-backend

| Script             | Existe | Comando                                                   |
| ------------------ | ------ | --------------------------------------------------------- |
| `lint`             | sim    | `eslint src test prisma --max-warnings=0`                 |
| `typecheck`        | sim    | `tsc --noEmit -p tsconfig.json`                           |
| `test`             | sim    | `jest`                                                    |
| `test:coverage`    | sim    | `jest --coverage --runInBand`                             |
| `build`            | sim    | `nest build`                                              |
| `verify`           | sim    | `lint && typecheck && test -- --runInBand && build`       |
| `test:e2e:managed` | sim    | `node ../scripts/e2e/run-test-stack.mjs --target backend` |

## Divergências entre o plano e os comandos que existem

1. **`swi-admin` não tem `test:coverage`.** O plano já previu isso na seção 7 e delegou a criação ao primeiro ticket que executar o gate. Resolvido pelo ticket 02.
2. **`swi-admin` não tem `verify`.** O plano lista os comandos do admin um a um justamente por isso. Não é lacuna, é assimetria a registrar.
3. **`mobile` não tem `build`, tem `build:all`.** O bloco do mobile no plano usa `npm run verify`, que já encadeia `build:all`. Sem impacto.
4. **`test:coverage -- --runInBand` é redundante** no mobile e no backend: os dois scripts já trazem `--runInBand` embutido. O argumento extra não quebra, apenas repete.

## Escopo do gate nesta unidade

A U00 pede "lint, tipos, testes, cobertura e builds dos três projetos". Não pede E2E. `test:e2e:managed` fica reservado para as unidades que cruzam aplicações e para o gate integrado (U17); não é executado no ticket 03.
