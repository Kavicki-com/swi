import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { WeatherBackend } from './types';
import { mockWeatherBackend } from './mockWeatherBackend';
import { amplifyWeatherBackend } from './amplifyWeatherBackend';

export function getWeatherBackend(): WeatherBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyWeatherBackend : mockWeatherBackend;
}
