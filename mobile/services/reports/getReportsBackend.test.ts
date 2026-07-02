// A fatia Relatórios ainda não migrou: getReportsBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiReportsBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getReportsBackend } = require('./getReportsBackend');
  const { mockReportsBackend } = require('./mockReportsBackend');
  return { getReportsBackend, mockReportsBackend };
}

describe('getReportsBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getReportsBackend, mockReportsBackend } = loadWith('mock');
    expect(getReportsBackend()).toBe(mockReportsBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getReportsBackend, mockReportsBackend } = loadWith('api');
    expect(getReportsBackend()).toBe(mockReportsBackend);
  });
});
