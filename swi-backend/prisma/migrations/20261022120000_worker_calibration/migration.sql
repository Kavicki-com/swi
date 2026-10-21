-- Calibração individual: faixas por pessoa, travas mudadas pelo admin e o
-- histórico das correções. Só origem REAL grava aqui.

-- CreateEnum
CREATE TYPE "CalibrationMetric" AS ENUM ('HEART_RATE', 'OXYGEN_SATURATION', 'BODY_TEMPERATURE', 'SYSTOLIC', 'DIASTOLIC', 'EFFORT', 'WEAR', 'STEPS', 'DISTANCE', 'ACTIVE_ENERGY', 'MOVEMENT');

-- CreateEnum
CREATE TYPE "SafetyRule" AS ENUM ('HEART_RATE_HIGH', 'HEART_RATE_LOW', 'OXYGEN_LOW', 'BLOOD_PRESSURE_HIGH', 'WEAR_HIGH');

-- CreateEnum
CREATE TYPE "CalibrationChangeAction" AS ENUM ('BAND_OVERRIDE', 'BAND_REVERT', 'SAFETY_SET', 'SAFETY_REVERT', 'RECALIBRATE_DEVICE');

-- CreateTable
CREATE TABLE "WorkerCalibration" (
    "workerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "deviceFamily" "CalibrationDeviceFamily" NOT NULL,
    "phaseStartedAt" DATE NOT NULL,
    "recalibrating" BOOLEAN NOT NULL DEFAULT false,
    "validDays" INTEGER NOT NULL,
    "restingBpm" DOUBLE PRECISION,
    "peakBpm" DOUBLE PRECISION,
    "peakPersonalBpm" DOUBLE PRECISION,
    "peakStartBpm" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerCalibration_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "WorkerCalibrationBand" (
    "workerId" TEXT NOT NULL,
    "metric" "CalibrationMetric" NOT NULL,
    "validDays" INTEGER NOT NULL,
    "startCuts" JSONB NOT NULL,
    "learnedCuts" JSONB NOT NULL,
    "overrideCuts" JSONB,
    "overrideById" TEXT,
    "overrideAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerCalibrationBand_pkey" PRIMARY KEY ("workerId","metric")
);

-- CreateTable
CREATE TABLE "WorkerSafetyLimit" (
    "workerId" TEXT NOT NULL,
    "rule" "SafetyRule" NOT NULL,
    "values" JSONB NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSafetyLimit_pkey" PRIMARY KEY ("workerId","rule")
);

-- CreateTable
CREATE TABLE "WorkerCalibrationChange" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "action" "CalibrationChangeAction" NOT NULL,
    "metric" "CalibrationMetric",
    "rule" "SafetyRule",
    "from" JSONB,
    "to" JSONB,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerCalibrationChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerCalibrationChange_workerId_at_idx" ON "WorkerCalibrationChange"("workerId", "at");

-- AddForeignKey
ALTER TABLE "WorkerCalibration" ADD CONSTRAINT "WorkerCalibration_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCalibrationBand" ADD CONSTRAINT "WorkerCalibrationBand_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSafetyLimit" ADD CONSTRAINT "WorkerSafetyLimit_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCalibrationChange" ADD CONSTRAINT "WorkerCalibrationChange_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
