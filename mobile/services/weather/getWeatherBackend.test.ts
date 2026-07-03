// Fatia Clima migrou: o seletor honra DATA_BACKEND (troca o antigo "pinned em mock").
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, WEATHER_SCENARIO: 'alert' }));
  const { getWeatherBackend } = require('./getWeatherBackend');
  const { apiWeatherBackend } = require('./apiWeatherBackend');
  const { mockWeatherBackend } = require('./mockWeatherBackend');
  return { getWeatherBackend, apiWeatherBackend, mockWeatherBackend };
}

describe('getWeatherBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getWeatherBackend, mockWeatherBackend } = loadWith('mock');
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
  it('retorna api com a flag em api', () => {
    const { getWeatherBackend, apiWeatherBackend } = loadWith('api');
    expect(getWeatherBackend()).toBe(apiWeatherBackend);
  });
});
