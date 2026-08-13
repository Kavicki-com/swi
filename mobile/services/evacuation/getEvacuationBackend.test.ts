// Fatia Evacuação migrou: o seletor honra DATA_BACKEND (troca o antigo "pinned em mock").
// EVACUATION_SCENARIO entra no factory porque mockEvacuationBackend lê essa flag.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend, EVACUATION_SCENARIO: 'normal' }));
  const { getEvacuationBackend } = require('./getEvacuationBackend');
  const { apiEvacuationBackend } = require('./apiEvacuationBackend');
  const { mockEvacuationBackend } = require('./mockEvacuationBackend');
  return { getEvacuationBackend, apiEvacuationBackend, mockEvacuationBackend };
}

describe('getEvacuationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getEvacuationBackend, mockEvacuationBackend } = loadWith('mock');
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
  it('retorna api com a flag em api', () => {
    const { getEvacuationBackend, apiEvacuationBackend } = loadWith('api');
    expect(getEvacuationBackend()).toBe(apiEvacuationBackend);
  });
});
