-- Linha de base provisória: esforço, desgaste e previsão de fadiga desde o
-- primeiro uso do relógio, sem esperar o primeiro dia fechado. Duas colunas
-- aditivas, com padrão: nenhuma linha existente muda de sentido.
--
-- "provisional" marca o Resumo de um dia ainda aberto, refeito a cada rodada
-- até o dia fechar; o Resumo definitivo o sobrescreve pela mesma chave. Ele
-- não vale como linha de base medida nem libera a retenção.
--
-- "baselineSource" registra de onde veio o repouso de cada avaliação
-- (MEASURED ou PROVISIONAL), para o painel marcar a estimativa e para a
-- auditoria da linha. Nulo quando a avaliação saiu indisponível.
ALTER TABLE "TelemetryDailySummary" ADD COLUMN "provisional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelemetryAssessment" ADD COLUMN "baselineSource" TEXT;
