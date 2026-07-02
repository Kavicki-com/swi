// A fatia Jornada ainda não migrou: getJourneyBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiJourneyBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getJourneyBackend } = require('./getJourneyBackend');
  const { mockJourneyBackend } = require('./mockJourneyBackend');
  return { getJourneyBackend, mockJourneyBackend };
}

describe('getJourneyBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getJourneyBackend, mockJourneyBackend } = loadWith('mock');
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getJourneyBackend, mockJourneyBackend } = loadWith('api');
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });
});
