// SAÚDE: getTelemetrySink fica pinado em mock ATÉ A SMARTBAND EXISTIR e ignora
// DATA_BACKEND de propósito (carve-out da rodada não-saúde). O loadWith cobre
// os dois valores da flag pra provar o pinning (mesmo shape do
// getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend }));
  const { getTelemetrySink } = require('./getTelemetrySink');
  const { mockTelemetrySink } = require('./mockTelemetrySink');
  return { getTelemetrySink, mockTelemetrySink };
}

it('retorna mock com a flag em mock', () => {
  const { getTelemetrySink, mockTelemetrySink } = loadWith('mock');
  expect(getTelemetrySink()).toBe(mockTelemetrySink);
});

it('ignora a flag pra sempre (carve-out smartband)', () => {
  const { getTelemetrySink, mockTelemetrySink } = loadWith('api');
  expect(getTelemetrySink()).toBe(mockTelemetrySink);
});
