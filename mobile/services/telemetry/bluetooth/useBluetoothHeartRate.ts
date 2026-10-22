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
import { getPositionRuntime } from '../../positions/positionTracking';

// Quando a escuta da pulseira pelo Bluetooth liga e desliga. As mesmas regras
// do GPS (services/positions/useTrackingLifecycle.ts): só com a jornada em
// andamento ou pausada; para ao encerrar a jornada e no logout. E só com a
// janela do rastreio aberta, a mesma do GPS: a drenagem para o serviço quando
// ela não existe (jornada da cópia guardada sem janela) ou venceu (12 h), e
// ligar sem ela viraria liga e desliga a cada volta ao app. Mais duas regras:
// só com pulseira escolhida (Configurações > Monitoramento) e com o aparelho
// pareado, porque sem credencial nada do que se lê sobe.

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
  /**
   * De onde a jornada veio. Da cópia guardada o GPS só retoma a janela que
   * existia; quando chega a do servidor, ele abre a janela e a escuta
   * pergunta por ela de novo.
   */
  journeySource?: 'server' | 'cache';
  paired: boolean;
  /** Pulseira escolhida; `undefined` antes de o arquivo ser lido. */
  deviceId: string | null | undefined;
}

const defaultWindowOpenFor = (userId: string) => getPositionRuntime().tracking.windowOpenFor(userId);

/**
 * Segue a jornada. Montado dentro do JourneyProvider, como o GPS. Escolha da
 * pulseira ainda não lida não age, para o app aberto no meio da jornada não
 * desligar e religar o serviço que o sistema manteve de pé.
 */
export function useBluetoothHeartRate(
  { userId, journeyState, journeyKnown, journeySource = 'server', paired, deviceId }: BluetoothHeartRateInput,
  ble: BleHeartRate = bleHeartRate,
  enabled: boolean = isFeatureEnabled('bluetoothHeartRate'),
  windowOpenFor: (userId: string) => Promise<boolean> = defaultWindowOpenFor,
): void {
  const active = enabled && ble.supported;
  const listens = journeyState !== 'idle' && paired && typeof deviceId === 'string';
  useEffect(() => {
    if (!active || !userId || !journeyKnown || deviceId === undefined) return;
    if (!listens || deviceId === null) {
      stopQuietly(ble);
      return;
    }
    let alive = true;
    const turnOn = () => {
      // O Android recusa subir serviço em primeiro plano pedido do segundo
      // plano. Depois de ligado, quem relança é o sistema.
      if (AppState.currentState !== 'active') return;
      // A janela é lida depois do ligar do GPS pedido no mesmo render (ele
      // monta antes), então a jornada lida do servidor já a encontra aberta.
      windowOpenFor(userId).then(
        (open) => {
          if (!alive) return;
          if (!open) {
            stopQuietly(ble);
            return;
          }
          ble.start(deviceId).then(
            () => setStartProblem(null),
            (error: unknown) => setStartProblem(bleHeartRateErrorCode(error) ?? 'unknown'),
          );
        },
        () => undefined,
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
  }, [active, userId, journeyKnown, journeySource, listens, deviceId, ble, windowOpenFor]);
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
