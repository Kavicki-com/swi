-- Episódios repetidos: o episódio atrasado (abriu e fechou dentro do lote da
-- pulseira) passa a guardar a hora em que o lote chegou, e o terceiro do mesmo
-- tipo no mesmo dia monitorado abre uma condição própria, com o tipo repetido.
-- Aditiva: nenhuma linha existente muda aqui.

-- AlterEnum
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'REPEATED_EPISODES';

-- AlterTable
ALTER TABLE "TelemetryCondition" ADD COLUMN     "episodeKind" "TelemetryConditionKind",
ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TelemetryCondition_workerId_kind_firstSeenAt_idx" ON "TelemetryCondition"("workerId", "kind", "firstSeenAt");
