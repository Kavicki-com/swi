-- CreateTable
CREATE TABLE "WeatherAlertSeen" (
    "alertId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherAlertSeen_pkey" PRIMARY KEY ("alertId")
);
