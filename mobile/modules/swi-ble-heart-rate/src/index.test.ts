import { bleHeartRate, bleHeartRateErrorCode, requiredBluetoothPermissions } from './index';

describe('instância do runtime', () => {
  it('fica inerte sem módulo compilado, como no Jest', async () => {
    expect(bleHeartRate.supported).toBe(false);
    expect(bleHeartRate.status().state).toBe('idle');
    const error = await bleHeartRate.scan().catch((e: unknown) => e);
    expect(bleHeartRateErrorCode(error)).toBe('E_UNSUPPORTED');
  });

  it('reexporta os utilitários do contrato', () => {
    expect(requiredBluetoothPermissions(33)).toHaveLength(2);
  });
});
