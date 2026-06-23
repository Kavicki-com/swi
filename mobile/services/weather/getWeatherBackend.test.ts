jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock', WEATHER_SCENARIO: 'alert' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getWeatherBackend } from './getWeatherBackend';
import { mockWeatherBackend } from './mockWeatherBackend';

describe('getWeatherBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
});
