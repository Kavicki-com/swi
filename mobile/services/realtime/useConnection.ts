import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useSendQueueState } from '../outbox/useSendQueue';
import { connectionStatus } from './connectionStatus';

// A ponte entre o estado da conexão e o React.

/**
 * O app está sem conexão com o servidor: a fila de envios parou numa falha
 * passageira, ou um socket está caído há mais que a carência. O app não tem
 * detector de rede; quem detecta é a tentativa de envio e o próprio socket.
 *
 * Também liga a carência ao primeiro plano: no segundo plano ela para, e na
 * volta conta do zero, para o socket que o sistema derrubou ter tempo de
 * reconectar antes de virar aviso.
 */
export function useConnectionLost(): boolean {
  const socketLost = useSyncExternalStore(
    connectionStatus.subscribe,
    connectionStatus.isLost,
    connectionStatus.isLost,
  );
  const { stalled } = useSendQueueState();

  useEffect(() => {
    // O iOS relança o app parado para o rastreio da jornada: aí nenhum evento
    // de mudança chega antes da volta, e a pausa precisa valer desde já.
    if (AppState.currentState === 'background') connectionStatus.pause();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background') connectionStatus.pause();
      else if (status === 'active') connectionStatus.resume();
    });
    return () => subscription.remove();
  }, []);

  return stalled || socketLost;
}

/**
 * Chama o handler quando a conexão volta depois de uma queda: os avisos desse
 * intervalo se perderam, e quem mostra dado do servidor relê pela API.
 */
export function useOnReconnect(handler: () => void): void {
  // Handler em ref: a assinatura monta UMA vez e sempre chama o corrente.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => connectionStatus.onReconnect(() => handlerRef.current()), []);
}
