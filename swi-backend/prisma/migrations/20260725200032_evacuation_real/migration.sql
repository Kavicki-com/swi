-- CreateEnum
CREATE TYPE "EvacuationStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterEnum
ALTER TYPE "NotificationDomain" ADD VALUE 'evacuation';

-- CreateTable
CREATE TABLE "Evacuation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "startedById" TEXT NOT NULL,
    "status" "EvacuationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Evacuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvacuationAck" (
    "id" TEXT NOT NULL,
    "evacuationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "ackAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvacuationAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvacuationAck_evacuationId_workerId_key" ON "EvacuationAck"("evacuationId", "workerId");

-- AddForeignKey
ALTER TABLE "Evacuation" ADD CONSTRAINT "Evacuation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evacuation" ADD CONSTRAINT "Evacuation_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvacuationAck" ADD CONSTRAINT "EvacuationAck_evacuationId_fkey" FOREIGN KEY ("evacuationId") REFERENCES "Evacuation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvacuationAck" ADD CONSTRAINT "EvacuationAck_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
