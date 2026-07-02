import { DATA_BACKEND } from '../../lib/featureFlags';
import type { WeatherBackend } from './types';
import { mockWeatherBackend } from './mockWeatherBackend';
import { amplifyWeatherBackend } from './amplifyWeatherBackend';

export function getWeatherBackend(): WeatherBackend {
  return DATA_BACKEND === 'amplify' ? amplifyWeatherBackend : mockWeatherBackend;
}
