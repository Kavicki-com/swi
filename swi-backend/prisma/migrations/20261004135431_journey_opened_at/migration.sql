-- Quando a jornada saiu de ociosa. Um turno aberto num dia anterior continua
-- valendo por um tempo contado a partir daqui, para a virada do dia não cortar
-- quem trabalha à noite. Nula nos registros antigos e em toda jornada ociosa:
-- jornada aberta sem esta hora nunca atravessa a virada.
ALTER TABLE "Journey"
  ADD COLUMN "openedAt" TIMESTAMP(3);

-- Quem está em turno na hora do deploy seria cortado na meia-noite seguinte,
-- porque a jornada dele não tem a hora. Preenche só as abertas do dia corrente
-- de Brasília (UTC-3 fixo). A hora real de abertura não foi guardada: a última
-- retomada ou a última gravação fica no lugar, o que só alonga o prazo. Dias
-- anteriores ficam de fora de propósito: lá estão jornadas abandonadas pela
-- virada antiga, que voltariam a aparecer como turno em andamento.
UPDATE "Journey"
  SET "openedAt" = COALESCE("startedAt", "updatedAt")
  WHERE "state" <> 'idle'
    AND "date" = ((now() AT TIME ZONE 'UTC') - INTERVAL '3 hours')::date;
