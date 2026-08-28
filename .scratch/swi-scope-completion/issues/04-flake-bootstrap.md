# 04: Caracterizar o flake do bootstrap do backend

**What to build:** a falha intermitente do teste de bootstrap do backend deixa de ser folclore e vira número: com que frequência ela acontece, se acontece igual na suíte completa e no teste isolado, quanto tempo leva até estourar, e quais hipóteses de causa o código sustenta. Quem for corrigir (U00B) recebe um alvo medido em vez de um boato.

**Blocked by:** 03

**Status:** resolved

- [x] A suíte completa do backend foi executada pelo menos 10 vezes, com o resultado de cada execução registrado individualmente
- [x] O teste de bootstrap isolado foi executado o mesmo número de vezes, e os dois modos estão comparados lado a lado
- [x] A frequência de falha está registrada como fração das execuções, separadamente para cada modo
- [x] A mensagem de erro e o tempo até o timeout foram capturados ao menos uma vez, ou a ausência de falha está registrada como tal
- [x] Hipóteses de causa estão registradas com base no código, sem que nenhuma correção seja aplicada neste ticket

## Answer

Evidência em `baseline/02-flake-main-spec.md`.

**O flake não reproduziu: 33 execuções, quatro modos, zero falhas.**

| Modo                                | Falhas | Duração   |
| ----------------------------------- | -----: | --------- |
| Suíte completa, paralelo (8 workers) |   0/10 | 27s a 29s |
| Teste isolado                        |   0/10 | 7s a 9s   |
| Suíte completa, `--runInBand`        |   0/10 | 39s a 42s |
| Suíte completa, cache do Jest limpo  |    0/3 | 32s a 36s |

Fui além dos dois modos que o ticket pedia porque os dois primeiros não falharam: acrescentei a suíte serializada (que é o modo do `verify` e do gate do plano) e a suíte com cache limpo, esta última como teste dirigido da hipótese de custo de compilação. Nenhum reproduziu.

**A alegação do plano não tem lastro no repositório.** A única menção a `main.spec.ts` fora do plano de 2026-08-25 é `2026-08-05-source-delivery-hygiene.md:768`, e é só uma linha de comando, sem relato de falha.

**O teste é estruturalmente sólido, e isso é demonstrável.** No ambiente do teste a cadeia inteira de `bootstrap()` é de microtasks (`NestFactory.create` mockado, `applyCors` mockado, `listen` devolvendo `undefined`). Como `setImmediate` agenda macrotask, que só roda depois de a fila de microtasks drenar, uma volta basta por construção. A hipótese óbvia de corrida está eliminada.

**Risco residual real:** `await import('./main')` fica dentro do `it()` e puxa os 17 módulos mais o Prisma via ts-jest, tudo dentro do orçamento padrão de 5000 ms (não há `testTimeout` configurado). Nesta máquina, ociosa, a margem sobra. Sob contenção pesada, é estreita.

**Consequência para a U00B:** sua premissa de entrada ("aplicar o fluxo de diagnóstico à falha reproduzida no baseline") não se realizou. Não há falha para diagnosticar. A unidade precisa ser encerrada como não reproduzível ou reescopada como prevenção barata (`testTimeout` explícito, ou tirar o import de dentro do corpo do teste). Decisão do usuário, registrada no ticket 09.

## Comments

O plano é explícito em que "o teste isolado não serve como aceite" (U00B). Por isso a comparação entre os dois modos é o produto deste ticket, não um detalhe.

Se o flake não reproduzir em 10 execuções, isso é um resultado válido e deve ser registrado como tal, incluindo a possibilidade de a falha ser sensível a carga da máquina.

Encerramento (2026-08-28): com base nesta caracterização, o usuário decidiu encerrar a U00B sem mudança de código. BE-01 retirado como não reproduzível; registro durável na seção 4.1 do plano.
