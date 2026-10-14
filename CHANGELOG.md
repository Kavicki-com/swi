# Changelog

Registro das entregas do SWI. O versionamento segue a versão do produto (app mobile), que é a referência da entrega ao cliente.

## 1.0.2

Versão de entrega. Reúne o painel de gestão, o app do trabalhador e o backend em um sistema integrado, com o piloto de smartband (Apple Watch) e as medidas de privacidade.

### Painel (`swi-admin`)

- Gestão de funcionários: cadastro, edição, ativação e desativação, com exames e anexos.
- Dashboard operacional: KPIs, atividades, alertas de desgaste e linha do tempo do clima.
- Mapa geral e minimapa de detalhe, com câmeras e visualização por operador.
- Chat com os trabalhadores.
- Relatórios com detalhe e exclusão.
- Alertas, início de evacuação com área demarcada no mapa e fluxo de resgate com histórico.

### App do trabalhador (`mobile`)

- Jornada de trabalho, inclusive com operação offline e sincronização sem duplicar.
- GPS em segundo plano e envio de posições em lote.
- Sinais vitais (quando há smartband pareada) e monitoramento de saúde.
- Chat, câmera com transmissão e self-view, e estados de borda (sem sinal, carregando, erro).

### Backend (`swi-backend`)

- API NestJS + Prisma + PostgreSQL.
- Autenticação e perfis.
- Telemetria: enrolamento de dispositivo revogável, ingestão idempotente em lote e modelos de leitura canônicos.
- CRUD de usuários, relatórios e ordens de serviço.

### Privacidade e segurança (LGPD)

- Regras de senha, registro de acesso e tratamento de dados pessoais conforme a LGPD.

### Smartband (piloto Apple Watch)

- Piloto de telemetria por smartband (Apple Watch), com coleta de sinais do relógio.
