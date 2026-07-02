// A fatia Evacuação ainda não migrou: getEvacuationBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiEvacuationBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
// EVACUATION_SCENARIO entra no factory porque mockEvacuationBackend lê essa flag.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, EVACUATION_SCENARIO: 'normal' }));
  const { getEvacuationBackend } = require('./getEvacuationBackend');
  const { mockEvacuationBackend } = require('./mockEvacuationBackend');
  return { getEvacuationBackend, mockEvacuationBackend };
}

describe('getEvacuationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getEvacuationBackend, mockEvacuationBackend } = loadWith('mock');
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getEvacuationBackend, mockEvacuationBackend } = loadWith('api');
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
});
