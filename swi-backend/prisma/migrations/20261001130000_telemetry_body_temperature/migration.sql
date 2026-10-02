-- Temperatura corporal, lida do app Saúde pelo iPhone. Medição pontual como a
-- pressão: guarda a origem para o painel saber de onde veio o número.
ALTER TABLE "TelemetrySample"
  ADD COLUMN "bodyTemperatureC" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureSource" "TelemetryMeasurementSource";

-- A última temperatura vive no snapshot com a própria origem e o próprio
-- horário, como a pressão e a oxigenação.
ALTER TABLE "TelemetrySnapshot"
  ADD COLUMN "bodyTemperatureC" DOUBLE PRECISION,
  ADD COLUMN "bodyTemperatureSource" "TelemetryMeasurementSource",
  ADD COLUMN "bodyTemperatureAt" TIMESTAMP(3);
