-- Condição de desgaste alto. Até aqui o "alerta a 80%" era limiar da fórmula,
-- sem condição que abrisse; a partir daqui é condição e vira item de fila.
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'WEAR_HIGH';

-- Duas medições novas do relógio. Distância é variação, sob o contrato de
-- delta de stepDelta; oxigenação é medição pontual, medida só em repouso.
ALTER TABLE "TelemetrySample"
  ADD COLUMN "distanceDeltaM" DOUBLE PRECISION,
  ADD COLUMN "oxygenSaturationPct" DOUBLE PRECISION;

-- A última oxigenação vive no snapshot com o próprio horário, como a pressão.
-- Distância não tem coluna aqui: é acumulado do dia, somado pelo read model.
ALTER TABLE "TelemetrySnapshot"
  ADD COLUMN "oxygenSaturationPct" DOUBLE PRECISION,
  ADD COLUMN "oxygenSaturationAt" TIMESTAMP(3);

-- O Resumo do dia soma a distância como soma os passos.
ALTER TABLE "TelemetryDailySummary"
  ADD COLUMN "distanceTotalM" DOUBLE PRECISION,
  ADD COLUMN "distanceCount" INTEGER;

-- Minutos até o desgaste cruzar o limiar do alerta, gravados com esforço e
-- desgaste. Nulo quando a intensidade recente não leva até lá.
ALTER TABLE "TelemetryAssessment" ADD COLUMN "fatigueEtaMin" INTEGER;
