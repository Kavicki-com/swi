// A fatia Perfil ainda não migrou: getProfileBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiProfileBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getProfileBackend } = require('./getProfileBackend');
  const { mockProfileBackend } = require('./mockProfileBackend');
  return { getProfileBackend, mockProfileBackend };
}

it('retorna mock com a flag em mock', () => {
  const { getProfileBackend, mockProfileBackend } = loadWith('mock');
  expect(getProfileBackend()).toBe(mockProfileBackend);
});

it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
  const { getProfileBackend, mockProfileBackend } = loadWith('api');
  expect(getProfileBackend()).toBe(mockProfileBackend);
});
