// A fatia Notificações ainda não migrou: getNotificationBackend fica pinado em
// mock e ignora DATA_BACKEND até o apiNotificationBackend existir. O loadWith
// cobre os dois valores da flag pra provar o pinning (mesmo shape do
// getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getNotificationBackend } = require('./getNotificationBackend');
  const { mockNotificationBackend } = require('./mockNotificationBackend');
  return { getNotificationBackend, mockNotificationBackend };
}

describe('getNotificationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getNotificationBackend, mockNotificationBackend } = loadWith('mock');
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getNotificationBackend, mockNotificationBackend } = loadWith('api');
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });
});
