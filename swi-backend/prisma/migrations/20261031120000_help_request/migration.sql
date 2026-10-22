-- Pedido de ajuda pelo app: um tipo de condição novo, que nasce recuperada e
-- leva o alerta urgente à fila, e o vínculo do resgate com o pedido que ele
-- atende. Aditiva: nenhuma linha existente muda aqui.

-- AlterEnum
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'HELP_REQUESTED';

-- AlterTable
ALTER TABLE "Rescue" ADD COLUMN "helpAlertId" TEXT;

-- CreateIndex
CREATE INDEX "Rescue_helpAlertId_idx" ON "Rescue"("helpAlertId");

-- AddForeignKey
ALTER TABLE "Rescue" ADD CONSTRAINT "Rescue_helpAlertId_fkey" FOREIGN KEY ("helpAlertId") REFERENCES "OperationalAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
