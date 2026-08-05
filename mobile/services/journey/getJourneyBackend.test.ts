// getJourneyBackend honra a flag DATA_BACKEND (mock|api), igual getReportsBackend.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend }));
  const { getJourneyBackend } = require('./getJourneyBackend');
  const { mockJourneyBackend } = require('./mockJourneyBackend');
  const { apiJourneyBackend } = require('./apiJourneyBackend');
  return { getJourneyBackend, mockJourneyBackend, apiJourneyBackend };
}

describe('getJourneyBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getJourneyBackend, mockJourneyBackend } = loadWith('mock');
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });

  it('retorna apiJourneyBackend com a flag em api', () => {
    const { getJourneyBackend, apiJourneyBackend } = loadWith('api');
    expect(getJourneyBackend()).toBe(apiJourneyBackend);
  });
});
