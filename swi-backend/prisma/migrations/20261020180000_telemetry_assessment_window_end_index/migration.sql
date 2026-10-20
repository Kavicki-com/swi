-- A leitura atual escolhe a avaliação pelo instante medido mais recente, e não
-- pela calculada por último: a pulseira sincroniza dias velhos a qualquer hora,
-- e o recálculo de ontem pode sair depois do de hoje. Índice só aditivo.
CREATE INDEX "TelemetryAssessment_workerId_windowEnd_idx" ON "TelemetryAssessment"("workerId", "windowEnd");
