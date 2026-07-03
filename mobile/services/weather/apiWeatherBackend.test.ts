jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from '../api/http';
import { apiWeatherBackend } from './apiWeatherBackend';

describe('apiWeatherBackend', () => {
  it('getWeather → GET /weather autenticado, devolve o snapshot', async () => {
    const snap = { current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 }, daily: { minC: 19, maxC: 32 }, alerts: [], fetchedAt: '2026-07-03T00:00:00.000Z' };
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    const out = await apiWeatherBackend.getWeather();
    expect(apiRequest).toHaveBeenCalledWith('/weather', { auth: true });
    expect(out).toBe(snap);
  });
});
