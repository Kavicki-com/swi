-- Batimento ao vivo pelo Bluetooth do celular Android: a origem nova, a origem
-- gravada em cada amostra de batimento e o horário do último evento ao vivo,
-- que é por onde a varredura de silêncio passa a medir. Tudo aditivo.
ALTER TYPE "TelemetryMeasurementSource" ADD VALUE 'BLUETOOTH_HR';

ALTER TABLE "TelemetrySample" ADD COLUMN "heartRateSource" "TelemetryMeasurementSource";

ALTER TABLE "TelemetrySnapshot" ADD COLUMN "lastLiveEventTime" TIMESTAMP(3);

CREATE INDEX "TelemetrySnapshot_origin_lastLiveEventTime_idx" ON "TelemetrySnapshot"("origin", "lastLiveEventTime");

-- O relógio só promove o atual ao vivo, então para ele o último evento já é o
-- último ao vivo. Sem copiar, quem está em turno sumiria da varredura até o
-- próximo evento. Snapshot sem sessão foi aberto por medição avulsa e não tem
-- sinal a perder; o do celular Android nunca falou ao vivo.
UPDATE "TelemetrySnapshot"
SET "lastLiveEventTime" = "lastEventTime"
WHERE "sessionId" IS NOT NULL
  AND ("deviceKind" IS NULL OR "deviceKind" <> 'ANDROID_PHONE');
