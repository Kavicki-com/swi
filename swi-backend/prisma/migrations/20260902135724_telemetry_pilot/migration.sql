-- CreateEnum
CREATE TYPE "TelemetryOrigin" AS ENUM ('REAL', 'DEMO');

-- CreateEnum
CREATE TYPE "TelemetryDeviceKind" AS ENUM ('APPLE_WATCH', 'IPHONE', 'EXTERNAL_CUFF');

-- CreateEnum
CREATE TYPE "TelemetrySessionStatus" AS ENUM ('ACTIVE', 'INTERRUPTED', 'ENDED');

-- CreateEnum
CREATE TYPE "TelemetryMeasurementSource" AS ENUM ('APPLE_WATCH', 'EXTERNAL_CUFF', 'MANUAL_HEALTHKIT', 'MANUAL_SWI', 'DERIVED');

-- CreateEnum
CREATE TYPE "TelemetryConditionKind" AS ENUM ('HEART_RATE_HIGH', 'HEART_RATE_LOW', 'BLOOD_PRESSURE_REVIEW', 'DEVICE_BATTERY_LOW', 'DEVICE_SIGNAL_LOST');

-- CreateEnum
CREATE TYPE "TelemetryConditionStatus" AS ENUM ('ACTIVE', 'RECOVERED');

-- CreateEnum
CREATE TYPE "OperationalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "TelemetryDevice" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "kind" "TelemetryDeviceKind" NOT NULL,
    "model" TEXT,
    "credentialHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetrySession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "origin" "TelemetryOrigin" NOT NULL,
    "status" "TelemetrySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "interruptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "stepsTotal" INTEGER,
    "activeEnergyKcalTotal" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetrySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetrySample" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "origin" "TelemetryOrigin" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "journeyId" TEXT,
    "taskId" TEXT,
    "heartRateBpm" DOUBLE PRECISION,
    "stepDelta" INTEGER,
    "activeEnergyKcal" DOUBLE PRECISION,
    "motionCount" DOUBLE PRECISION,
    "batteryPercent" DOUBLE PRECISION,
    "systolicMmHg" INTEGER,
    "diastolicMmHg" INTEGER,
    "bloodPressureSource" "TelemetryMeasurementSource",
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetrySample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetrySnapshot" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "origin" "TelemetryOrigin" NOT NULL,
    "lastEventId" TEXT,
    "lastEventTime" TIMESTAMP(3) NOT NULL,
    "heartRateBpm" DOUBLE PRECISION,
    "heartRateAt" TIMESTAMP(3),
    "stepsTotal" INTEGER,
    "stepsAt" TIMESTAMP(3),
    "activeEnergyKcal" DOUBLE PRECISION,
    "activeEnergyAt" TIMESTAMP(3),
    "movementPerMinute" DOUBLE PRECISION,
    "movementAt" TIMESTAMP(3),
    "batteryPercent" DOUBLE PRECISION,
    "batteryAt" TIMESTAMP(3),
    "systolicMmHg" INTEGER,
    "diastolicMmHg" INTEGER,
    "bloodPressureSource" "TelemetryMeasurementSource",
    "bloodPressureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetrySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryAssessment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "origin" "TelemetryOrigin" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "effortPercent" DOUBLE PRECISION,
    "wearPercent" DOUBLE PRECISION,
    "formulaVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryCondition" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "origin" "TelemetryOrigin" NOT NULL,
    "kind" "TelemetryConditionKind" NOT NULL,
    "status" "TelemetryConditionStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "thresholdProfile" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalAlert" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "OperationalAlertStatus" NOT NULL DEFAULT 'OPEN',
    "triagedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryDevice_workerId_revokedAt_idx" ON "TelemetryDevice"("workerId", "revokedAt");

-- CreateIndex
CREATE INDEX "TelemetrySession_workerId_startedAt_idx" ON "TelemetrySession"("workerId", "startedAt");

-- CreateIndex
CREATE INDEX "TelemetrySession_origin_status_idx" ON "TelemetrySession"("origin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetrySample_eventId_key" ON "TelemetrySample"("eventId");

-- CreateIndex
CREATE INDEX "TelemetrySample_workerId_eventTime_idx" ON "TelemetrySample"("workerId", "eventTime");

-- CreateIndex
CREATE INDEX "TelemetrySample_sessionId_eventTime_idx" ON "TelemetrySample"("sessionId", "eventTime");

-- CreateIndex
CREATE INDEX "TelemetrySample_receivedAt_idx" ON "TelemetrySample"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetrySample_sessionId_sequence_key" ON "TelemetrySample"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetrySnapshot_workerId_key" ON "TelemetrySnapshot"("workerId");

-- CreateIndex
CREATE INDEX "TelemetrySnapshot_origin_lastEventTime_idx" ON "TelemetrySnapshot"("origin", "lastEventTime");

-- CreateIndex
CREATE INDEX "TelemetrySnapshot_sessionId_idx" ON "TelemetrySnapshot"("sessionId");

-- CreateIndex
CREATE INDEX "TelemetryAssessment_workerId_computedAt_idx" ON "TelemetryAssessment"("workerId", "computedAt");

-- CreateIndex
CREATE INDEX "TelemetryAssessment_sessionId_computedAt_idx" ON "TelemetryAssessment"("sessionId", "computedAt");

-- CreateIndex
CREATE INDEX "TelemetryCondition_workerId_status_idx" ON "TelemetryCondition"("workerId", "status");

-- CreateIndex
CREATE INDEX "TelemetryCondition_status_lastSeenAt_idx" ON "TelemetryCondition"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "TelemetryCondition_sessionId_idx" ON "TelemetryCondition"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalAlert_conditionId_key" ON "OperationalAlert"("conditionId");

-- CreateIndex
CREATE INDEX "OperationalAlert_status_createdAt_idx" ON "OperationalAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalAlert_workerId_status_idx" ON "OperationalAlert"("workerId", "status");

-- AddForeignKey
ALTER TABLE "TelemetryDevice" ADD CONSTRAINT "TelemetryDevice_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySession" ADD CONSTRAINT "TelemetrySession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TelemetryDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySession" ADD CONSTRAINT "TelemetrySession_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySample" ADD CONSTRAINT "TelemetrySample_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TelemetrySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySample" ADD CONSTRAINT "TelemetrySample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TelemetryDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySample" ADD CONSTRAINT "TelemetrySample_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySnapshot" ADD CONSTRAINT "TelemetrySnapshot_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetrySnapshot" ADD CONSTRAINT "TelemetrySnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TelemetrySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryAssessment" ADD CONSTRAINT "TelemetryAssessment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryAssessment" ADD CONSTRAINT "TelemetryAssessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TelemetrySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryCondition" ADD CONSTRAINT "TelemetryCondition_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryCondition" ADD CONSTRAINT "TelemetryCondition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TelemetrySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "TelemetryCondition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
