-- AlterTable
ALTER TABLE "TelemetrySession" DROP COLUMN "activeEnergyKcalTotal",
DROP COLUMN "stepsTotal";

-- CreateTable
CREATE TABLE "TelemetryDailySummary" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "origin" "TelemetryOrigin" NOT NULL,
    "heartRateMin" DOUBLE PRECISION,
    "heartRateMax" DOUBLE PRECISION,
    "heartRateAvg" DOUBLE PRECISION,
    "heartRateCount" INTEGER,
    "heartRateCoveredMs" INTEGER,
    "stepsTotal" INTEGER,
    "stepsCount" INTEGER,
    "activeEnergyKcalTotal" DOUBLE PRECISION,
    "activeEnergyCount" INTEGER,
    "effortMax" DOUBLE PRECISION,
    "effortAvg" DOUBLE PRECISION,
    "effortCount" INTEGER,
    "effortAbove80Ms" INTEGER,
    "wearMax" DOUBLE PRECISION,
    "wearAvg" DOUBLE PRECISION,
    "wearCount" INTEGER,
    "wearAbove80Ms" INTEGER,
    "bloodPressureCount" INTEGER,
    "lastSystolicMmHg" INTEGER,
    "lastDiastolicMmHg" INTEGER,
    "lastBloodPressureSource" "TelemetryMeasurementSource",
    "lastBloodPressureAt" TIMESTAMP(3),
    "batteryMin" DOUBLE PRECISION,
    "sampleCount" INTEGER NOT NULL,
    "sessionCount" INTEGER,
    "firstSampleAt" TIMESTAMP(3),
    "lastSampleAt" TIMESTAMP(3),
    "coveredMs" INTEGER,
    "summarizerVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryDailySummary_day_idx" ON "TelemetryDailySummary"("day");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryDailySummary_workerId_day_origin_key" ON "TelemetryDailySummary"("workerId", "day", "origin");

-- AddForeignKey
ALTER TABLE "TelemetryDailySummary" ADD CONSTRAINT "TelemetryDailySummary_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
