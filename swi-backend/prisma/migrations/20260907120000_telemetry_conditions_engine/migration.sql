-- Motivo de recuperação e regra que abriu, para a linha contar a história inteira.
CREATE TYPE "TelemetryConditionRecoveryReason" AS ENUM ('NORMALIZED', 'SIGNAL_LOST', 'SIGNAL_RESTORED');

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

-- Índices das duas buscas pontuais do motor de condições: a última bateria
-- dentro de 30 min e a última pressão dentro de 72 h, ambas recortadas por
-- funcionário e origem. O índice geral (workerId, eventTime) não serve: nem a
-- origem nem o "coluna não nula" entram nele, então para um funcionário que
-- NUNCA mediu pressão a busca varre as 72 h inteiras de amostras dele, na
-- cadência de cinco segundos, e isso acontece na rota mais quente do backend,
-- a cada evento. Parciais porque só as linhas que têm a medição interessam.
CREATE INDEX "TelemetrySample_worker_pressure_idx"
  ON "TelemetrySample" ("workerId", "origin", "eventTime" DESC)
  WHERE "systolicMmHg" IS NOT NULL;

CREATE INDEX "TelemetrySample_worker_battery_idx"
  ON "TelemetrySample" ("workerId", "origin", "eventTime" DESC)
  WHERE "batteryPercent" IS NOT NULL;
