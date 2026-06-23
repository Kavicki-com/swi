import type { WeatherBackend, WeatherSnapshot } from './types';
import { WEATHER_SCENARIO } from '../../lib/featureFlags';

// Backend demo in-memory pra fatia Clima. Snapshot canned batendo os valores
// que hoje estão hardcoded no dashboard alert-active + no WeatherAlertModal
// (17º atual, 32º/19º, 65%, 65km/h, chuva) pra continuidade visual. O cenário
// (flag WEATHER_SCENARIO) exercita alert/normal/loading/error.
const BASE = '2026-06-23T12:00:00.000Z';

function snapshot(withAlert: boolean): WeatherSnapshot {
  return {
    current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 },
    daily: { minC: 19, maxC: 32 },
    alerts: withAlert
      ? [{
          id: 'wx-0',
          event: 'Tempestade severa',
          description: 'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.',
          startsAt: BASE,
          endsAt: '2026-06-24T00:00:00.000Z',
        }]
      : [],
    fetchedAt: BASE,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<WeatherSnapshot>(() => {}); // 'loading' nunca resolve

export const mockWeatherBackend: WeatherBackend = {
  async getWeather() {
    if (WEATHER_SCENARIO === 'loading') return never();
    await tick();
    if (WEATHER_SCENARIO === 'error') throw new Error('mock weather error');
    return snapshot(WEATHER_SCENARIO !== 'normal'); // 'alert' (default) e qualquer outro → com alerta
  },
};
