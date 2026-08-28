# Baseline 01: Saída dos gates dos três projetos

**Tickets:** 02 (cobertura do admin) e 03 (baseline dos três projetos)
**Commit-base:** `c93f02103075b8c432c8e9752f5837e41f42b3f7`
**Executado em:** 2026-08-25
**Escopo:** lint, tipos, testes, cobertura e build. E2E não faz parte da U00.

## Resumo

| Projeto       | lint | typecheck | testes | cobertura | build           |
| ------------- | ---- | --------- | ------ | --------- | --------------- |
| `swi-admin`   | ok   | ok        | ok     | ok        | ok              |
| `swi-backend` | ok   | ok        | ok     | ok        | ok              |
| `mobile`      | ok   | ok        | ok     | ok        | intermitente    |

Uma única falha em todo o baseline: o build do mobile. Detalhada abaixo.

## swi-admin

| Comando                 | Exit | Duração |
| ----------------------- | ---- | ------- |
| `npm run lint`          | 0    | 47s     |
| `npm run typecheck`     | 0    | 15s     |
| `npm run test:coverage` | 0    | 67s     |
| `npm run build`         | 0    | 21s     |

Suíte: 91 arquivos de teste, 978 testes, todos passando (55,99s de execução interna).

Cobertura (provider istanbul, limiar de 80% nas quatro métricas):

| Métrica    | Cobertura | Absoluto  | Folga sobre o limiar |
| ---------- | --------- | --------- | -------------------- |
| statements | 88,72%    | 3840/4328 | +8,72                |
| branches   | 81,66%    | 2173/2661 | +1,66                |
| functions  | 82,59%    | 1011/1224 | +2,59                |
| lines      | 91,18%    | 3465/3800 | +11,18               |

`branches` é a métrica mais apertada. Qualquer módulo novo sem teste de condição derruba o gate.

O build emite aviso de chunk grande: `maplibre-gl` sai com 1.053,94 kB (284,94 kB gzip). É aviso, não erro, mas fica registrado porque toca o desempenho de carregamento do painel.

## swi-backend

| Comando                 | Exit | Duração |
| ----------------------- | ---- | ------- |
| `npm run lint`          | 0    | 34s     |
| `npm run typecheck`     | 0    | 6s      |
| `npm run test:coverage` | 0    | 50s     |
| `npm run build`         | 0    | 17s     |

Suíte: 55 suítes, 575 testes, todos passando (48,34s de execução interna).

| Métrica    | Cobertura |
| ---------- | --------- |
| statements | 95,65%    |
| branches   | 83,64%    |
| functions  | 90,84%    |
| lines      | 96,76%    |

Nenhum timeout, nenhuma falha nesta execução. O flake de `src/main.spec.ts` não apareceu aqui; sua caracterização é o ticket 04.

## mobile

| Comando                 | Exit    | Duração | Observação                     |
| ----------------------- | ------- | ------- | ------------------------------ |
| `npm run lint`          | 0       | 40s     |                                |
| `npm run typecheck`     | 0       | 28s     |                                |
| `npm run test:coverage` | 0       | 66s     |                                |
| `npm run build:all`     | **134** | 194s    | primeira execução, cache frio  |
| `npm run build:all`     | 0       | 47s     | segunda execução, cache quente |

Suíte: 106 suítes, 915 testes, todos passando (63,28s de execução interna).

| Métrica    | Cobertura |
| ---------- | --------- |
| statements | 85,59%    |
| branches   | 82,41%    |
| functions  | 81,20%    |
| lines      | 86,58%    |

### Falha conhecida MB-01: `expo export` estoura a heap com cache frio

**Comando:** `cd mobile && npm run build:all` (`expo export --platform all`)
**Frequência observada:** 1 falha em 2 execuções. A falha ocorreu na execução de cache frio; a repetição imediata, com cache Metro quente, passou.
**Exit:** 134
**Erro:** `FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed - JavaScript heap out of memory`

Momento exato da falha: depois de os quatro bundles terminarem.

```
iOS Bundled 91163ms  ... (2394 modules)
Android Bundled 103198ms ... (2390 modules)
Bundled 54055ms  render.js (1732 modules)
Web Bundled 54914ms ... (1489 modules)
<--- Last few GCs --->
... 873.5 (905.0) -> 863.2 (909.7) MB ... allocation failure
FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed
```

**Detalhe que desmente o diagnóstico reflexo:** o processo morreu com cerca de 873 MB de heap usada, contra um limite padrão de 4144 MB nesta máquina. O estouro é em `NewSpace` (geração jovem), não em old space. Portanto `--max-old-space-size` não é obviamente o remédio, e tratar isso como "falta de heap" seria conclusão apressada. A hipótese mais compatível com a evidência é pressão de memória do sistema no momento de escrever o export, agravada pelos quatro bundles retidos ao mesmo tempo.

**Impacto na sequência:** `npm run verify` do mobile encadeia `build:all`. Enquanto MB-01 existir, o gate agregado do mobile é intermitente, e o gate integrado da U17 herda essa intermitência.

**Herdado por:** ainda sem dono. Não pertence à U00B, que trata da suíte do backend. Precisa de ticket próprio antes da U17.

## O que este baseline não mediu

- `test:e2e:managed` dos três projetos: fora do escopo da U00, exige a pilha de teste de pé.
- `storybook:build` do admin: não está no gate do plano.
- `gate:file-size` do admin: existe no `package.json`, não está no gate do plano.

Registrado para que ninguém leia "baseline verde" como "tudo verificado".
