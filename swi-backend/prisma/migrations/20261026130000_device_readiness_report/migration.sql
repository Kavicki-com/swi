-- Relato de prontidão do celular Android: o que só ele sabe do Health Connect e
-- da pulseira por Bluetooth, guardado no próprio aparelho. Tudo aditivo e
-- opcional: aparelho sem relato fica com as colunas nulas.
CREATE TYPE "HealthConnectAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'UPDATE_REQUIRED');

CREATE TYPE "HealthConnectFailureReason" AS ENUM ('PERMISSION_DENIED', 'UNAVAILABLE', 'UPDATE_REQUIRED', 'OTHER');

CREATE TYPE "BluetoothListenerState" AS ENUM ('CONNECTED', 'SEARCHING', 'BLUETOOTH_OFF', 'ENDED');

ALTER TABLE "TelemetryDevice"
ADD COLUMN "readinessReportedAt" TIMESTAMP(3),
ADD COLUMN "healthConnectAvailability" "HealthConnectAvailability",
ADD COLUMN "healthConnectReadGranted" BOOLEAN,
ADD COLUMN "healthConnectBackgroundGranted" BOOLEAN,
ADD COLUMN "healthConnectPackage" TEXT,
ADD COLUMN "healthConnectLastSyncAt" TIMESTAMP(3),
ADD COLUMN "healthConnectFailureReason" "HealthConnectFailureReason",
ADD COLUMN "healthConnectFailureAt" TIMESTAMP(3),
ADD COLUMN "bluetoothBandChosen" BOOLEAN,
ADD COLUMN "bluetoothListenerState" "BluetoothListenerState",
ADD COLUMN "bluetoothListenerStateSince" TIMESTAMP(3),
ADD COLUMN "bluetoothLastReadingAt" TIMESTAMP(3);
