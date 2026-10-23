-- Trilha de auditoria do acesso a dado de saúde pelo painel. Sem chave
-- estrangeira para User nem para Company: a linha sobrevive à exclusão da
-- conta de quem agiu e de quem teve os dados lidos. Aditiva: nenhuma tabela
-- existente muda aqui.

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('HEALTH_CURRENT_READ', 'HEALTH_SERIES_READ', 'CALIBRATION_READ', 'CALIBRATION_HISTORY_READ', 'CONDITIONS_READ', 'SESSION_HISTORY_READ', 'USER_DETAIL_READ', 'DEVICE_READ', 'USER_CREATED', 'USER_UPDATED', 'USER_APPROVED', 'USER_REJECTED', 'USER_DELETED', 'EXAM_ADDED', 'EXAM_REMOVED', 'BANDS_CHANGED', 'SAFETY_CHANGED', 'MONITORING_PAUSED', 'MONITORING_RESUMED', 'PAUSE_REQUESTED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED', 'DEVICE_ENROLLED', 'DEVICE_REVOKED', 'RESCUE_STARTED', 'RESCUE_ARRIVED', 'RESCUE_ENDED');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectUserId_createdAt_idx" ON "AuditEvent"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_subjectUserId_action_createdAt_idx" ON "AuditEvent"("actorId", "subjectUserId", "action", "createdAt");
