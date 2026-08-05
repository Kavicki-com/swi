// SAÚDE: getVitalsBackend fica pinado em mock ATÉ A SMARTBAND EXISTIR e ignora
// DATA_BACKEND de propósito (carve-out da rodada não-saúde). O loadWith cobre
// os dois valores da flag pra provar o pinning (mesmo shape do
// getAuthBackend.test). VITALS_SCENARIO entra no factory porque
// mockVitalsBackend lê essa flag.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend, VITALS_SCENARIO: 'streaming' }));
  const { getVitalsBackend } = require('./getVitalsBackend');
  const { mockVitalsBackend } = require('./mockVitalsBackend');
  return { getVitalsBackend, mockVitalsBackend };
}

it('retorna mock com a flag em mock', () => {
  const { getVitalsBackend, mockVitalsBackend } = loadWith('mock');
  expect(getVitalsBackend()).toBe(mockVitalsBackend);
});

it('ignora a flag pra sempre (carve-out smartband)', () => {
  const { getVitalsBackend, mockVitalsBackend } = loadWith('api');
  expect(getVitalsBackend()).toBe(mockVitalsBackend);
});
