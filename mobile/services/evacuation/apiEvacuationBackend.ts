import { io, type Socket } from 'socket.io-client';
import type { ActiveEvacuationView, EvacuationBackend, RouteSnapshot } from './types';
import { apiRequest, readToken } from '../api/http';
import { getUserId } from '../api/session';
import { getApiUrl } from '../auth/apiConfig';

/** Aviso de socket quando o gestor encerra a evacuação no painel. */
export const EVACUATION_ENDED_EVENT = 'evacuation-ended';

// Wire do GET /evacuations/active (EvacuationProgress do swi-backend).
interface ActiveEvacuationDto {
  id?: string;
  total?: number;
  acked?: number;
  workers?: { id: string; acked: boolean }[];
}

// Backend devolve o RouteSnapshot pronto (ISO em fetchedAt), com origin,
// destination e approximate. Espelha apiWeatherBackend.
export const apiEvacuationBackend: EvacuationBackend = {
  // `from` vai na query como "lng,lat" (mesma ordem do GeoJSON, que o backend
  // valida). Sem GPS a query sai inteira de fora: o backend cai na última
  // posição real, e "?from=" vazio seria 400.
  getRoute(from: [number, number] | null) {
    const query = from ? `?from=${from[0]},${from[1]}` : '';
    return apiRequest<RouteSnapshot>(`/evacuation/route${query}`, { auth: true });
  },

  // "Sem ativa" chega como 200 de corpo vazio → apiRequest resolve {} → null.
  async getActive(): Promise<ActiveEvacuationView | null> {
    const dto = await apiRequest<ActiveEvacuationDto>('/evacuations/active', { auth: true });
    if (!dto?.id) return null;
    const myId = getUserId();
    return {
      id: dto.id,
      total: dto.total ?? 0,
      ackedCount: dto.acked ?? 0,
      myAck: dto.workers?.some((w) => w.id === myId && w.acked) ?? false,
    };
  },

  async ack(evacuationId: string): Promise<void> {
    await apiRequest<void>(`/evacuations/${encodeURIComponent(evacuationId)}/ack`, { method: 'POST', auth: true });
  },

  // O fim chega aqui na hora; a consulta de GET /evacuations/active segue
  // como rede de segurança para o socket caído.
  subscribeEnded(onEnded) {
    let socket: Socket | null = null;
    let closed = false;
    void (async () => {
      const token = await readToken();
      if (closed) return;
      // Polling primeiro, com upgrade para WS: o mesmo das notificações, que
      // atravessa proxy que não repassa o upgrade.
      socket = io(getApiUrl(), { auth: { token }, transports: ['polling', 'websocket'] });
      socket.on(EVACUATION_ENDED_EVENT, (payload: { id?: unknown } | null) => {
        if (typeof payload?.id === 'string') onEnded(payload.id);
      });
    })();
    return () => {
      closed = true;
      socket?.close();
    };
  },
};
