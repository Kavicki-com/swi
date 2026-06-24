jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock', WEATHER_SCENARIO: 'alert' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getWeatherBackend } from './getWeatherBackend';
import { mockWeatherBackend } from './mockWeatherBackend';

describe('getWeatherBackend', () => {
  it('retorna o backend mock quando DATA_BACKEND=mock (default)', () => {
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
});
