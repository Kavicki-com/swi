jest.mock('expo-secure-store', () => ({}));

function loadWith(authBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    AUTH_BACKEND: authBackend, DATA_BACKEND: 'mock' }));
  const { getAuthBackend } = require('./getAuthBackend');
  const { mockAuthBackend } = require('./mockAuthBackend');
  const { apiAuthBackend } = require('./apiAuthBackend');
  return { getAuthBackend, mockAuthBackend, apiAuthBackend };
}

it('returns the mock backend when AUTH_BACKEND is mock', () => {
  const { getAuthBackend, mockAuthBackend } = loadWith('mock');
  expect(getAuthBackend()).toBe(mockAuthBackend);
});

it('returns the api backend when AUTH_BACKEND is api', () => {
  const { getAuthBackend, apiAuthBackend } = loadWith('api');
  expect(getAuthBackend()).toBe(apiAuthBackend);
});
