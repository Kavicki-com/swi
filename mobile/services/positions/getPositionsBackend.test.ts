// getPositionsBackend honra DATA_BACKEND (mock|api), igual aos demais domínios
// não-saúde. O loadWith cobre os dois valores da flag e afirma a identidade do
// adaptador retornado, sem espiar detalhe interno.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend,
  }));
  const { getPositionsBackend } = require('./getPositionsBackend');
  const { mockPositionsBackend } = require('./mockPositionsBackend');
  const { apiPositionsBackend } = require('./apiPositionsBackend');
  return { getPositionsBackend, mockPositionsBackend, apiPositionsBackend };
}

describe('getPositionsBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getPositionsBackend, mockPositionsBackend } = loadWith('mock');
    expect(getPositionsBackend()).toBe(mockPositionsBackend);
  });

  it('retorna apiPositionsBackend com a flag em api', () => {
    const { getPositionsBackend, apiPositionsBackend } = loadWith('api');
    expect(getPositionsBackend()).toBe(apiPositionsBackend);
  });
});
