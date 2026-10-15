# Changelog

Registro das entregas do SWI. O versionamento segue a versão do produto (app mobile), que é a referência da entrega ao cliente.

## 1.1.0

Fecha os dois itens do Anexo I que a 1.0.2 entregava com limitação: anexos multimídia nos relatórios e níveis de permissão.

### Painel (`swi-admin`)

- Relatórios aceitam anexos de vídeo, áudio e PDF, além de imagens. O detalhe toca vídeo e áudio, abre o PDF e permite baixar qualquer anexo; a seleção mostra tipo e tamanho e recusa, antes do envio, o que a API recusaria.
- Três níveis de acesso: Administrador, Supervisor e Funcionário. O cadastro e a edição de administradores escolhem o nível. O Supervisor monitora, trata alertas, opera ordens de serviço, relatórios, chat, evacuação e resgate; não vê gestão de funcionários e administradores nem altera o cadastro da empresa.
- Configurações do usuário mostram o nível de quem está logado e o que ele pode fazer, lidos da API. Os controles de Localização, Arquivos e Ligações, que não gravavam nada, foram removidos.
- Design system 0.1.141.

### App do trabalhador (`mobile`)

- Novo relatório aceita foto, vídeo, áudio e PDF, com tipo e tamanho visíveis e os mesmos limites da API. O detalhe do relatório exibe cada anexo por tipo e abre vídeo, áudio e PDF no navegador interno.
- Design system 0.1.141.

### Backend (`swi-backend`)

- Anexos de relatório: MP4, QuickTime, MP3, M4A, WAV e PDF, com teto por tipo (vídeo 100 MB, áudio 25 MB, imagem e PDF 15 MB). A leitura do relatório devolve `attachments` com o tipo de cada arquivo.
- Nível `SUPERVISOR` (migration aditiva) e matriz de permissões única em `src/auth/permissions.ts`, exposta em `GET /auth/me`.
- `SMTP_SECURE` aceita `1` e `true`.

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

### Privacidade e segurança

- Regra mínima de senha em toda senha nova (cadastro pelo app, cadastro pelo painel, redefinição e troca): ao menos 8 caracteres, com número, letra maiúscula e símbolo.
- O canal em tempo real recusa usuário desativado, e desativar ou excluir um usuário derruba as conexões que ele tinha abertas.
- Logs sem dado biométrico: em produção a API registra só os níveis fatal, error, warn e log, e erros de banco vão para o log só com tipo e código, sem os valores da consulta.
- Política de privacidade disponível no app e no painel.

### Smartband (piloto Apple Watch)

- Piloto de telemetria por smartband (Apple Watch), com coleta de sinais do relógio.
