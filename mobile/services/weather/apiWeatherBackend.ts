import type { WeatherBackend, WeatherSnapshot } from './types';
import { apiRequest } from '../api/http';

// Backend devolve o WeatherSnapshot pronto (ISO nas datas). Sem args — o clima
// é do local fixo da obra (SITE_LOCATION vive no backend). Espelha apiNotificationBackend.
export const apiWeatherBackend: WeatherBackend = {
  getWeather() { return apiRequest<WeatherSnapshot>('/weather', { auth: true }); },
};
