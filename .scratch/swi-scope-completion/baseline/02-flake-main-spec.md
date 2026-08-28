# Baseline 02: Caracterização do flake de `swi-backend/src/main.spec.ts`

**Ticket:** 04: Caracterizar o flake do bootstrap do backend
**Commit-base:** `c93f02103075b8c432c8e9752f5837e41f42b3f7`
**Medido em:** 2026-08-25

## Resultado, em uma linha

**O flake não reproduziu. 33 execuções, quatro modos, zero falhas.**

## As medições

| Modo                                             | Execuções | Falhas | Duração por execução |
| ------------------------------------------------ | --------: | -----: | -------------------- |
| Suíte completa, `npm test` (paralelo, 8 workers)  |        10 |      0 | 27s a 29s            |
| Teste isolado, `npm test -- src/main.spec.ts`     |        10 |      0 | 7s a 9s              |
| Suíte completa, `npm test -- --runInBand`         |        10 |      0 | 39s a 42s            |
| Suíte completa com cache do Jest limpo antes      |         3 |      0 | 32s a 36s            |

Todas as execuções: `575 passed, 575 total`, exit 0. Nenhum `Exceeded timeout`, e `main.spec.ts` sempre em `PASS`.

**Frequência de falha medida:**

- suíte completa (paralelo): **0/10**
- teste isolado: **0/10**
- suíte completa serializada: **0/10**
- suíte completa com cache frio: **0/3**

## A alegação do plano não tem ocorrência documentada no repositório

A U00 pede para "reproduzir e registrar o timeout intermitente de `swi-backend/src/main.spec.ts`". Busquei a origem dessa afirmação em `docs/plans/*.md` e `docs/*.md`: a única menção ao arquivo fora do próprio plano de 2026-08-25 é `2026-08-05-source-delivery-hygiene.md:768`, e é apenas uma linha de comando listando o arquivo entre outros, sem relato de falha.

Ou seja: a intermitência é afirmada pelo plano, não está registrada em lugar nenhum, e não reproduz em 33 tentativas.

## Por que o teste é estruturalmente sólido

O teste faz:

```ts
await import('./main')
await new Promise(setImmediate) // deixa o bootstrap() flutuante terminar
```

`main.ts:31` termina com `void bootstrap()`, uma promessa flutuante. A preocupação natural seria: uma única volta de `setImmediate` basta para o `bootstrap()` chegar ao fim?

Lendo `main.ts`, no ambiente do teste a cadeia inteira é de **microtasks**:

- `parseRuntimeEnv(process.env)` é síncrono;
- `await NestFactory.create(AppModule)` está mockado como `async () => fakeApp`, então resolve em microtask;
- `applyCors(app)` está mockado;
- `await app.listen(...)` recebe um `jest.fn()` que devolve `undefined`, e `await undefined` também é microtask.

`setImmediate` agenda um macrotask na fase de *check*, que só roda depois de a fila de microtasks drenar por completo. Portanto uma volta é suficiente **por construção**, não por sorte. Isso elimina a hipótese mais óbvia de corrida.

## Onde o risco residual realmente está

Configuração efetiva do Jest no backend:

| Parâmetro        | Valor                                     |
| ---------------- | ----------------------------------------- |
| `testTimeout`    | `undefined`, ou seja, o padrão de 5000 ms  |
| `maxWorkers`     | 8 (a config declara `"50%"`)              |
| `cacheDirectory` | `C:\Users\Gabriel\AppData\Local\Temp\jest` |

O ponto sensível: `await import('./main')` acontece **dentro** do corpo do `it()`, e esse import puxa `./app.module`, que arrasta os 17 módulos do backend mais o cliente Prisma, tudo transpilado por `ts-jest`. O custo de compilar esse grafo é cobrado do orçamento de 5000 ms do teste.

Foi por isso que testei cache frio: se o custo de compilação fosse o gatilho, limpar o cache deveria provocar a falha. Não provocou. As execuções com cache limpo foram inclusive as mais rápidas da série (32s a 36s), o que indica que o cache de transpilação relevante não é o que `jest --clearCache` remove, e que a margem para os 5000 ms é confortável nesta máquina.

Hipóteses registradas para quem herdar isto, em ordem de plausibilidade decrescente:

1. **A falha é sensível a carga da máquina, não ao código.** Um `it()` que compila o grafo inteiro do app dentro de 5 s tem margem estreita sob contenção pesada (outro build rodando, outra suíte, CI compartilhado). Nesta máquina, ociosa, a margem sobra.
2. **A falha vinha de um commit anterior e já não existe.** O plano pode descrever um estado corrigido antes de `c93f021`. Não investiguei a história do arquivo, o que fica como caminho aberto.
3. **A falha nunca existiu como descrita** e o plano incorporou uma impressão não verificada.

Nenhuma correção foi aplicada. Nenhuma linha de código do backend foi tocada.

## Consequência direta para a U00B

A U00B está escrita assim: "Aplicar o fluxo de diagnóstico **à falha reproduzida no baseline**. Corrigir o defeito de produção, se existir, ou isolar relógio/recursos/concorrência se for flakiness."

**Não há falha reproduzida.** A premissa de entrada da U00B não se realizou. As opções honestas são:

- **Encerrar a U00B** registrando "não reproduzível em 33 execuções", e tratar a suíte como estável até que alguém apresente uma ocorrência real com log.
- **Reescopar a U00B** para uma medida preventiva barata e defensável: dar a `main.spec.ts` um `testTimeout` explícito e generoso, ou tirar o `await import('./main')` de dentro do corpo do teste, de modo que a compilação do grafo não dispute o orçamento de 5 s. Isso removeria a margem estreita da hipótese 1 sem fingir que houve defeito.

A segunda é a mais defensável, mas a escolha é do usuário: mexer numa suíte verde para prevenir uma falha nunca observada é decisão de custo, não de engenharia pura.

O aceite atual da U00B ("causa registrada e suíte completa repetidamente verde") está, na prática, já satisfeito na segunda metade: a suíte completa está repetidamente verde, 33 vezes.
