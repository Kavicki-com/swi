-- Localização da obra por empresa, para o clima e os alertas meteorológicos.
-- Nula enquanto a empresa não informa: vale o local padrão do serviço.
ALTER TABLE "Company"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;

-- Registro do aviso por empresa e por tipo de alerta, com o fim da janela
-- avisada, para o mesmo alerta não avisar de novo a cada rodada.
ALTER TABLE "WeatherAlertSeen"
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "endsAt" TIMESTAMP(3);

CREATE INDEX "WeatherAlertSeen_scope_kind_endsAt_idx" ON "WeatherAlertSeen"("scope", "kind", "endsAt");
