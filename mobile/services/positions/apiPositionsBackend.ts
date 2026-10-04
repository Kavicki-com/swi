import type {
  Colleague,
  ColleagueStatus,
  PositionBatchResult,
  PositionHeat,
  PositionsBackend,
} from './types';
import { apiRequest } from '../api/http';

const KNOWN_STATUSES: readonly ColleagueStatus[] = ['good', 'alert', 'low', 'unknown'];

// Ausente (backend anterior ao campo) ou desconhecido: sem leitura.
function toColleagueStatus(raw: string | undefined): ColleagueStatus {
  return KNOWN_STATUSES.includes(raw as ColleagueStatus) ? (raw as ColleagueStatus) : 'unknown';
}

// POST /positions/heartbeat (204). O backend upserta a última posição e empurra
// o marker pros admins da org via WS — nada a devolver pro app.
export const apiPositionsBackend: PositionsBackend = {
  async heartbeat(lat: number, lng: number): Promise<void> {
    await apiRequest<void>('/positions/heartbeat', { method: 'POST', auth: true, body: { lat, lng } });
  },
  // POST /positions/batch: o reenvio do rastreio, cada ponto com a sua hora.
  async sendBatch(points) {
    return apiRequest<PositionBatchResult>('/positions/batch', {
      method: 'POST',
      auth: true,
      body: { points },
    });
  },
  // GET /positions/colleagues. O backend anterior ao campo `status` não o
  // manda: o colega sai sem leitura, nunca como "bom".
  async listColleagues(): Promise<Colleague[]> {
    const rows = await apiRequest<(Omit<Colleague, 'status'> & { status?: string })[]>(
      '/positions/colleagues',
      { auth: true },
    );
    return rows.map((r) => ({ ...r, status: toColleagueStatus(r.status) }));
  },
  async heat(): Promise<PositionHeat> {
    return apiRequest<PositionHeat>('/positions/heat', { auth: true });
  },
};
