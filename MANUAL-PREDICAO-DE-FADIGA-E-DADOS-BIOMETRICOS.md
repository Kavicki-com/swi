# Manual de operação: predição de fadiga e tratamento dos dados biométricos

Este manual descreve como o SWI transforma as leituras do relógio em esforço, desgaste e estimativa de tempo até a fadiga, como abre e encerra alertas de saúde, e como guarda, expõe e apaga os dados biométricos dos funcionários. É escrito para a equipe técnica que vai operar, auditar ou calibrar o sistema.

Tudo o que está aqui corresponde ao código deste repositório. Quando um parâmetro é citado, o arquivo onde ele mora vem junto, para que qualquer número possa ser conferido na fonte. Os caminhos são relativos à raiz do repositório.

> **Natureza do modelo.** Esforço, desgaste e tempo até a fadiga são **estimativas experimentais**. Não são diagnóstico médico, não são limite ocupacional homologado e não autorizam nem proíbem jornada. Os coeficientes foram escolhidos com base em literatura de fisiologia do exercício e em cenários simulados, e ainda não foram calibrados com dados do dispositivo da contratante. A seção 5 descreve como fazer essa calibração.

## Sumário

1. [A cadeia de telemetria](#1-a-cadeia-de-telemetria)
2. [Entradas do algoritmo](#2-entradas-do-algoritmo)
3. [A fórmula de esforço e desgaste](#3-a-fórmula-de-esforço-e-desgaste)
4. [Limiares e ciclo dos alertas](#4-limiares-e-ciclo-dos-alertas)
5. [Estimativa, medição e calibração](#5-estimativa-medição-e-calibração)
6. [Tratamento dos dados biométricos](#6-tratamento-dos-dados-biométricos)
7. [Limitações conhecidas](#7-limitações-conhecidas)
8. [Referência rápida de parâmetros](#8-referência-rápida-de-parâmetros)

---

## 1. A cadeia de telemetria

O caminho de uma leitura, do pulso do funcionário até a tela do painel, tem seis etapas.

```
Apple Watch ──► iPhone (app SWI) ──► POST /telemetry/v1/batches ──► amostra gravada
                                                                       │
                                     ┌─────────────────────────────────┤
                                     ▼                                 ▼
                           snapshot do funcionário          avaliação (esforço/desgaste)
                                                                       │
                                                                       ▼
                                                            condições e alertas
                                                                       │
                                                                       ▼
                                                    leitura pelo app e pelo painel
```

### 1.1 Pareamento (enrolamento) do dispositivo

Código: `swi-backend/src/telemetry/devices/`.

1. Um administrador gera um código de pareamento para um funcionário (`POST /telemetry/v1/devices/enrollments`, só papel ADMIN). O código tem seis dígitos, vale **10 minutos** (`ENROLLMENT_TTL_MIN` em `device-auth.service.ts`) e é devolvido em claro **uma única vez**. O banco guarda apenas o hash.
2. O funcionário, autenticado no app do iPhone com a própria conta, digita o código (`POST /telemetry/v1/devices/enrollments/complete`). O servidor confere que o código pertence a ele, que não expirou e que não foi usado.
3. O servidor emite uma credencial de dispositivo (32 bytes aleatórios). O aparelho guarda a credencial; o banco guarda só o hash dela.
4. A partir daí o aparelho envia telemetria com essa credencial, sem token de pessoa. O funcionário e o dispositivo de cada leitura **saem da credencial**, nunca do conteúdo enviado: um evento que traga `workerId` é recusado inteiro.
5. O administrador pode revogar o dispositivo a qualquer momento (`POST /telemetry/v1/devices/:id/revoke`).

As duas rotas de pareamento têm limite de 5 chamadas por minuto, para impedir que alguém tente adivinhar códigos.

### 1.2 Ingestão em lote, idempotente

Código: `swi-backend/src/telemetry/ingestion/` e `swi-backend/src/telemetry/persistence/`.

O relógio produz um evento a cada entrega de dados da sessão de treino do HealthKit, em cadência típica de 5 segundos. O iPhone recebe os eventos, guarda numa fila durável no aparelho e os envia ao servidor em `POST /telemetry/v1/batches`.

- Cada lote tem de **1 a 200 eventos** (`MAX_BATCH_EVENTS` em `ingestion/dto/telemetry-batch.dto.ts`). Backlog maior vai em várias páginas.
- Cada evento traz `eventId` (UUID), `monitoringSessionId` (UUID), `sequence`, `eventTime` (quando o relógio mediu), `origin` (`REAL` ou `DEMO`) e `measurements`.
- A resposta é um reconhecimento **por evento**: aceito, repetido ou recusado.
- **Idempotência.** O `eventId` é único no banco. Reenviar o mesmo evento com o mesmo conteúdo devolve "repetido" e não grava nada. Reenviar o mesmo `eventId` com conteúdo diferente, ou ocupar uma `sequence` já usada na sessão, é recusado: a amostra é imutável e nunca é sobrescrita. A comparação usa um hash do conteúdo (`payloadHash`).
- Toda medição passa por três conferências: unidade esperada, origem permitida e faixa plausível (`validateRawMeasurement` em `domain/metric-state.ts`). Valor fora da faixa é recusado, nunca corrigido. Chave de medição desconhecida também é recusa, para que nenhuma medição seja confirmada sem ter sido gravada.
- Um `eventTime` mais de **2 minutos no futuro** em relação ao relógio do servidor é recusado (`CLOCK_SKEW_MS`).
- A rota aceita até 600 chamadas por minuto, porque vários aparelhos de uma obra podem sair pelo mesmo IP.

**Idade do evento.** O servidor classifica cada evento pela idade (`EVENT_AGE` em `domain/metric-state.ts`):

| Idade do `eventTime` | Classe | O que acontece |
| --- | --- | --- |
| até 120 s | ao vivo | grava, atualiza o snapshot, dispara avaliação e condições |
| de 120 s a 48 h | backlog | grava no histórico, não mexe no estado atual, não avalia |
| acima de 48 h | histórico | grava no histórico, não mexe no estado atual, não avalia |

Medições avulsas lidas do app Saúde pelo iPhone (pressão arterial e temperatura corporal) têm regra própria: atualizam a "última medição" em qualquer idade, se forem mais novas que a gravada, e disparam apenas a avaliação de pressão.

### 1.3 Sessão de monitoramento

Não existe rota para "iniciar monitoramento". Quem nomeia a sessão é o relógio: o identificador chega no primeiro evento, e o servidor abre a sessão ao vê-la pela primeira vez, com o funcionário e o dispositivo da credencial. A sessão fixa a sua origem (`REAL` ou `DEMO`) no primeiro evento, e eventos de origem diferente na mesma sessão são recusados. Uma sessão de outro aparelho é recusada com a mesma resposta de uma sessão inexistente.

Cada reconexão do relógio pode criar sessão nova. A cadeia de esforço e desgaste é **por sessão** (seção 3.6); as condições de alerta são **por funcionário e origem** e sobrevivem à troca de sessão.

### 1.4 Snapshot

Código: `persistence/prisma-telemetry.repository.ts`, tabela `TelemetrySnapshot`.

Cada funcionário tem uma única linha de snapshot com o último valor conhecido de cada medição e o instante em que foi medido. Só evento **ao vivo** e **mais recente** que o já promovido atualiza o snapshot; backlog nunca o sobrescreve. É dessa linha que sai o estado "agora" do funcionário.

### 1.5 Avaliação

Depois de gravar o lote, a ingestão roda, para cada sessão que recebeu evento ao vivo, duas etapas em transações separadas:

1. **Avaliação de esforço e desgaste** (`assessment/assessment.service.ts`), no máximo **uma a cada 15 segundos por sessão** (`ASSESSMENT_THROTTLE_MS`). Ela grava uma linha em `TelemetryAssessment` (seção 3).
2. **Avaliação de condições** (`alerts/condition.service.ts`), que abre ou recupera condições e, quando cabe, cria alertas (seção 4).

Falha numa das duas não impede a outra, e nenhuma delas derruba o reconhecimento do lote: o evento já está gravado.

### 1.6 Leitura

Código: `swi-backend/src/telemetry/read-model/`.

| Rota | Quem | O que devolve |
| --- | --- | --- |
| `GET /telemetry/v1/me/current` | o próprio funcionário | estado atual dele |
| `GET /telemetry/v1/me/series` | o próprio funcionário | série por período |
| `GET /telemetry/v1/workers/:id/current` | ADMIN da mesma empresa | estado atual do funcionário |
| `GET /telemetry/v1/workers/:id/series` | ADMIN da mesma empresa | série por período |
| `GET /telemetry/v1/admin/summary` | ADMIN | resumo do painel da empresa |
| `GET /telemetry/v1/admin/workers` | ADMIN | lista de funcionários monitorados |
| `GET /telemetry/v1/sessions/:id/history` | dono da sessão ou ADMIN da mesma empresa | trilha de auditoria da sessão (até 500 itens por página) |
| `GET /telemetry/v1/admin/alerts` | ADMIN | fila de alertas da empresa |

Cada valor sai com **qualidade** (`CURRENT`, `STALE` ou `UNAVAILABLE`), instante da medição e origem, decididos pelo servidor contra os prazos de atualidade (`FRESHNESS` em `domain/metric-state.ts`):

| Grupo | Atual até | Desatualizado até | Depois |
| --- | --- | --- | --- |
| Batimento, passos, distância, movimento, energia, esforço, desgaste, tempo até a fadiga | 45 s | 120 s | indisponível, com o último valor e o horário visíveis |
| Bateria do relógio | 5 min | 30 min | indisponível, com o último valor visível |
| Pressão, oxigenação, temperatura corporal | 24 h | 72 h | o valor some ("sem medição recente") |

Além da consulta, o servidor envia avisos por socket ao funcionário e aos administradores ativos da empresa dele quando o estado muda. O aviso só leva identificadores; os valores são sempre buscados pela leitura, que confere o acesso a cada pedido.

---

## 2. Entradas do algoritmo

### 2.1 O que o relógio e o iPhone enviam

Cada evento pode trazer qualquer subconjunto das medições abaixo (`RAW_MEASUREMENTS` em `domain/metric-state.ts`). Um evento sem medição nenhuma é recusado.

| Chave no evento | Unidade | Origem aceita | Faixa aceita | Frequência | Entra na fórmula |
| --- | --- | --- | --- | --- | --- |
| `heartRate` | bpm | `APPLE_WATCH` | 20 a 300 | a cada evento com leitura (cerca de 5 s) | **sim, entrada principal** |
| `motionCount` | contagem | `APPLE_WATCH` | 0 a 100 000 | a cada evento, desde o anterior | **sim, entrada secundária** |
| `stepDelta` | passos | `APPLE_WATCH` | inteiro ≥ 0 | a cada evento, desde o anterior | não |
| `distanceDeltaM` | m | `APPLE_WATCH` | ≥ 0 | a cada evento, desde o anterior | não |
| `activeEnergyKcal` | kcal | `APPLE_WATCH` | 0 a 100 000 | a cada evento, desde o anterior | não |
| `battery` | % | `APPLE_WATCH` | 0 a 100 | a cada 3 minutos | não |
| `oxygenSaturation` | % | `APPLE_WATCH` | 0 a 100 | quando o relógio mede em repouso (poucas vezes por turno) | não |
| `bloodPressure` | mmHg (par) | `EXTERNAL_CUFF`, `MANUAL_HEALTHKIT`, `MANUAL_SWI` | sistólica 60 a 260, diastólica 30 a 200, sistólica > diastólica | avulsa | não |
| `bodyTemperature` | °C | `MANUAL_HEALTHKIT` | 30 a 45 | avulsa | não |

`motionCount`, `stepDelta`, `distanceDeltaM` e `activeEnergyKcal` são **variação desde o evento anterior** da mesma sessão, não acumulado. O servidor soma as variações. Zero picos de movimento num intervalo é contagem (repouso), não ausência.

**Contagem de movimento.** O relógio lê a aceleração do usuário (com a gravidade já removida pelo sistema) a 20 Hz e conta um pico cada vez que a aceleração passa de **0,3 g**, com intervalo mínimo de 0,25 s entre picos (`MotionProfile` em `mobile/targets/watch/MotionCounter.swift`). Sem acelerômetro disponível o campo não é enviado; a cadência de passos não substitui movimento.

**Medições avulsas do app Saúde.** O iPhone consulta o app Saúde no máximo uma vez por minuto e envia as medições de pressão e temperatura registradas nas **últimas 72 horas** (`HEALTH_READING_WINDOW_MS` em `mobile/services/telemetry/healthReadings.ts`), com o horário em que foram medidas.

### 2.2 Dados de cadastro e de histórico usados pela fórmula

| Entrada | De onde vem | Quando falta |
| --- | --- | --- |
| Repouso observado | Mediana dos menores batimentos diários (`heartRateMin`) dos últimos **14 dias terminados** do próprio funcionário, da mesma origem, tirada do Resumo do dia, definitivo ou provisório de um dia que já passou da meia-noite (`restingFromDailyMinima` em `assessment/assessment-baseline.ts`) | entra o **repouso provisório** descrito abaixo, e a avaliação fica marcada como estimativa |
| Frequência cardíaca máxima | Estimada pela idade: **208 − 0,7 × idade** (Tanaka, Monahan e Seals, 2001). A idade sai da data de nascimento do perfil (`maxHeartRateForAge`) | indisponível com o motivo `no_birth_date` |

A máxima não tem valor padrão: sem data de nascimento o sistema grava a avaliação com percentuais nulos e o motivo, em vez de inventar um número. O repouso tem um provisório, marcado como tal, para o painel não ficar vazio no primeiro dia.

Consequência prática: um funcionário recém-pareado já tem esforço e desgaste desde o primeiro uso, com um **repouso provisório** enquanto não existe dia terminado com batimento. O provisório é o menor batimento plausível já visto da pessoa (no Resumo provisório do dia em andamento ou na própria sessão), limitado a um teto de 70 bpm e a um chão de 40 bpm, o mesmo do alerta de batimento baixo. Cada avaliação registra de onde veio o repouso (`baselineSource`, MEASURED ou PROVISIONAL), e o painel marca a estimativa. O repouso medido substitui o provisório assim que o primeiro dia de uso termina: a rodada de resumo parcial, a cada 30 minutos, resume como Resumo provisório os dias ainda não fechados, e o Resumo provisório de um dia que já passou da meia-noite (dia civil no horário de Brasília) conta como medido, refeito a cada rodada enquanto chegar leitura atrasada, até o dia fechar 48 horas depois e o Resumo definitivo o substituir pela mesma chave (seção 6.3). Só o dia em andamento fica fora da mediana, porque o mínimo dele ainda cai conforme o dia passa. Na prática, o repouso medido chega na manhã seguinte ao primeiro dia de uso, e o selo de estimativa aparece só nesse primeiro dia.

### 2.3 Dado sintético: a origem `DEMO`

Toda leitura, sessão, avaliação, condição, alerta e Resumo do dia carrega a coluna `origin`, com valor `REAL` ou `DEMO`. É a marcação de dado sintético do sistema:

- Dados `DEMO` são gerados apenas pela ferramenta de homologação `swi-backend/scripts/qa/inject-demo-telemetry.ts`, que é inerte em produção por código e exige `NODE_ENV=development` e `QA_DEMO_TELEMETRY=1`.
- Origens nunca se misturam: a sessão fixa a origem, o repouso observado é calculado só com Resumos da mesma origem, e as condições são chaveadas por funcionário **e** origem.
- Alertas de origem `DEMO` não aparecem na fila de produção, a menos que a variável `TELEMETRY_ALERTS_INCLUDE_DEMO=1` esteja ligada (só homologação). Condições `DEMO` nunca geram notificação.
- O painel e o app exibem o selo **"Dados de demonstração"** sempre que o estado exibido vem de origem `DEMO`.

---

## 3. A fórmula de esforço e desgaste

Código: `swi-backend/src/telemetry/assessment/fatigue-formula.ts` (a conta, pura) e `assessment-profile.ts` (os coeficientes). Versão do perfil: **`swi-fatigue-experimental-1`**.

A ideia em duas frases: o **esforço** é a fração da reserva cardíaca que a pessoa está usando agora, e volta em minutos quando ela para. O **desgaste** é uma dose que sobe enquanto há esforço e desce sozinha com o tempo, e volta em horas. Alguém pode estar descansando agora e ainda estar desgastado.

### 3.1 Passo a passo, para cada amostra

Seja `dt` o intervalo, em minutos, entre a amostra atual e a anterior.

**Passo 1. Reserva de frequência cardíaca (HRR).**

```
reserva = max(1, máxima − repouso)
hrr     = limita((bpm − repouso) / reserva, 0, 1,2)
```

O teto de 1,2 cobre o caso em que a máxima estimada pela idade está abaixo da real da pessoa. Não é faixa de operação.

**Passo 2. Intensidade instantânea.**

Com contagem de movimento na amostra:

```
picos_por_minuto = motionCount / dt
movimento        = limita(picos_por_minuto / 90, 0, 1,2)
intensidade      = limita(0,75 × hrr + 0,25 × movimento, 0, 1,2)
```

Sem contagem de movimento, `intensidade = hrr`.

**Passo 3. Esforço: média móvel exponencial da intensidade.**

```
alfa    = 1 − (1 − 0,35)^(dt_segundos / 15)
esforço = esforço_anterior + alfa × (intensidade − esforço_anterior)
esforço % = arredonda(100 × limita(esforço, 0, 1))
```

O alfa de 0,35 é definido para amostras a cada 15 segundos e ajustado ao intervalo real. Com amostras a cada 5 segundos, o alfa efetivo é cerca de 0,134, de modo que três amostras em 15 segundos pesam o mesmo que uma amostra de 15 segundos.

**Passo 4. Dose de desgaste.**

```
dose = dose × exp(−dt / 180)                     (decaimento, sempre pelo tempo real)
dose = dose + intensidade^1,6 × dt               (acréscimo, só se o intervalo ≤ 120 s)
```

O decaimento de 180 minutos dá meia-vida de cerca de 125 minutos: em repouso, a dose cai pela metade em pouco mais de duas horas. O expoente 1,6 faz intensidade alta pesar mais que moderada. O acréscimo só conta intervalos de até 120 segundos: lacuna de sinal nunca vira esforço, mas a dose continua decaindo enquanto o relógio está mudo.

**Passo 5. Desgaste em percentual.**

```
desgaste % = arredonda(100 × (1 − exp(−dose / 120)))
```

A curva satura sozinha em 100. A escala 120 é a dose que corresponde a cerca de 63% de desgaste.

### 3.2 Exemplo numérico

Funcionário de 35 anos (máxima 183,5 bpm), repouso observado de 62 bpm, batimento de 118 bpm e 54 picos de movimento por minuto:

- `hrr = (118 − 62) / (183,5 − 62) = 0,461`
- `movimento = 54 / 90 = 0,600`
- `intensidade = 0,75 × 0,461 + 0,25 × 0,600 = 0,496`
- esforço sustentado nessa intensidade: cerca de **50%**
- cada minuto nessa intensidade acrescenta `0,496^1,6 ≈ 0,325` à dose, que ao mesmo tempo decai

### 3.3 Leitura ausente

| Situação | Comportamento |
| --- | --- |
| Amostra sem batimento, mas com batimento anterior de até **45 s** | reaproveita o último batimento e registra `reusedHeartRate = true` |
| Sem batimento há mais de 45 s | não acrescenta dose nem atualiza o esforço; a dose só decai |
| Janela inteira sem batimento | esforço e tempo até a fadiga nulos, motivo `no_heart_rate`; o desgaste continua calculado a partir da dose que decai |
| Sem movimento | intensidade igual à HRR; registra `motionAvailable = false` |
| Sem repouso observado ou sem data de nascimento | esforço, desgaste e tempo até a fadiga nulos, com o motivo; a dose não acumula |

Oxigenação, pressão arterial e temperatura **não entram** na fórmula.

### 3.4 O papel do repouso observado

O repouso é o ponto zero da escala de esforço. Ele não é medido em repouso clínico: é o piso que o próprio monitoramento observou nos últimos 14 dias fechados, pela mediana dos mínimos diários. A mediana resiste a um dia atípico.

Como o mínimo de um dia de trabalho tende a ser mais alto que o repouso verdadeiro, o repouso observado tende a ficar acima do real, e o esforço tende a ser **subestimado**. Esse é um dos pontos que a calibração deve medir (seção 5.3).

O repouso observado e a máxima por idade também personalizam o limiar de batimento das condições de alerta (seção 4.2).

### 3.5 Tempo até a fadiga

O tempo até a fadiga (`fatigueEtaMin`) responde à pergunta: **mantida a intensidade recente, em quantos minutos o desgaste chega ao limiar do alerta de desgaste alto (80%)?** É o número que o painel exibe como tempo até a fadiga. Ele não é um "tempo seguro de trabalho" homologado; é uma projeção do próprio modelo experimental.

Com intensidade constante `I`, a dose obedece `dD/dt = I^1,6 − D/180` e tende ao equilíbrio `D_eq = 180 × I^1,6`. A solução tem forma fechada, e o tempo até a dose cruzar o alvo `D*` é:

```
D*      = −120 × ln(1 − 79,5 / 100) ≈ 190,2      (a menor dose cujo desgaste arredonda para 80%)
D_eq    = 180 × limita(esforço_médio, 0, 1,2)^1,6
minutos = 180 × ln((D_eq − D_atual) / (D_eq − D*))
```

A intensidade usada é a média móvel do esforço (passo 3), não a amostra isolada. Regras de saída (`fatigueEtaMinutes` em `fatigue-formula.ts`):

| Situação | Resultado |
| --- | --- |
| dose atual já no alvo ou acima | `0` (a chegada é agora) |
| `D_eq ≤ D*`: a intensidade recente nunca leva ao alvo | nulo; o painel diz "Sem previsão de fadiga no ritmo atual" |
| chegada além de **480 minutos** (um turno de 8 h, `fatigueEtaHorizonMinutes`) | nulo |
| janela sem batimento | nulo |
| caso contrário | minutos arredondados |

No perfil atual, o alvo só é alcançável com intensidade média sustentada acima de cerca de **1,035**, ou seja, acima da máxima prevista pela idade. Na prática a estimativa costuma ser nula e só aparece em esforço extremo e prolongado. Isso é consequência direta dos coeficientes experimentais e é um dos pontos a revisar na calibração.

### 3.6 A cadeia por sessão

A dose depende do valor anterior. Em vez de recalcular o turno inteiro a cada avaliação, o serviço encadeia: cada linha de `TelemetryAssessment` grava, no campo JSON `inputs`, o estado que recebeu e o estado que devolveu (`strainDose`, média do esforço, último batimento, instante da última amostra), e a próxima avaliação da mesma sessão parte dali.

- A cadeia **reinicia** (dose zero) na primeira avaliação de uma sessão, quando a versão da fórmula muda, ou quando o estado gravado não pode ser lido. O motivo fica registrado (`first_of_session`, `version_changed`, `state_unreadable`).
- A primeira janela de uma cadeia olha no máximo **120 segundos** para trás (`chainLookbackMs`). O mesmo teto vale para continuações: se a sessão ficou parada, o intervalo pulado é registrado em `window.skippedMs` e não é reconstruído.
- Uma trava na linha da sessão (`FOR NO KEY UPDATE`) garante que dois lotes simultâneos da mesma sessão não bifurquem a cadeia.
- A cadeia atravessa a meia-noite; o Resumo do dia fatia por instante da avaliação.

Cada avaliação grava, além dos percentuais: o perfil inteiro de coeficientes, a linha de base usada (repouso, número de dias, idade, máxima), o limiar de desgaste contra o qual o tempo até a fadiga foi calculado, a contagem de amostras da janela, e as marcas `motionAvailable` e `reusedHeartRate`. Com isso, qualquer número exibido pode ser reproduzido a partir da própria linha enquanto ela existir.

---

## 4. Limiares e ciclo dos alertas

Código: `swi-backend/src/telemetry/alerts/`. Versão do perfil de alertas: **`swi-alert-experimental-2`** (`alert-profile.ts`).

O sistema separa duas coisas:

- **Condição** (`TelemetryCondition`): o que o corpo ou o aparelho está fazendo agora. Abre e recupera sozinha, pela regra.
- **Alerta operacional** (`OperationalAlert`): um item na fila do painel dizendo que uma pessoa precisa olhar. Só fecha pela mão de um administrador.

### 4.1 Tipos de condição

| Condição | Abre quando | Recupera quando | Vira alerta na fila | Categoria |
| --- | --- | --- | --- | --- |
| `HEART_RATE_HIGH` | todo batimento da última janela de 60 s ≥ limite alto | todo batimento da janela < limite − 10 bpm | sim | urgente |
| `HEART_RATE_LOW` | todo batimento da última janela de 60 s ≤ limite baixo | todo batimento da janela > limite + 10 bpm | sim | urgente |
| `WEAR_HIGH` | desgaste da última avaliação da sessão ≥ **80%** | desgaste < **70%** | sim | saúde |
| `BLOOD_PRESSURE_REVIEW` | última medição de pressão com sistólica ≥ **140** ou diastólica ≥ **90** mmHg | nova medição com sistólica < 130 **e** diastólica < 85 | sim | saúde |
| `DEVICE_BATTERY_LOW` | bateria ≤ **15%** | bateria > **25%** | não | aparelho |
| `DEVICE_SIGNAL_LOST` | relógio calado há mais de **120 s** e há no máximo **8 h** | qualquer evento ao vivo do relógio | não | aparelho |

A faixa entre abrir e recuperar (histerese) evita que uma leitura oscilando em torno do limite abra e feche a condição a cada evento.

### 4.2 Limites de batimento

Os limites de batimento são personalizados quando há dado, e caem num piso quando não há (`heartRateLimits` em `condition-engine.ts`):

| Limite | Personalizado | Piso (sem dado) |
| --- | --- | --- |
| Alto | 90% da máxima por idade, arredondado | 180 bpm, quando não há data de nascimento |
| Baixo | repouso observado − 15 bpm, arredondado | 40 bpm, quando não há repouso observado, quando o personalizado fica abaixo de 40, ou quando ele alcançaria o limite alto |

Cada condição grava a regra usada (`PERSONALIZED` ou `FLOOR`), o limite em vigor e o valor observado que a abriu, junto da versão do perfil.

**Persistência.** Para o batimento, "contínuo" tem três exigências simultâneas dentro da janela de 60 s (`persistence`): todas as leituras do lado errado do limite, a primeira e a última separadas por pelo menos 45 s, e nenhum vão maior que 15 s entre leituras consecutivas. Uma única leitura do outro lado zera a evidência. Desgaste, bateria e pressão abrem com uma leitura, porque a persistência já está embutida na própria medida (o desgaste é uma dose acumulada; a bateria cai de forma monótona; a pressão é medida à mão).

**Temperatura corporal e oxigenação** não abrem condição nem alerta.

### 4.3 Ciclo da condição

```
            regra cumprida                       regra de recuperação cumprida
  (nada) ─────────────────► ACTIVE ─────────────────────────────────────────► RECOVERED
                              │                                 (motivo NORMALIZED)
                              │  relógio calado > 120 s
                              └───────────────────────────────────────────────► RECOVERED
                                                                (motivo SIGNAL_LOST)
```

- Só existe uma condição ativa por funcionário, tipo e origem (índice único no banco).
- Uma condição só abre a partir de evento **ao vivo**. Backlog nunca abre nem recupera condição.
- A varredura de silêncio roda a cada **30 segundos** (`condition-sweep.job.ts`, configurável por `TELEMETRY_CONDITION_SWEEP_CRON`). Quando um relógio está calado há mais de 120 s, ela recupera as condições que dependem do relógio (batimento, bateria, desgaste) com o motivo `SIGNAL_LOST`, porque valor que ninguém mede não sustenta condição, e abre `DEVICE_SIGNAL_LOST` se o silêncio for de até 8 horas. Acima de 8 horas considera-se que o turno acabou e nenhuma perda de sinal nova é aberta. A latência máxima para detectar perda de sinal é de cerca de 150 s.
- A pressão não é recuperada por silêncio: só uma medição nova a recupera.
- Quando o relógio volta a falar, `DEVICE_SIGNAL_LOST` recupera com o motivo `SIGNAL_RESTORED`.

### 4.4 Ciclo do alerta

```
             administrador reconhece             administrador resolve (com nota opcional)
   OPEN ───────────────────────────► ACKNOWLEDGED ─────────────────────────────► RESOLVED
     └──────────────────────────────────────────────────────────────────────────► RESOLVED
                                     administrador resolve direto
```

- **Abrir.** O alerta nasce na mesma transação da condição, apenas para batimento alto, batimento baixo, desgaste alto e revisão de pressão. Não nasce outro enquanto houver um alerta não resolvido (`OPEN` ou `ACKNOWLEDGED`) do mesmo funcionário, tipo e origem: a fila não empilha o mesmo problema.
- **Reconhecer** (`POST /telemetry/v1/admin/alerts/:id/acknowledge`): indica que alguém está cuidando. Registra quem e quando.
- **Resolver** (`POST /telemetry/v1/admin/alerts/:id/resolve`, corpo com `note` opcional): encerra o alerta, a partir de aberto ou reconhecido. Registra quem, quando e a nota.
- **Recuperar não resolve.** Quando a condição recupera, o alerta continua na fila; a leitura mostra `recoveredAt` para indicar que o valor já normalizou, e a decisão de encerrar continua sendo de quem triou.
- As duas transições são condicionais ao estado lido: dois administradores atuando no mesmo alerta não se sobrescrevem, e repetir a ação devolve o estado atual.
- O status `DISMISSED` existe no modelo de dados, mas nenhuma rota atual o atribui.
- A fila é restrita a administradores e à empresa do administrador; um administrador sem empresa não tem fila.

### 4.5 Notificações

Ao abrir uma condição de origem `REAL`, o sistema cria notificações no feed (`health-notifier.ts`), uma única vez por condição:

| Condição | Funcionário recebe | Administradores da empresa recebem |
| --- | --- | --- |
| Batimento alto ou baixo | sim, com o valor e o limite | sim, com nome, valor e limite |
| Desgaste alto | sim, com o percentual e a sugestão de pausa | sim, com nome e percentual |
| Revisão de pressão | sim, sem o valor | sim, sem o valor |
| Bateria baixa | sim, com o percentual | não |
| Perda de sinal | não | sim |

Recuperação não gera notificação.

### 4.6 Alertas meteorológicos

Código: `swi-backend/src/weather/` (`weather-alert-profile.ts` e `weather-alert-rules.ts`). Não dependem do relógio.

A cada **30 minutos** (configurável por `WEATHER_CRON`) o servidor consulta a previsão horária do Open-Meteo para o local de cada empresa e avalia as próximas **6 horas**, incluindo a hora em curso:

| Tipo | ATENÇÃO | PERIGO |
| --- | --- | --- |
| Chuva intensa | ≥ 20 mm/h com probabilidade ≥ 50% (ou sem probabilidade informada) | ≥ 30 mm/h |
| Tempestade | código WMO 95 (trovoada) | código 96 ou 99 (granizo), ou rajada ≥ 60 km/h |
| Sol intenso (só de dia) | UV ≥ 8 ou sensação térmica ≥ 32,8 °C | UV ≥ 11 ou sensação térmica ≥ 39,4 °C |

As escalas seguem o INMET (chuva e vento), a OMS (UV) e as faixas de índice de calor do NWS usadas pela OSHA (calor). Os funcionários aprovados e ativos da empresa recebem notificação uma vez por alerta; um agravamento de ATENÇÃO para PERIGO gera um segundo aviso. Sol intenso só notifica em PERIGO, para que o aviso não vire rotina em região quente; em ATENÇÃO ele aparece apenas na tela do clima.

---

## 5. Estimativa, medição e calibração

### 5.1 O que é medição e o que é estimativa

| Valor | Natureza | Observação |
| --- | --- | --- |
| Batimento, passos, distância, energia ativa, oxigenação, bateria | **medição** do Apple Watch | com a precisão e a disponibilidade do próprio aparelho |
| Contagem de movimento | **medição** do acelerômetro, com limiar definido pelo SWI | o significado depende do perfil `swi-motion-experimental-1` |
| Pressão arterial, temperatura corporal | **medição** de terceiro, lida do app Saúde ou digitada | o SWI não mede; registra a origem |
| Movimentos por minuto, taxa de energia por hora | **derivadas** das medições | origem `DERIVED` |
| Repouso observado | **estimativa** a partir do histórico | não é repouso clínico |
| Máxima por idade | **estimativa** da literatura (Tanaka) | desvio típico de cerca de 10 bpm entre pessoas |
| Esforço, desgaste, tempo até a fadiga | **estimativa experimental** do modelo SWI | coeficientes não calibrados |

### 5.2 Declaração de caráter experimental

O modelo `swi-fatigue-experimental-1` e o perfil de alertas `swi-alert-experimental-2` são **experimentais até a calibração com dados do dispositivo da contratante**. Até lá:

- os números de esforço, desgaste e tempo até a fadiga servem para acompanhamento e comparação relativa, não para decisão clínica ou trabalhista;
- o tempo até a fadiga não deve ser usado para bloquear ou liberar jornada;
- o limite alto de batimento (90% da máxima por idade, sustentado por 60 s) tende a disparar em trabalho pesado normal, porque trabalhadores sustentam intensidades próximas ou acima da máxima prevista pela idade. Ele foi mantido ligado de propósito: sem condições gravadas não há dado para calibrar.

### 5.3 Procedimento de calibração

**Onde mexer.** Todos os coeficientes moram em dois arquivos:

- `swi-backend/src/telemetry/assessment/assessment-profile.ts` (fórmula): `hrrWeight`, `motionWeight`, `peaksPerMinuteScale`, `intensityCeiling`, `emaAlphaPer15s`, `decayMinutes`, `doseExponent`, `doseScale`, `restingDays`, `fatigueEtaHorizonMinutes`. Os prazos `gapMaxMs`, `heartRateReuseMs` e `chainLookbackMs` vêm dos prazos de atualidade do domínio e só devem mudar junto com eles.
- `swi-backend/src/telemetry/alerts/alert-profile.ts` (alertas): limites e histereses de batimento, persistência, bateria, desgaste, pressão e perda de sinal.

São constantes no código, e não variáveis de ambiente, de propósito: limite que muda sem passar por revisão de código deriva em silêncio.

**Regra de versão.** Mudar qualquer coeficiente exige mudar a versão (`FORMULA_VERSION` ou `ALERT_PROFILE_VERSION`). A versão é fixada por teste, e a cadeia por sessão compara a versão para decidir se o estado anterior ainda vale: com versão nova, as cadeias reiniciam e cada linha nova registra contra qual perfil foi calculada. Os dados antigos continuam identificados pela versão antiga.

**Com que dados.**

1. Sessões reais de origem `REAL`, com o dispositivo da contratante, cobrindo repouso, trabalho leve, moderado e pesado, e pausas.
2. Para cada sessão, uma referência independente de carga, escolhida pela saúde ocupacional da contratante: por exemplo, escala de percepção de esforço registrada em intervalos, teste de frequência cardíaca máxima e de repouso medidos, ou classificação da tarefa.
3. Os campos que o sistema já grava para isso: em `TelemetryAssessment.inputs`, a linha de base, o estado da cadeia, a contagem de amostras e as marcas de movimento e de batimento reaproveitado; em `TelemetryCondition`, a regra, o limite e o valor observado de cada abertura; em `OperationalAlert`, quando e como cada alerta foi triado e a nota de resolução, que indica se o alerta foi pertinente.
4. Atenção à retenção: leituras e avaliações brutas são apagadas depois de 30 dias por padrão (seção 6.3). Para uma campanha de calibração, exporte os dados antes ou aumente `TELEMETRY_RETENTION_DAYS` durante o período.

**O que ajustar primeiro.**

- **Escala de esforço**: compare o repouso observado e a máxima por idade com os valores medidos das mesmas pessoas. Se divergirem de forma sistemática, a correção está na linha de base, não nos pesos.
- **Pesos e escala de movimento** (`hrrWeight`, `motionWeight`, `peaksPerMinuteScale`): ajuste para que o esforço acompanhe a referência independente nas tarefas com muito movimento e pouca elevação de batimento, e vice-versa.
- **Dinâmica do desgaste** (`decayMinutes`, `doseExponent`, `doseScale`): ajuste para que o desgaste ao fim de um turno real fique na faixa que a referência indica e para que o limiar de 80% corresponda à situação que a operação quer sinalizar.
- **Limiares de alerta**: revise o limite alto de batimento, a janela de persistência e o limiar de desgaste usando a taxa de alertas por turno e as notas de resolução.

**Como validar.**

1. Use o simulador determinístico `swi-backend/src/telemetry/assessment/fatigue-simulator.ts`. Ele gera amostras a partir de trechos (duração, batimento, picos por minuto), corre a fórmula em janelas de 15 s encadeando o estado como o serviço faz, e não depende de banco nem de relógio. A função `steadyStateWear` dá, em forma fechada, onde o desgaste estabiliza para cada intensidade sustentada.
2. Os cenários controlados ficam em `swi-backend/src/telemetry/assessment/fixtures/controlled-sessions.ts`, com o resultado final esperado de cada um. Com o perfil atual (cadência de 5 s, repouso 62 bpm, máxima 183,5 bpm):

   | Cenário | Descrição | Esforço final | Desgaste final |
   | --- | --- | --- | --- |
   | `rest` | 30 min a 66 bpm, 2 picos/min | 3 | 0 |
   | `light` | 30 min a 95 bpm, 30 picos/min | 29 | 3 |
   | `moderate` | 30 min a 125 bpm, 54 picos/min | 54 | 8 |
   | `intense` | 30 min a 165 bpm, 90 picos/min | 89 | 17 |
   | `recovery` | 20 min a 165 bpm, depois 40 min a 75 bpm | 9 | 10 |
   | `signalLoss` | 10 min a 140 bpm, 3 min sem sinal, 5 min a 140 bpm | 65 | 6 |
   | `backlog` | evento velho demais para avaliar | sem avaliação | sem avaliação |

   Desgaste de equilíbrio por intensidade sustentada: 0,50 dá 39%; 0,75 dá 61%; 1,00 dá 78%; 1,20 (o teto) dá 87%.
3. Acrescente cenários que reproduzam as sessões reais medidas (os mesmos trechos de batimento e movimento) e compare a saída com a referência independente.
4. Mude os coeficientes e a versão juntos e rode os testes:

   ```bash
   cd swi-backend
   npx jest src/telemetry/assessment src/telemetry/alerts
   ```

   Os testes de `fatigue-simulator.spec.ts` comparam cada cenário com o fixture e quebram de propósito quando a fórmula ou o perfil mudam. Atualize os valores esperados com os números da nova versão, sabendo o porquê de cada mudança, e registre a versão nova.
5. Valide de ponta a ponta numa homologação com a ferramenta `swi-backend/scripts/qa/inject-demo-telemetry.ts`, que injeta cenários na ingestão real com origem `DEMO` (por exemplo `batimento-alto`, `bateria-baixa`, `desgaste`), para conferir avaliação, condição, alerta e tela.

---

## 6. Tratamento dos dados biométricos

### 6.1 O que é armazenado em cada tabela

| Tabela | Conteúdo | Contém dado de saúde |
| --- | --- | --- |
| `TelemetryEnrollment` | funcionário, quem convidou, tipo de aparelho, **hash** do código, validade, uso | não |
| `TelemetryDevice` | funcionário, tipo e modelo do aparelho, **hash** da credencial, revogação, último contato | não |
| `TelemetrySession` | funcionário, aparelho, origem, início | não |
| `TelemetrySample` | cada leitura recebida: batimento, passos, energia, movimento, bateria, pressão e sua origem, distância, oxigenação, temperatura e sua origem; horário da medição e do recebimento; jornada e tarefa associadas, quando houver; o **conteúdo original do evento** (`payload`) e o hash dele | **sim** |
| `TelemetrySnapshot` | uma linha por funcionário com o último valor de cada medição e o horário | **sim** |
| `TelemetryAssessment` | esforço, desgaste, tempo até a fadiga, janela, versão da fórmula e o JSON `inputs` (perfil, estado da cadeia, repouso observado, idade, máxima) | **sim** |
| `TelemetryDailySummary` | por funcionário, dia e origem: batimento mínimo, máximo e médio; passos, distância e energia do dia; esforço e desgaste máximos e médios e tempo acima de 80%; última pressão do dia; bateria mínima; cobertura do dia | **sim** |
| `TelemetryCondition` | tipo, estado, abertura, recuperação e motivo, regra, limite e valor observado | **sim** |
| `OperationalAlert` | condição, estado, quem triou, quando, nota de resolução | **sim** (por referência à condição) |
| `Notification` (domínio `health`) | título e texto da notificação de saúde, que pode conter batimento, percentual de desgaste ou bateria | **sim** |
| `Profile` | data de nascimento (usada para a máxima por idade) e demais dados cadastrais | sim, indiretamente |

### 6.2 O que **não** é armazenado

- A série bruta do acelerômetro: o relógio envia apenas a contagem de picos por intervalo.
- O repouso do HealthKit (`restingHeartRate`), a temperatura de punho durante o sono, eletrocardiograma e sono.
- Histórico do app Saúde além do necessário: a oxigenação lida pelo relógio é só a medida depois do início da sessão, e pressão e temperatura são lidas apenas das últimas 72 horas.
- Qualquer valor de saúde nos logs do servidor: as mensagens de log registram identificadores (sessão, avaliação, condição) e contagens, nunca batimento, percentual ou tipo de condição.
- O código de pareamento e a credencial do dispositivo em claro: o banco guarda só os hashes.
- Valores de saúde nos avisos por socket: eles levam só identificadores.

No aparelho, os eventos ficam numa fila local até o servidor confirmar o recebimento: no relógio (até 100 mil eventos) e no iPhone, em pasta do app que o sistema não apaga sob pressão de espaço.

### 6.3 Por quanto tempo

Código: `swi-backend/src/telemetry/lifecycle/`. Um job diário roda às **06:30 UTC** (03:30 em Brasília; configurável por `TELEMETRY_LIFECYCLE_CRON`) e faz duas coisas, sempre nesta ordem:

1. **Resume** cada dia fechado em `TelemetryDailySummary`. Um dia monitorado é o dia civil no horário de Brasília e fecha 48 horas depois da meia-noite que o encerra, prazo em que ainda pode chegar evento atrasado.
2. **Apaga** as leituras (`TelemetrySample`) e avaliações (`TelemetryAssessment`) dos dias que saíram da janela de retenção, **somente** se o dia já tiver Resumo na versão atual do resumidor.

Além do job diário, uma rodada a cada **30 minutos** (`TELEMETRY_SUMMARY_REFRESH_CRON`) resume os dias ainda não fechados como Resumo **provisório** (`provisional = true`), sobrescrito pela mesma chave a cada rodada e substituído pelo definitivo quando o dia fecha; ela também fecha o dia que acabou de completar as 48 horas. O Resumo provisório não libera a limpeza e não entra no limite de batimento baixo; o de um dia que já terminou conta como repouso medido (seção 2.2). Essa rodada não apaga nada.

| Dado | Retenção |
| --- | --- |
| Leituras brutas e avaliações | **30 dias** por padrão (`TELEMETRY_RETENTION_DAYS`, mínimo 2). Apagadas em lotes de 5 000 linhas (`TELEMETRY_RETENTION_BATCH_SIZE`), com no máximo 60 s de trabalho por noite; o que sobrar fica para a noite seguinte |
| Resumo do dia | mantido indefinidamente |
| Snapshot | mantido; cada campo é sobrescrito pela leitura mais nova |
| Condições e alertas | mantidos indefinidamente (memória clínica e trilha de triagem) |
| Sessões, dispositivos, pareamentos | mantidos indefinidamente |
| Notificações de saúde | mantidas indefinidamente |

**Exclusão do funcionário.** Ao excluir definitivamente um usuário (`DELETE /users/:id`, papel ADMIN da mesma empresa), o banco apaga em cascata toda a telemetria dele: pareamentos, dispositivos, sessões, leituras, snapshot, avaliações, resumos, condições e alertas. Se o usuário tiver outros registros vinculados que impeçam a exclusão, o sistema orienta a desativá-lo. Desativar (`active = false`) bloqueia o acesso, mas **mantém** os dados.

### 6.4 Quem acessa, por papel

O sistema tem três papéis: `WORKER` (funcionário), `SUPERVISOR` (supervisor) e `ADMIN` (administrador). A matriz completa fica em `swi-backend/src/auth/permissions.ts`, e o teste `route-access.spec.ts` lista, rota a rota, quem passa.

| Ação | Funcionário | Supervisor | Administrador |
| --- | --- | --- | --- |
| Ver o próprio estado atual e as próprias séries | sim | não se aplica | não se aplica |
| Ver estado e séries de um funcionário | não | sim, só de funcionários da **própria empresa** | sim, só de funcionários da **própria empresa** |
| Ver a trilha de auditoria de uma sessão | só das próprias sessões | sessões de funcionários da própria empresa | sessões de funcionários da própria empresa |
| Ver e triar a fila de alertas | não | sim, só da própria empresa | sim, só da própria empresa |
| Gerar código de pareamento e revogar aparelho | não | não | sim, só da própria empresa |
| Concluir o pareamento | sim, só o próprio | não | não |
| Cadastrar, editar, desativar e excluir usuários; mudar o nível de acesso | não | não | sim, só da própria empresa |
| Receber notificações de saúde | as próprias | as dos funcionários da própria empresa | as dos funcionários da própria empresa |

Um administrador ou supervisor sem empresa não lê telemetria de ninguém. Fora do escopo, o servidor responde como se o recurso não existisse. O aparelho pareado só escreve, nunca lê.

### 6.5 Configurações de ambiente relevantes

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `TELEMETRY_RETENTION_DAYS` | 30 | janela de retenção das leituras e avaliações brutas (mínimo 2) |
| `TELEMETRY_RETENTION_BATCH_SIZE` | 5000 | tamanho do lote de exclusão |
| `TELEMETRY_LIFECYCLE_CRON` | `0 30 6 * * *` | horário do resumo e da retenção |
| `TELEMETRY_CONDITION_SWEEP_CRON` | `*/30 * * * * *` | cadência da varredura de silêncio |
| `TELEMETRY_ALERTS_INCLUDE_DEMO` | vazio | `1` mostra alertas `DEMO` na fila; **nunca ligar em produção** |
| `WEATHER_CRON` | a cada 30 min | cadência dos alertas meteorológicos |

---

## 7. Limitações conhecidas

- **Temperatura de pele não é temperatura corporal.** O relógio não mede temperatura durante o turno. A temperatura exibida é lida do app Saúde, registrada por termômetro ou vestível de terceiro, e não abre condição nem alerta. Leitura feita no pulso é temperatura de pele, não temperatura central, e não deve ser interpretada como febre ou estresse térmico.
- **Versões mínimas.** O app do iPhone instala a partir do **iOS 15.1**, mas a telemetria do relógio exige **iOS 17** no iPhone e **watchOS 10** no relógio, porque depende do espelhamento da sessão de treino entre relógio e iPhone. Em iPhone com iOS 15 ou 16 o app funciona, mas sem telemetria do relógio e sem a leitura de pressão e temperatura do app Saúde, cuja autorização é pedida junto com a do relógio.
- **Apenas Apple Watch.** As medições contínuas aceitam só a origem `APPLE_WATCH`. Outro dispositivo exige um produtor novo que envie o mesmo contrato de evento.
- **Contrato de variação.** Passos, distância, energia e movimento devem chegar como variação desde o evento anterior. Um produtor que envie o acumulado passa pela validação e infla os totais sem erro visível, porque não há como distinguir pela amostra.
- **Repouso observado e máxima estimada.** O repouso é o piso observado, não o clínico, e tende a subestimar o esforço; a máxima por idade tem desvio de cerca de 10 bpm. Funcionário novo usa um repouso provisório (teto de 70 bpm) até o primeiro dia de uso terminar, e nesse período o esforço e o desgaste são estimativa, marcada como tal na avaliação e no painel.
- **Tempo até a fadiga raramente aparece.** Com o perfil atual, a estimativa só existe com intensidade sustentada acima da máxima prevista pela idade (seção 3.5).
- **Limite alto de batimento sensível.** 90% da máxima por idade por 60 s tende a disparar em trabalho pesado normal (seção 5.2).
- **Sessão sem encerramento.** As sessões de monitoramento não são encerradas pelo sistema; a perda de sinal é inferida pelo silêncio do relógio. Um funcionário calado há mais de 7 dias deixa de ser varrido.
- **Turno que cruza a meia-noite.** Os acumulados do dia (passos, distância, energia) reiniciam à meia-noite de Brasília. A cadeia de desgaste não reinicia.
- **Origem declarada pelo aparelho.** O dispositivo declara se o evento é `REAL` ou `DEMO`; o servidor impede a mistura dentro da sessão, mas não deriva a origem do cadastro do aparelho.
- **Dependência de terceiros.** A previsão do tempo depende da disponibilidade do Open-Meteo; a sensação térmica dele é uma aproximação do índice de calor do NWS, não o mesmo cálculo.

---

## 8. Referência rápida de parâmetros

### Fórmula (`swi-backend/src/telemetry/assessment/assessment-profile.ts`, versão `swi-fatigue-experimental-1`)

| Parâmetro | Valor | Significado |
| --- | --- | --- |
| `hrrWeight` | 0,75 | peso da reserva de frequência cardíaca na intensidade |
| `motionWeight` | 0,25 | peso do movimento na intensidade |
| `peaksPerMinuteScale` | 90 | picos por minuto que valem índice de movimento 1,0 |
| `intensityCeiling` | 1,2 | teto de HRR, movimento e intensidade |
| `emaAlphaPer15s` | 0,35 | alfa da média móvel do esforço, por 15 s |
| `decayMinutes` | 180 | constante de tempo do decaimento da dose |
| `doseExponent` | 1,6 | expoente da intensidade na dose |
| `doseScale` | 120 | escala do mapeamento dose para percentual |
| `restingDays` | 14 | dias fechados usados no repouso observado |
| `gapMaxMs` | 120 000 ms | maior intervalo entre amostras que ainda acrescenta dose |
| `heartRateReuseMs` | 45 000 ms | idade máxima de um batimento reaproveitado |
| `chainLookbackMs` | 120 000 ms | quanto uma janela pode olhar para trás |
| `fatigueEtaHorizonMinutes` | 480 | horizonte do tempo até a fadiga |
| `ASSESSMENT_THROTTLE_MS` (em `assessment.service.ts`) | 15 000 ms | intervalo mínimo entre avaliações da mesma sessão |
| Máxima por idade (em `assessment-baseline.ts`) | 208 − 0,7 × idade | Tanaka, Monahan e Seals (2001) |

### Alertas (`swi-backend/src/telemetry/alerts/alert-profile.ts`, versão `swi-alert-experimental-2`)

| Parâmetro | Valor |
| --- | --- |
| Batimento alto | 90% da máxima por idade; piso 180 bpm; histerese 10 bpm |
| Batimento baixo | repouso observado − 15 bpm; piso 40 bpm; histerese 10 bpm |
| Persistência do batimento | janela 60 s; cobertura mínima 45 s; vão máximo 15 s |
| Bateria baixa | abre ≤ 15%; recupera > 25% |
| Desgaste alto | abre ≥ 80%; recupera < 70% |
| Revisão de pressão | abre sistólica ≥ 140 ou diastólica ≥ 90; recupera sistólica < 130 e diastólica < 85 |
| Perda de sinal | abre com silêncio > 120 s; não abre com silêncio > 8 h |
| Repouso observado | 14 dias fechados |

### Movimento (`mobile/targets/watch/MotionCounter.swift`, perfil `swi-motion-experimental-1`)

| Parâmetro | Valor |
| --- | --- |
| Frequência de leitura | 20 Hz |
| Limiar de pico | 0,3 g de aceleração do usuário |
| Intervalo mínimo entre picos | 0,25 s |

### Referências

- Tanaka H, Monahan KD, Seals DR. *Age-predicted maximal heart rate revisited*. Journal of the American College of Cardiology, 2001.
- Karvonen MJ, Kentala E, Mustala O. *The effects of training on heart rate: a longitudinal study*. Annales Medicinae Experimentalis et Biologiae Fenniae, 1957.
- Morton RH, Fitz-Clarke JR, Banister EW. *Modeling human performance in running*. Journal of Applied Physiology, 1990.
