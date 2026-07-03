// Fatia Relatórios migrada: getReportsBackend honra DATA_BACKEND. O loadWith
// cobre os dois valores da flag (mesmo shape do getProfileBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getReportsBackend } = require('./getReportsBackend');
  const { mockReportsBackend } = require('./mockReportsBackend');
  const { apiReportsBackend } = require('./apiReportsBackend');
  return { getReportsBackend, mockReportsBackend, apiReportsBackend };
}

describe('getReportsBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getReportsBackend, mockReportsBackend } = loadWith('mock');
    expect(getReportsBackend()).toBe(mockReportsBackend);
  });

  it('retorna apiReportsBackend com a flag em api', () => {
    const { getReportsBackend, apiReportsBackend } = loadWith('api');
    expect(getReportsBackend()).toBe(apiReportsBackend);
  });
});
