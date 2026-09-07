-- Motivo de recuperação e regra que abriu, para a linha contar a história inteira.
CREATE TYPE "TelemetryConditionRecoveryReason" AS ENUM ('NORMALIZED', 'SIGNAL_LOST');

ALTER TABLE "TelemetryCondition"
  ADD COLUMN "thresholdRule" TEXT,
  ADD COLUMN "thresholdValue" DOUBLE PRECISION,
  ADD COLUMN "recoveryReason" "TelemetryConditionRecoveryReason";

-- Garantia do banco contra dois lotes paralelos abrindo a mesma condição.
-- Parcial porque a história (linhas RECOVERED) pode ter quantas quiser.
--
-- A origem entra na chave porque real e demonstração são universos que nunca
-- se misturam no resto da telemetria: o read model já lê condição com
-- origin = 'REAL'. Sem ela, uma condição de demonstração ativa impediria a
-- condição real do mesmo funcionário e tipo de abrir, e um alerta de segurança
-- verdadeiro seria suprimido por dado de demonstração.
CREATE UNIQUE INDEX "TelemetryCondition_active_worker_kind_origin_key"
  ON "TelemetryCondition" ("workerId", "kind", "origin")
  WHERE "status" = 'ACTIVE';

-- Origem no alerta. A tabela está vazia em todo ambiente (nada escreve nela),
-- então a coluna nasce NOT NULL sem padrão e sem backfill.
ALTER TABLE "OperationalAlert" ADD COLUMN "origin" "TelemetryOrigin" NOT NULL;

DROP INDEX "OperationalAlert_status_createdAt_idx";
CREATE INDEX "OperationalAlert_origin_status_createdAt_idx"
  ON "OperationalAlert" ("origin", "status", "createdAt");
