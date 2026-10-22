-- Encerramento por vencimento: condição de saúde sem medição nova da métrica
-- em 24 h fecha com motivo próprio, distinto de normalizada e de silêncio.
-- Aditiva: nenhuma linha existente muda aqui. A varredura fecha as antigas
-- depois do deploy, em lotes, pelo agendamento da varredura de silêncio.

-- AlterEnum
ALTER TYPE "TelemetryConditionRecoveryReason" ADD VALUE 'NO_NEW_READING';
