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
import type { JourneyState } from '../../journey/types';

// Quando a escuta da pulseira pelo Bluetooth liga e desliga. As mesmas regras
// do GPS (services/positions/useTrackingLifecycle.ts): só com a jornada em
// andamento ou pausada; para ao encerrar a jornada e no logout. As 12 h ficam
// com a drenagem, que confere a janela e chama `stop` sozinha. E duas regras
// a mais: só com pulseira escolhida (Configurações > Monitoramento) e com o
// aparelho pareado, porque sem credencial nada do que se lê sobe.

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
  journeyState: JourneyState;
  /** Falso até a jornada carregar: agir sobre o ocioso inicial desligaria tudo. */
  journeyKnown: boolean;
  paired: boolean;
  /** Pulseira escolhida; `undefined` antes de o arquivo ser lido. */
  deviceId: string | null | undefined;
}

/**
 * Segue a jornada. Montado dentro do JourneyProvider, como o GPS. Escolha da
 * pulseira ainda não lida não age, para o app aberto no meio da jornada não
 * desligar e religar o serviço que o sistema manteve de pé.
 */
export function useBluetoothHeartRate(
  { userId, journeyState, journeyKnown, paired, deviceId }: BluetoothHeartRateInput,
  ble: BleHeartRate = bleHeartRate,
  enabled: boolean = isFeatureEnabled('bluetoothHeartRate'),
): void {
  const active = enabled && ble.supported;
  const listens = journeyState !== 'idle' && paired && typeof deviceId === 'string';
  useEffect(() => {
    if (!active || !userId || !journeyKnown || deviceId === undefined) return;
    if (!listens || deviceId === null) {
      stopQuietly(ble);
      return;
    }
    const turnOn = () => {
      // O Android recusa subir serviço em primeiro plano pedido do segundo
      // plano. Depois de ligado, quem relança é o sistema.
      if (AppState.currentState !== 'active') return;
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
    return () => sub.remove();
  }, [active, userId, journeyKnown, listens, deviceId, ble]);
}

/**
 * Segue a sessão. Montado na raiz, fora do layout autenticado, porque é ali
 * que o logout é visto. A pulseira escolhida fica guardada.
 */
export function useBluetoothHeartRateSession(
  userId: string | null,
  restoring: boolean,
  ble: BleHeartRate = bleHeartRate,
  enabled: boolean = isFeatureEnabled('bluetoothHeartRate'),
  tokenExists: () => Promise<boolean> = hasToken,
): void {
  const active = enabled && ble.supported;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    if (active && before && !userId) stopQuietly(ble);
  }, [active, userId, ble]);

  // App aberto sem sessão e sem token (expirou, ou a conta foi desativada):
  // a escuta que vinha de antes desliga. Com o token guardado não: sem rede a
  // sessão só não pôde ser confirmada, e a jornada pode estar em andamento.
  useEffect(() => {
    if (!active || restoring || userId) return;
    let alive = true;
    tokenExists().then(
      (exists) => {
        if (alive && !exists) stopQuietly(ble);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [active, restoring, userId, ble, tokenExists]);
}
