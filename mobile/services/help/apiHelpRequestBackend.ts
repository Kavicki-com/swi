import { io, type Socket } from 'socket.io-client';
import { apiRequest, readToken } from '../api/http';
import { getApiUrl } from '../auth/apiConfig';
import type { HelpRequestBackend, HelpRequestChanged, HelpRequestView } from './types';

/** Aviso de socket a cada mudança de estado do pedido. */
export const HELP_REQUEST_CHANGED_EVENT = 'help-request.changed';

// Adaptador REST e socket do pedido de ajuda. O POST não leva corpo: quem pede
// sai do token e a posição vai antes, pelo heartbeat.
export const apiHelpRequestBackend: HelpRequestBackend = {
  request(idempotencyKey) {
    return apiRequest<HelpRequestView>('/help-requests', {
      method: 'POST',
      auth: true,
      idempotencyKey,
    });
  },

  async mine() {
    const { helpRequest } = await apiRequest<{ helpRequest: HelpRequestView | null }>(
      '/help-requests/mine',
      { auth: true },
    );
    return helpRequest;
  },

  subscribe(onChanged) {
    let socket: Socket | null = null;
    let closed = false;
    void (async () => {
      const token = await readToken();
      if (closed) return;
      // Polling primeiro, com upgrade para WS: o mesmo das notificações, que
      // atravessa proxy que não repassa o upgrade.
      socket = io(getApiUrl(), { auth: { token }, transports: ['polling', 'websocket'] });
      socket.on(HELP_REQUEST_CHANGED_EVENT, (change: HelpRequestChanged) => onChanged(change));
    })();
    return () => {
      closed = true;
      socket?.close();
    };
  },
};
