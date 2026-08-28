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
Classificação verificável da procedência da telemetria: `real`, `synthetic` ou `unavailable`.
_Avoid_: Mock implícito

**Alerta operacional**:
Registro persistente de uma condição que exige triagem, com estado, responsável, justificativa e histórico de transições.
_Avoid_: Notificação

**Notificação**:
Mensagem entregue a um destinatário em razão de um evento do sistema; pode aparecer na central do produto, em tempo real ou como push nativo.
_Avoid_: Alerta operacional

**Homologação**:
Aceite formal de uma capacidade contra critérios funcionais, técnicos, de segurança e de negócio. Preparação técnica ou demonstração não equivalem a homologação.
_Avoid_: Tela pronta, demo funcionando
