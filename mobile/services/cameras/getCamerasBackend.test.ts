// getCamerasBackend honra DATA_BACKEND (mock|api), igual aos demais domínios
// não-saúde.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend,
  }));
  const { getCamerasBackend } = require('./getCamerasBackend');
  const { mockCamerasBackend } = require('./mockCamerasBackend');
  const { apiCamerasBackend } = require('./apiCamerasBackend');
  return { getCamerasBackend, mockCamerasBackend, apiCamerasBackend };
}

describe('getCamerasBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getCamerasBackend, mockCamerasBackend } = loadWith('mock');
    expect(getCamerasBackend()).toBe(mockCamerasBackend);
  });

  it('retorna apiCamerasBackend com a flag em api', () => {
    const { getCamerasBackend, apiCamerasBackend } = loadWith('api');
    expect(getCamerasBackend()).toBe(apiCamerasBackend);
  });
});
