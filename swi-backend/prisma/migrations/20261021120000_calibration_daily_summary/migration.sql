-- Resumo diário v3: o que a calibração individual lê de cada dia.
CREATE TYPE "CalibrationDeviceFamily" AS ENUM ('WATCH', 'BAND');

ALTER TABLE "TelemetryDailySummary"
  ADD COLUMN "heartRateP25" DOUBLE PRECISION,
  ADD COLUMN "heartRateP90" DOUBLE PRECISION,
  ADD COLUMN "oxygenSaturationP10" DOUBLE PRECISION,
  ADD COLUMN "oxygenSaturationP50" DOUBLE PRECISION,
  ADD COLUMN "oxygenSaturationCount" INTEGER,
  ADD COLUMN "bodyTemperatureP10" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureP25" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureP75" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureP90" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureCount" INTEGER,
  ADD COLUMN "movementPerMinuteMedian" DOUBLE PRECISION,
  ADD COLUMN "effortP25" DOUBLE PRECISION,
  ADD COLUMN "effortP90" DOUBLE PRECISION,
  ADD COLUMN "systolicAvg" DOUBLE PRECISION,
  ADD COLUMN "diastolicAvg" DOUBLE PRECISION,
  ADD COLUMN "deviceFamily" "CalibrationDeviceFamily";
