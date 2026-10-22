import type { ActiveEvacuationView, EvacuationBackend, RouteSnapshot } from './types';
import { apiRequest } from '../api/http';
import { getUserId } from '../api/session';

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
};
