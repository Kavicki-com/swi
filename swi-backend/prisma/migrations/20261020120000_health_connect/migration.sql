-- Health Connect no Android: tipo de aparelho, origem de medição e os dois
-- carimbos que separam "dados até" de "sincronizado às" no estado atual.
ALTER TYPE "TelemetryDeviceKind" ADD VALUE 'ANDROID_PHONE';
ALTER TYPE "TelemetryMeasurementSource" ADD VALUE 'HEALTH_CONNECT';

ALTER TABLE "TelemetryEnrollment" ALTER COLUMN "kind" DROP NOT NULL;

ALTER TABLE "TelemetrySnapshot"
  ADD COLUMN "deviceKind" "TelemetryDeviceKind",
  ADD COLUMN "lastReceivedAt" TIMESTAMP(3);
