-- Polígono da área demarcada ao iniciar a evacuação: anel fechado
-- [[lng,lat],...] guardado como JSON. Nula nas evacuações antigas e em toda
-- evacuação disparada sem recorte visual; a notificação segue valendo para a
-- organização inteira, a área é só a marcação no mapa.
ALTER TABLE "Evacuation"
  ADD COLUMN "area" JSONB;
