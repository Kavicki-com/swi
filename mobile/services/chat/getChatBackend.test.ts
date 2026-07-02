// A fatia Chat ainda não migrou: getChatBackend fica pinado em mock
// e ignora DATA_BACKEND até o apiChatBackend existir. O loadWith cobre os
// dois valores da flag pra provar o pinning (mesmo shape do getAuthBackend.test).
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend }));
  const { getChatBackend } = require('./getChatBackend');
  const { mockChatBackend } = require('./mockChatBackend');
  return { getChatBackend, mockChatBackend };
}

describe('getChatBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getChatBackend, mockChatBackend } = loadWith('mock');
    expect(getChatBackend()).toBe(mockChatBackend);
  });

  it('segue pinado em mock mesmo com a flag em api (fatia ainda não migrou)', () => {
    const { getChatBackend, mockChatBackend } = loadWith('api');
    expect(getChatBackend()).toBe(mockChatBackend);
  });
});
