import type { EvacuationBackend, RouteSnapshot } from './types';
import { apiRequest } from '../api/http';

// Backend devolve o RouteSnapshot pronto (ISO em fetchedAt). Sem args — a rota é
// do site fixo (SITE_ROUTE vive no backend). Espelha apiWeatherBackend.
export const apiEvacuationBackend: EvacuationBackend = {
  getRoute() { return apiRequest<RouteSnapshot>('/evacuation/route', { auth: true }); },
};
