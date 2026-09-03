-- CreateTable
CREATE TABLE "TelemetryEnrollment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "kind" "TelemetryDeviceKind" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryEnrollment_workerId_consumedAt_idx" ON "TelemetryEnrollment"("workerId", "consumedAt");

-- CreateIndex
CREATE INDEX "TelemetryEnrollment_expiresAt_idx" ON "TelemetryEnrollment"("expiresAt");

-- AddForeignKey
ALTER TABLE "TelemetryEnrollment" ADD CONSTRAINT "TelemetryEnrollment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEnrollment" ADD CONSTRAINT "TelemetryEnrollment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
