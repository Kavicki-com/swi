import { generateClient } from 'aws-amplify/data';
import type { WeatherBackend, WeatherSnapshot } from './types';
import { SITE_LOCATION } from './types';

const client = generateClient();
const NOT_READY = (op: string) => new Error(`amplifyWeatherBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyWeatherBackend: WeatherBackend = {
  async getWeather(): Promise<WeatherSnapshot> {
    // Deploy: const { data } = await client.queries.getWeather(SITE_LOCATION);
    //   → re-nest data (tempC/humidityPct/... ) no shape current/daily + coage alerts.
    void client; void SITE_LOCATION;
    throw NOT_READY('getWeather');
  },
};
