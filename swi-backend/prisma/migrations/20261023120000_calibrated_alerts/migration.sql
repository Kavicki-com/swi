-- Alertas calibrados (perfil swi-alert-calibrated-3): camada de Atenção pela
-- faixa de fadiga da pessoa e travas novas de oxigenação e pressão.
--
-- As revisões de pressão REAIS ainda abertas não fecham aqui: valor novo de
-- enum não pode ser usado na mesma transação em que nasce. Quem as fecha é
-- scripts/calibration/retire-blood-pressure-review.ts, depois do deploy.

-- AlterEnum
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'HEART_RATE_FATIGUE';
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'OXYGEN_FATIGUE';
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'WEAR_FATIGUE';
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'BLOOD_PRESSURE_FATIGUE';
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'OXYGEN_LOW';
ALTER TYPE "TelemetryConditionKind" ADD VALUE 'BLOOD_PRESSURE_HIGH';

-- AlterEnum
ALTER TYPE "TelemetryConditionRecoveryReason" ADD VALUE 'PROFILE_RETIRED';

-- AlterTable: dia da calibração quando a condição abriu; nulo depois do dia 30
-- e na DEMO.
ALTER TABLE "TelemetryCondition" ADD COLUMN "calibrationDay" INTEGER;
