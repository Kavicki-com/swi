// getChatBackend honra a flag DATA_BACKEND (mock|api), igual getJourneyBackend.
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend }));
  const { getChatBackend } = require('./getChatBackend');
  const { mockChatBackend } = require('./mockChatBackend');
  const { apiChatBackend } = require('./apiChatBackend');
  return { getChatBackend, mockChatBackend, apiChatBackend };
}

describe('getChatBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getChatBackend, mockChatBackend } = loadWith('mock');
    expect(getChatBackend()).toBe(mockChatBackend);
  });

  it('retorna apiChatBackend com a flag em api', () => {
    const { getChatBackend, apiChatBackend } = loadWith('api');
    expect(getChatBackend()).toBe(apiChatBackend);
  });
});
