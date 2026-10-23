import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import {
  bleHeartRate,
  bleHeartRateErrorCode,
  type BleHeartRate,
  type BleHeartRateErrorCode,
} from '../../../modules/swi-ble-heart-rate/src';
import { hasToken } from '../../api/http';
import { sharedBandChoiceStore } from './bluetoothBandChoice';

// Quando a escuta da pulseira pelo Bluetooth liga e desliga. Escolher a
// pulseira (Configurações > Monitoramento) é ativar o monitoramento: a escuta
// liga na hora, com o aparelho pareado, porque sem credencial nada do que se
// lê sobe. Desliga só ao encerrar (a escolha apagada), no logout e com o
// pareamento revogado. A jornada não liga nem desliga nada, e não há prazo.

export type BluetoothStartProblem = BleHeartRateErrorCode | 'unknown';

// A última falha ao ligar, para a tela dizer por que a pulseira não está em
// uso (permissão negada, por exemplo). Uma só por runtime, como o serviço.
let startProblem: BluetoothStartProblem | null = null;
const problemListeners = new Set<() => void>();
function setStartProblem(next: BluetoothStartProblem | null) {
  if (startProblem === next) return;
  startProblem = next;
  problemListeners.forEach((listener) => listener());
}

/** A última falha ao ligar a escuta; null depois de ligar ou desligar. */
export function bluetoothStartProblem(): BluetoothStartProblem | null {
  return startProblem;
}

/** Só para a suíte. */
export function resetBluetoothStartProblem(): void {
  startProblem = null;
}

const subscribeProblem = (listener: () => void) => {
  problemListeners.add(listener);
  return () => {
    problemListeners.delete(listener);
  };
};

export function useBluetoothStartProblem(): BluetoothStartProblem | null {
  return useSyncExternalStore(subscribeProblem, bluetoothStartProblem);
}

const stopQuietly = (ble: BleHeartRate) => {
  setStartProblem(null);
  ble.stop().catch(() => undefined);
};

export interface BluetoothHeartRateInput {
  userId: string | null;
  /** Credencial do aparelho; cai com o pareamento revogado (401). */
  paired: boolean;
  /** Pulseira escolhida; `undefined` antes de o arquivo ser lido. */
  deviceId: string | null | undefined;
}

/**
 * Segue a escolha da pulseira e o pareamento. Escolha ainda não lida não
 * age, para o app aberto não desligar e religar o serviço que o sistema
 * manteve de pé.
 */
export function useBluetoothHeartRate(
  { userId, paired, deviceId }: BluetoothHeartRateInput,
  ble: BleHeartRate = bleHeartRate,
  enabled: boolean = isFeatureEnabled('bluetoothHeartRate'),
): void {
  const active = enabled && ble.supported;
  useEffect(() => {
    if (!active || !userId || deviceId === undefined) return;
    if (!paired || deviceId === null) {
      stopQuietly(ble);
      return;
    }
    let alive = true;
    const turnOn = () => {
      // O Android recusa subir serviço em primeiro plano pedido do segundo
      // plano. Depois de ligado, quem relança é o sistema.
      if (!alive || AppState.currentState !== 'active') return;
      ble.start(deviceId).then(
        () => setStartProblem(null),
        (error: unknown) => setStartProblem(bleHeartRateErrorCode(error) ?? 'unknown'),
      );
    };
    turnOn();
    // Ligar pode falhar por falta de permissão, e quem a libera nos ajustes
    // volta ao app pelo primeiro plano: é a hora de tentar de novo. Com o
    // serviço de pé, o pedido não muda nada.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') turnOn();
    });
    // Desmontar não desliga: o layout autenticado desmonta no logout, e quem
    // desliga ali é a sessão (useBluetoothHeartRateSession).
    return () => {
      alive = false;
      sub.remove();
    };
  }, [active, userId, paired, deviceId, ble]);
}

const endSharedBand = () => sharedBandChoiceStore().end();

/**
 * Logout encerra o monitoramento: a escuta desliga e a escolha da pulseira é
 * apagada, para o celular não seguir lendo a pulseira de quem saiu, nem
 * religar com ela para quem entrar depois.
 */
function endQuietly(ble: BleHeartRate, endBand: () => Promise<void>) {
  stopQuietly(ble);
  endBand().catch((error: unknown) => {
    console.warn(`[useBluetoothHeartRate] escolha da pulseira não apagada: ${String(error)}`);
  });
}

/**
 * Segue a sessão. Montado na raiz, fora do layout autenticado, porque é ali
 * que o logout é visto.
 */
export function useBluetoothHeartRateSession(
  userId: string | null,
  restoring: boolean,
  ble: BleHeartRate = bleHeartRate,
  enabled: boolean = isFeatureEnabled('bluetoothHeartRate'),
  tokenExists: () => Promise<boolean> = hasToken,
  endBand: () => Promise<void> = endSharedBand,
): void {
  const active = enabled && ble.supported;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    if (active && before && !userId) endQuietly(ble, endBand);
  }, [active, userId, ble, endBand]);

  // App aberto sem sessão e sem token (expirou, ou a conta foi desativada):
  // o monitoramento que vinha de antes encerra. Com o token guardado não: sem
  // rede a sessão só não pôde ser confirmada.
  useEffect(() => {
    if (!active || restoring || userId) return;
    let alive = true;
    tokenExists().then(
      (exists) => {
        if (alive && !exists) endQuietly(ble, endBand);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [active, restoring, userId, ble, tokenExists, endBand]);
}
