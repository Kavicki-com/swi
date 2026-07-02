// A fatia Clima ainda não migrou: getWeatherBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiWeatherBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
// WEATHER_SCENARIO entra no factory porque mockWeatherBackend lê essa flag.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, WEATHER_SCENARIO: 'alert' }));
  const { getWeatherBackend } = require('./getWeatherBackend');
  const { mockWeatherBackend } = require('./mockWeatherBackend');
  return { getWeatherBackend, mockWeatherBackend };
}

describe('getWeatherBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getWeatherBackend, mockWeatherBackend } = loadWith('mock');
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getWeatherBackend, mockWeatherBackend } = loadWith('api');
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
});
