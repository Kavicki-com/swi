-- Ponto de encontro da evacuação, [lng, lat]: destino da rota de cada
-- funcionário. Coluna nula e aditiva, então evacuações anteriores a esta
-- migration continuam sem ponto (e sem rota).
ALTER TABLE "Evacuation" ADD COLUMN "musterPoint" JSONB;
