-- "Limpar todas" do sino do painel: a notificação some só no painel e o app
-- continua vendo. Coluna nula e aditiva, nenhuma linha existente muda.
ALTER TABLE "Notification" ADD COLUMN "panelHiddenAt" TIMESTAMP(3);
