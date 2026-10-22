import { Platform } from 'react-native';
import { createBleHeartRate, loadNativeBleHeartRate } from './bleHeartRate';
import type { BleHeartRate } from './SwiBleHeartRate.types';

// Tipos, saneamento e leitor de código de erro, para os serviços e a tela
// importarem de um lugar só.
export * from './SwiBleHeartRate.types';
export { createBleHeartRate, loadNativeBleHeartRate, requiredBluetoothPermissions } from './bleHeartRate';

/** Instância única do runtime: o serviço nativo e a caixa de entrada são um só. */
export const bleHeartRate: BleHeartRate = createBleHeartRate(loadNativeBleHeartRate(Platform.OS));
