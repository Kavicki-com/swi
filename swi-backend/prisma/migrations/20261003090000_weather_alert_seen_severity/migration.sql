-- Maior gravidade já avisada de cada alerta meteorológico. Quando um alerta
-- avisado como ATENCAO sobe para PERIGO, sai um segundo aviso. Nula nos
-- registros antigos, que contam como ATENCAO.
ALTER TABLE "WeatherAlertSeen"
  ADD COLUMN "severity" TEXT;
