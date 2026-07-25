-- CreateTable
CREATE TABLE "WorkerPosition" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerPosition_workerId_key" ON "WorkerPosition"("workerId");

-- AddForeignKey
ALTER TABLE "WorkerPosition" ADD CONSTRAINT "WorkerPosition_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
