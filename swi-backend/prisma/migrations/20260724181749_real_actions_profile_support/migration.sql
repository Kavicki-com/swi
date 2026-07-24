-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "bloodType" TEXT,
ADD COLUMN     "chronicConditions" TEXT,
ADD COLUMN     "examKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "managerName" TEXT;

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "reason" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);
