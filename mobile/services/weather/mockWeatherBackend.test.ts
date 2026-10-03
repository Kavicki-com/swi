import { mockWeatherBackend } from './mockWeatherBackend';
import { activeAlert } from './weatherFormat';
jest.mock('../../lib/featureFlags', () => ({ WEATHER_SCENARIO: 'alert' }));

describe('mockWeatherBackend (scenario=alert)', () => {
  it('devolve o snapshot canned com os valores do dashboard + 1 alerta', async () => {
    const s = await mockWeatherBackend.getWeather();
    expect(s.current).toEqual({ tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 });
    expect(s.daily).toEqual({ minC: 19, maxC: 32 });
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].description).toContain('desabamentos');
  });

  it('o alerta de demonstração traz tipo e nível, como o backend real', async () => {
    const s = await mockWeatherBackend.getWeather();
    expect(s.alerts[0]).toMatchObject({ id: 'wx-0', kind: 'TEMPESTADE', severity: 'PERIGO' });
  });

  // O cenário 'alert' promete um alerta VIGENTE. Com data fixa ele nasceria
  // expirado, e a janela "Local em Alerta!" nunca abriria na demonstração.
  it('o alerta de demonstração está vigente na hora em que é pedido', async () => {
    const s = await mockWeatherBackend.getWeather();
    expect(activeAlert(s)?.id).toBe('wx-0');
    expect(new Date(s.alerts[0].startsAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
