# SWI: Segurança e Monitoramento de Equipes

O SWI monitora a operação de funcionários em campo, reúne eventos de segurança e oferece comunicação entre funcionários e a equipe administrativa.

## Language

**Funcionário**:
Pessoa monitorada pelo SWI e usuária do aplicativo móvel. No código legado, pode aparecer como `worker`.
_Avoid_: Colaborador, operador

**Equipe administrativa**:
Usuários do painel web cujas ações são limitadas por permissões e setores; administrador e supervisor são conjuntos de permissões, não domínios separados.
_Avoid_: Admin como sinônimo de qualquer usuário do painel

**Amostra de telemetria**:
Registro temporal, versionado e idempotente, que identifica funcionário, dispositivo, origem, qualidade e um conjunto extensível de medições.
_Avoid_: JSON da smartband, leitura genérica

**Medição**:
Valor opcional dentro de uma amostra de telemetria, acompanhado de tipo e unidade explícitos, como frequência cardíaca ou temperatura da pele.
_Avoid_: Dado vital sem unidade

**Provedor sintético**:
Fonte controlada de amostras usada em desenvolvimento, testes ou demonstrações identificadas; nunca representa uma medição real.
_Avoid_: Smartband falsa, dado real de demonstração

**Origem da amostra**:
Classificação verificável da procedência da telemetria: `real` ou `synthetic`. Ausência de dado é um estado de disponibilidade, não uma origem.
_Avoid_: Mock implícito

**Jornada SWI**:
Intervalo de negócio que contextualiza atividades de trabalho do funcionário. Pode ser associado à telemetria, mas não inicia, encerra nem limita a coleta do dispositivo.
_Avoid_: Sessão do HealthKit, sessão de monitoramento, treino

**Sessão de monitoramento**:
Intervalo técnico em que o dispositivo mantém coleta e atualização contínuas de telemetria. É independente de Jornada SWI, ordem de serviço ou atividade de trabalho; essas relações são opcionais.
_Avoid_: Jornada, turno, ordem de serviço

**Jornada real**:
Jornada SWI associada exclusivamente a medições de origem real; ausência de medição permanece explícita e nunca é preenchida com dados sintéticos.
_Avoid_: Jornada parcialmente simulada

**Jornada de demonstração**:
Jornada SWI associada exclusivamente a amostras sintéticas identificadas, usada para demonstrar cenários controlados sem representar um funcionário real.
_Avoid_: Demo real, jornada real com mocks

**Estado de métrica**:
Classificação mutuamente exclusiva da disponibilidade de uma métrica: atual, histórica, desatualizada, indisponível ou não suportada.
_Avoid_: Valor zero como ausência, origem indisponível

**Pressão arterial registrada**:
Par sistólico/diastólico em `mmHg`, acompanhado de horário e procedência. A ausência de uma leitura nunca é representada por `0/0`.
_Avoid_: Pressão do Apple Watch, pressão presumida

**Movimentos da jornada**:
Quantidade acumulada de passos registrada durante uma Jornada SWI. A taxa de movimento por minuto é uma medição derivada distinta.
_Avoid_: Movimento estimado a partir do esforço

**Gasto energético por hora**:
Taxa média de energia ativa consumida durante uma Jornada SWI, expressa em `kcal/h`; não é o total de calorias da jornada.
_Avoid_: Calorias sem intervalo, metabolismo basal

**Esforço operacional**:
Estimativa experimental e instantânea da intensidade física do funcionário, expressa em percentual e acompanhada da versão do cálculo.
_Avoid_: Diagnóstico de esforço, medição clínica

**Desgaste operacional**:
Indicador experimental acumulado a partir do esforço ao longo da Jornada SWI; não representa fadiga clínica nem determina tempo seguro de trabalho.
_Avoid_: Fadiga diagnosticada, bloqueio automático do funcionário

**Cobertura de telemetria**:
Relação entre funcionários considerados em um indicador agregado e o total elegível, considerando disponibilidade e atualidade das métricas exigidas.
_Avoid_: Média sem informar quantos funcionários possuem dados

**Perda de telemetria**:
Lacuna conhecida entre medições esperadas que o SWI registra explicitamente quando não consegue preservar ou recuperar uma amostra.
_Avoid_: Descarte silencioso, dado zero

**Perfil de alertas**:
Conjunto versionado e aprovado de faixas, durações e níveis usados para interpretar condições monitoradas no SWI.
_Avoid_: Limite fixo escondido no código, regra médica implícita

**Condição monitorada**:
Situação detectada a partir de dados atuais que pode estar ativa ou recuperada; sua evolução é automática e independente da triagem humana.
_Avoid_: Alerta persistente, diagnóstico

**Condição vital do piloto**:
Classificação baseada somente em frequência cardíaca atual e em condições cardíacas ativas; esforço e desgaste permanecem indicadores operacionais separados.
_Avoid_: Diagnóstico de saúde, estimativa tratada como sinal vital

**Alerta operacional**:
Registro persistente criado quando uma condição monitorada exige triagem, com estado, responsável, justificativa e histórico de transições.
_Avoid_: Notificação

**Triagem de alerta**:
Tratamento humano de um alerta operacional, que pode estar aberto, reconhecido ou resolvido mesmo que a condição monitorada já tenha se recuperado.
_Avoid_: Recuperação automática da condição

**Notificação**:
Mensagem entregue a um destinatário em razão de um evento do sistema; pode aparecer na central do produto, em tempo real ou como push nativo.
_Avoid_: Alerta operacional

**Homologação**:
Aceite formal de uma capacidade contra critérios funcionais, técnicos, de segurança e de negócio. Preparação técnica ou demonstração não equivalem a homologação.
_Avoid_: Tela pronta, demo funcionando
