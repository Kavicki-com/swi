-- Pausa dos alertas do funcionário pelo painel (nulo: monitorado normalmente).
ALTER TABLE "User" ADD COLUMN "monitoringPausedAt" TIMESTAMP(3);
