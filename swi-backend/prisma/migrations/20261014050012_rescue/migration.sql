-- CreateEnum
CREATE TYPE "RescueStatus" AS ENUM ('dispatched', 'arrived', 'ended');

-- AlterEnum
ALTER TYPE "NotificationDomain" ADD VALUE 'rescue';

-- CreateTable
CREATE TABLE "Rescue" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "companyId" TEXT,
    "injuredId" TEXT NOT NULL,
    "rescuerId" TEXT NOT NULL,
    "status" "RescueStatus" NOT NULL DEFAULT 'dispatched',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rescue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rescue_number_key" ON "Rescue"("number");

-- CreateIndex
CREATE INDEX "Rescue_companyId_status_idx" ON "Rescue"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Rescue" ADD CONSTRAINT "Rescue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rescue" ADD CONSTRAINT "Rescue_injuredId_fkey" FOREIGN KEY ("injuredId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rescue" ADD CONSTRAINT "Rescue_rescuerId_fkey" FOREIGN KEY ("rescuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
