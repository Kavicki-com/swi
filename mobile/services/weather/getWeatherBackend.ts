import type { WeatherBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiWeatherBackend } from './apiWeatherBackend';
import { mockWeatherBackend } from './mockWeatherBackend';

// Fatia Clima ligada: honra DATA_BACKEND (mock permanece p/ design review pixel-exato).
export function getWeatherBackend(): WeatherBackend {
  return DATA_BACKEND === 'api' ? apiWeatherBackend : mockWeatherBackend;
}
