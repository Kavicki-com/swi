-- CreateTable
CREATE TABLE "WorkerPositionSample" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "companyId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerPositionSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerPositionSample_companyId_recordedAt_idx" ON "WorkerPositionSample"("companyId", "recordedAt");

-- CreateIndex
CREATE INDEX "WorkerPositionSample_workerId_recordedAt_idx" ON "WorkerPositionSample"("workerId", "recordedAt");

-- AddForeignKey
ALTER TABLE "WorkerPositionSample" ADD CONSTRAINT "WorkerPositionSample_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

