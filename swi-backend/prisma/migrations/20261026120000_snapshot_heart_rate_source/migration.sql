-- A fonte do batimento promovido no atual, ao lado do valor e do horário. É o
-- que separa o batimento do Health Connect, válido até 60 min, do relógio e do
-- Bluetooth, válidos só ao vivo (ADR-0011). Aditivo e sem cópia: o snapshot
-- antigo fica nulo, e nulo vale como ao vivo até o próximo evento gravar a fonte.
ALTER TABLE "TelemetrySnapshot" ADD COLUMN "heartRateSource" "TelemetryMeasurementSource";
