// A fatia Perfil migrou: getProfileBackend honra DATA_BACKEND ('api' →
// apiProfileBackend, 'mock' → mockProfileBackend). O loadWith cobre os dois
// valores da flag (mesmo shape do getAuthBackend.test).
jest.mock('expo-secure-store', () => ({}));

function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend }));
  const { getProfileBackend } = require('./getProfileBackend');
  const { mockProfileBackend } = require('./mockProfileBackend');
  const { apiProfileBackend } = require('./apiProfileBackend');
  return { getProfileBackend, mockProfileBackend, apiProfileBackend };
}

it('retorna mock com a flag em mock', () => {
  const { getProfileBackend, mockProfileBackend } = loadWith('mock');
  expect(getProfileBackend()).toBe(mockProfileBackend);
});

it('retorna api com a flag em api', () => {
  const { getProfileBackend, apiProfileBackend } = loadWith('api');
  expect(getProfileBackend()).toBe(apiProfileBackend);
});
