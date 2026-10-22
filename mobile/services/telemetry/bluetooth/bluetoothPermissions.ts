import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { requiredBluetoothPermissions } from '../../../modules/swi-ble-heart-rate/src';

// O pedido das permissões de Bluetooth, antes de procurar a pulseira. Quais
// são depende da versão do Android (requiredBluetoothPermissions, da ponte).
// O sistema não mostra a folha de novo depois de "não perguntar de novo":
// aí o caminho é pelos ajustes do app.

export type BluetoothPermissionAnswer = 'granted' | 'denied' | 'blocked';

export interface BluetoothPermissions {
  request(): Promise<BluetoothPermissionAnswer>;
  openSettings(): void;
}

export function createBluetoothPermissions(apiLevel: number): BluetoothPermissions {
  return {
    async request() {
      const wanted = requiredBluetoothPermissions(apiLevel) as Permission[];
      let answers: Partial<Record<string, string>>;
      try {
        answers = await PermissionsAndroid.requestMultiple(wanted);
      } catch {
        return 'denied';
      }
      const results = wanted.map((permission) => answers[permission]);
      if (results.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return 'blocked';
      return results.every((result) => result === PermissionsAndroid.RESULTS.GRANTED)
        ? 'granted'
        : 'denied';
    },
    openSettings() {
      Linking.openSettings().catch(() => undefined);
    },
  };
}

/** As do aparelho em uso; fora do Android a versão não importa. */
export const bluetoothPermissions: BluetoothPermissions = createBluetoothPermissions(
  typeof Platform.Version === 'number' ? Platform.Version : 0,
);
