# Changelog

Registro das entregas do SWI. O versionamento segue a versão do produto (app mobile), que é a referência da entrega ao cliente.

## 1.2.0

Cadastro pelo painel com credenciais por e-mail, e esforço e desgaste desde o primeiro uso do relógio. O APK da 1.1.0 continua valendo.

### Backend (`swi-backend`)

- Cadastro feito pelo painel (funcionário, supervisor ou administrador) envia à pessoa um e-mail de cadastro concluído com as credenciais de acesso: o login, que é o e-mail, e a senha definida pelo admin. A conta continua nascendo ativa, sem etapa de ativação. Se o e-mail não puder ser enviado, o cadastro é concluído mesmo assim e a resposta da API informa isso ao painel.
- Esforço, desgaste e previsão de fadiga existem desde o primeiro uso do relógio. Enquanto não há dia fechado com batimento, a avaliação usa um repouso provisório (o menor batimento plausível já visto, com teto de 70 bpm) e registra isso na própria linha e na leitura do painel (`baseline: PROVISIONAL`). Uma rodada a cada 30 minutos resume como provisório cada dia ainda não fechado e fecha o dia que acabou de fechar; o Resumo provisório de um dia que já terminou conta como repouso medido, então o repouso medido chega na manhã seguinte ao primeiro dia de uso, e o selo de estimativa aparece só nesse primeiro dia. Migration aditiva com duas colunas.

### Painel (`swi-admin`)

- Depois de cadastrar, o aviso diz se a pessoa recebeu as credenciais por e-mail. Quando o e-mail não pôde ser enviado, o aviso pede que o admin passe o login e a senha por outro meio.
- Enquanto o repouso da linha de base é provisório, o desgaste no painel leva o selo "Estimativa provisória": nos cards de desgaste do início e na leitura dos sinais vitais do funcionário. O selo some sozinho quando o repouso medido chega, e a leitura de demonstração continua com o próprio selo.

## 1.1.2

Correção no painel. O app e o backend não mudam, e o APK da 1.1.0 continua valendo.

### Painel (`swi-admin`)

- A tela de Administradores abria preta. Parar a animação do esqueleto de carregamento lia `global`, que existe no app e no servidor, mas não no navegador. O build passou a definir `global`, o que vale para qualquer animação do design system.
- Depois de uma atualização do painel, quem ainda tinha a página antiga aberta recebia 404 ao abrir uma tela nova e também via a tela preta. O painel agora recarrega sozinho, uma vez, quando um arquivo de tela não é encontrado.
- Teste de navegador para a tela de Administradores, que não tinha cobertura.

## 1.1.1

Correção no painel. O app e o backend não mudam, e o APK da 1.1.0 continua valendo.

### Painel (`swi-admin`)

- A fila de cadastros pendentes mostra o CPF, o telefone, a cidade e as alergias que o funcionário informou no cadastro. Antes ela lia a listagem genérica de usuários, que não traz esses campos, e exibia "não informado".

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
