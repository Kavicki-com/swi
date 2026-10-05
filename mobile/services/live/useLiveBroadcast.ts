import { useEffect, useSyncExternalStore } from 'react';
import { liveBroadcast, type LiveBroadcast } from './liveBroadcast';

// A ponte entre a transmissão ao vivo e o React. O serviço vive fora das
// telas; quem mostra o botão só lê o estado e repassa o toque.

export function useLiveBroadcast(store: LiveBroadcast = liveBroadcast) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    /** A transmissão foi aceita pelo servidor: só então o ponto verde acende. */
    live: state.status === 'live',
    notice: state.notice,
    toggle: store.toggle,
    dismissNotice: store.dismissNotice,
  };
}

/**
 * Desliga a transmissão quando quem chama desmonta. Montado na área
 * autenticada, que desmonta ao sair da conta; a tela do botão não serve,
 * porque a transmissão segue com outra tela aberta.
 */
export function useEndLiveOnLeave(store: LiveBroadcast = liveBroadcast): void {
  useEffect(() => () => store.stop(), [store]);
}
