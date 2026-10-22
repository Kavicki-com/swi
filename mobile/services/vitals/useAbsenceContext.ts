import { Platform } from 'react-native';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { bleHeartRate, type BleHeartRate } from '../../modules/swi-ble-heart-rate/src';
import { sharedBandChoiceStore, useBandChoice } from '../telemetry/bluetooth/bluetoothBandChoice';
import { useBleListener } from '../telemetry/bluetooth/useBleListener';
import { useTelemetryUploadState } from '../telemetry/TelemetryUploadProvider';
import { SEM_BLUETOOTH } from '../telemetry/useReadiness';
import type { WatchDiagnosticsState } from '../telemetry/watchDiagnostics';
import { androidAbsenceContext, type AbsenceContext } from './metricAbsence';

// De onde sai o rótulo de cada métrica sem valor, nas telas de vitais.
//
// - Android com o Health Connect: a última rodada do leitor (contexto do
//   envio) e a escuta da pulseira (ponte do Bluetooth, só com o gate dela).
// - iPhone com o módulo do relógio: só se a sessão espelhada está ativa,
//   porque o iOS esconde o motivo (ADR-0004).
// - O resto (sem gate, sem módulo, Expo Go): null, e a tela fica com os
//   rótulos de sempre.
//
// O relógio do aparelho é lido a cada render, sem tique próprio: ele só decide
// se a falha é de hoje, e a tela já renderiza a cada leitura nova.

export function useAbsenceContext(
  relogio: WatchDiagnosticsState,
  ble: BleHeartRate = bleHeartRate,
): AbsenceContext | null {
  const android = Platform.OS === 'android' && isFeatureEnabled('healthConnect');
  const listens = android && isFeatureEnabled('bluetoothHeartRate') && ble.supported;
  const { healthConnect } = useTelemetryUploadState();
  const band = useBandChoice(listens ? sharedBandChoiceStore() : SEM_BLUETOOTH);
  const listener = useBleListener(ble, listens);
  if (android) return androidAbsenceContext({ healthConnect, band, listener, now: Date.now() });
  if (relogio.support === 'ready') return { platform: 'ios', mirroredSession: relogio.session === 'running' };
  return null;
}
