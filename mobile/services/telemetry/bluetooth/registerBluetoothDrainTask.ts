import { AppRegistry, Platform } from 'react-native';
import { uuid } from 'expo-modules-core';
import { bleHeartRate } from '../../../modules/swi-ble-heart-rate/src';
import { createFilePositionStorage } from '../../positions/positionOutbox';
import { createTrackingWindowStore, TRACKING_WINDOW_FILE_NAME } from '../../positions/trackingWindow';
import { androidDeviceControl } from '../android/androidDeviceControl';
import { sharedTelemetryOutbox } from '../telemetryRuntime';
import { createTelemetryUploader } from '../telemetryUploader';
import {
  BLE_DRAIN_STATE_FILE_NAME,
  BLE_DRAIN_TASK_NAME,
  createBluetoothInboxDrain,
  type BluetoothInboxDrain,
} from './bluetoothInboxDrain';

let drain: BluetoothInboxDrain | null = null;

// Montada na primeira execução, e não no carregamento do bundle: abrir a app
// sem pulseira não toca nenhum dos arquivos. A fila é a ÚNICA do runtime
// (telemetryRuntime.ts), a mesma do envio em primeiro plano; o uploader é
// próprio, como o da tarefa do Health Connect, e vai pelo controle do
// Android, que usa XMLHttpRequest com prazo (o `fetch` pendura sem tela).
function drainOnce(): BluetoothInboxDrain {
  if (drain === null) {
    const outbox = sharedTelemetryOutbox();
    drain = createBluetoothInboxDrain({
      ble: bleHeartRate,
      window: createTrackingWindowStore(createFilePositionStorage(TRACKING_WINDOW_FILE_NAME)),
      state: createFilePositionStorage(BLE_DRAIN_STATE_FILE_NAME),
      outbox,
      uploader: createTelemetryUploader({ outbox, control: androidDeviceControl }),
      control: androidDeviceControl,
      now: () => new Date(),
      uuidV4: () => uuid.v4(),
    });
  }
  return drain;
}

/**
 * Registra a tarefa sem interface que o serviço da pulseira acorda. Precisa
 * rodar no carregamento do bundle (index.js): o sistema pode relançar o
 * processo só para ela, sem tela nenhuma montada. Só no Android, onde o
 * módulo existe; sem pulseira escolhida o serviço nunca sobe e a tarefa
 * nunca é chamada, então o registro dispensa o gate.
 */
export function registerBluetoothDrainTask(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(BLE_DRAIN_TASK_NAME, () => () => drainOnce().run());
}
