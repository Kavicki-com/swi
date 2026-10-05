import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getSendQueue } from './getSendQueue';
import type { SendQueueEvent, SendQueueState } from './sendQueue';
import { connectionStatus } from '../realtime/connectionStatus';

// A ponte entre a fila de envios e o React.

/**
 * De quanto em quanto tempo a fila tenta de novo. O app não tem detector de
 * rede: a tentativa é o detector. 15 s é curto o bastante para o envio sair
 * logo que o sinal volta, e leve contra o teto de 100 req/min do backend.
 */
export const SEND_RETRY_INTERVAL_MS = 15_000;

/** O que está aguardando envio e o que foi recusado, sempre atual. */
export function useSendQueueState(): SendQueueState {
  const queue = getSendQueue();
  return useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
}

/** Ouve o que a fila confirmou ou recusou enquanto o componente estiver montado. */
export function useSendQueueEvent(handler: (event: SendQueueEvent) => void): void {
  // Handler em ref: a assinatura monta UMA vez e sempre chama o corrente.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => getSendQueue().onEvent((event) => handlerRef.current(event)), []);
}

/**
 * Liga a fila à sessão de quem está logado: abre a fila, tenta enviar a cada
 * 15 s, ao voltar ao primeiro plano e quando a conexão volta, e fecha ao sair.
 * Montado uma vez, na raiz da área autenticada.
 */
export function useSendQueueSession(userId: string): void {
  useEffect(() => {
    const queue = getSendQueue();
    // Falha de disco ao abrir: a fila segue vazia na memória e o envio de
    // agora continua funcionando.
    queue.start(userId).catch(() => undefined);
    const timer = setInterval(() => void queue.kick(), SEND_RETRY_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void queue.kick();
    });
    // A fila só deixa de estar parada depois de uma tentativa: sem tentar na
    // volta da conexão, o aviso de sem conexão ficaria até a próxima rodada.
    const offReconnect = connectionStatus.onReconnect(() => void queue.kick());
    return () => {
      clearInterval(timer);
      subscription.remove();
      offReconnect();
      queue.stop();
    };
  }, [userId]);
}
