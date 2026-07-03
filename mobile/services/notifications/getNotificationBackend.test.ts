// getNotificationBackend honra a flag DATA_BACKEND (mock|api), igual getChatBackend.
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getNotificationBackend } = require('./getNotificationBackend');
  const { mockNotificationBackend } = require('./mockNotificationBackend');
  const { apiNotificationBackend } = require('./apiNotificationBackend');
  return { getNotificationBackend, mockNotificationBackend, apiNotificationBackend };
}

describe('getNotificationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getNotificationBackend, mockNotificationBackend } = loadWith('mock');
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });

  it('retorna apiNotificationBackend com a flag em api', () => {
    const { getNotificationBackend, apiNotificationBackend } = loadWith('api');
    expect(getNotificationBackend()).toBe(apiNotificationBackend);
  });
});
