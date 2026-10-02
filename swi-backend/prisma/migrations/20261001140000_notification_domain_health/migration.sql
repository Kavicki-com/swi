-- Alerta de saúde do monitoramento vira notificação do feed, num domínio
-- próprio para o app e o painel o distinguirem dos demais avisos.
ALTER TYPE "NotificationDomain" ADD VALUE 'health';
