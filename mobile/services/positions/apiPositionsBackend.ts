import type { PositionsBackend } from './types';
import { apiRequest } from '../api/http';

// POST /positions/heartbeat (204). O backend upserta a última posição e empurra
// o marker pros admins da org via WS — nada a devolver pro app.
export const apiPositionsBackend: PositionsBackend = {
  async heartbeat(lat: number, lng: number): Promise<void> {
    await apiRequest<void>('/positions/heartbeat', { method: 'POST', auth: true, body: { lat, lng } });
  },
};
