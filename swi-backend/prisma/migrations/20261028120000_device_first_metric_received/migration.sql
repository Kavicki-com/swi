-- Primeira chegada de cada métrica no celular Android, para a leitura dizer
-- "aguardando" ou "não envia" sem varrer as amostras a cada consulta. Aditivo:
-- aparelho sem amostra fica com as colunas nulas.
ALTER TABLE "TelemetryDevice"
ADD COLUMN "heartRateFirstReceivedAt" TIMESTAMP(3),
ADD COLUMN "stepsFirstReceivedAt" TIMESTAMP(3),
ADD COLUMN "activeEnergyFirstReceivedAt" TIMESTAMP(3),
ADD COLUMN "oxygenSaturationFirstReceivedAt" TIMESTAMP(3),
ADD COLUMN "bloodPressureFirstReceivedAt" TIMESTAMP(3);

-- O celular Android que já sincronizou ganha as primeiras chegadas que as
-- amostras ainda retidas contam, numa passada só pela tabela. A ingestão
-- grava daqui em diante.
UPDATE "TelemetryDevice" d
SET
  "heartRateFirstReceivedAt" = f."heartRate",
  "stepsFirstReceivedAt" = f."steps",
  "activeEnergyFirstReceivedAt" = f."activeEnergy",
  "oxygenSaturationFirstReceivedAt" = f."oxygenSaturation",
  "bloodPressureFirstReceivedAt" = f."bloodPressure"
FROM (
  SELECT
    "deviceId",
    MIN("receivedAt") FILTER (WHERE "heartRateBpm" IS NOT NULL) AS "heartRate",
    MIN("receivedAt") FILTER (WHERE "stepDelta" IS NOT NULL) AS "steps",
    MIN("receivedAt") FILTER (WHERE "activeEnergyKcal" IS NOT NULL) AS "activeEnergy",
    MIN("receivedAt") FILTER (WHERE "oxygenSaturationPct" IS NOT NULL) AS "oxygenSaturation",
    MIN("receivedAt") FILTER (WHERE "systolicMmHg" IS NOT NULL) AS "bloodPressure"
  FROM "TelemetrySample"
  GROUP BY "deviceId"
) f
WHERE d."id" = f."deviceId"
  AND d."kind" = 'ANDROID_PHONE';
