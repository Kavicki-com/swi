jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from '../api/http';
import { apiEvacuationBackend } from './apiEvacuationBackend';

describe('apiEvacuationBackend', () => {
  it('getRoute → GET /evacuation/route autenticado, devolve o snapshot', async () => {
    const snap = { waypoints: [[-46.632, -23.552], [-46.62, -23.544]], durationSec: 1380, distanceM: 1500, fetchedAt: '2026-07-03T00:00:00.000Z' };
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    const out = await apiEvacuationBackend.getRoute();
    expect(apiRequest).toHaveBeenCalledWith('/evacuation/route', { auth: true });
    expect(out).toBe(snap);
  });
});
