jest.mock('../../lib/featureFlags', () => ({ WEATHER_SCENARIO: 'alert' }));
import { mockWeatherBackend } from './mockWeatherBackend';

describe('mockWeatherBackend (scenario=alert)', () => {
  it('devolve o snapshot canned com os valores do dashboard + 1 alerta', async () => {
    const s = await mockWeatherBackend.getWeather();
    expect(s.current).toEqual({ tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 });
    expect(s.daily).toEqual({ minC: 19, maxC: 32 });
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].description).toContain('desabamentos');
  });
});
