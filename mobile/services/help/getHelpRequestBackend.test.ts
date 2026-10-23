// getHelpRequestBackend honra a flag DATA_BACKEND (mock|api), como as outras fatias.
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend,
  }));
  const { getHelpRequestBackend } = require('./getHelpRequestBackend');
  const { mockHelpRequestBackend } = require('./mockHelpRequestBackend');
  const { apiHelpRequestBackend } = require('./apiHelpRequestBackend');
  return { getHelpRequestBackend, mockHelpRequestBackend, apiHelpRequestBackend };
}

describe('getHelpRequestBackend', () => {
  it('mock com a flag em mock', () => {
    const { getHelpRequestBackend, mockHelpRequestBackend } = loadWith('mock');
    expect(getHelpRequestBackend()).toBe(mockHelpRequestBackend);
  });

  it('api com a flag em api', () => {
    const { getHelpRequestBackend, apiHelpRequestBackend } = loadWith('api');
    expect(getHelpRequestBackend()).toBe(apiHelpRequestBackend);
  });
});

describe('mockHelpRequestBackend', () => {
  it('nunca pediu: null; pedir abre um e repetir devolve o mesmo', async () => {
    jest.resetModules();
    const { mockHelpRequestBackend: mock } = require('./mockHelpRequestBackend');

    await expect(mock.mine()).resolves.toBeNull();
    const primeiro = await mock.request('k1');
    expect(primeiro.status).toBe('OPEN');
    expect(primeiro.rescue).toBeNull();
    const segundo = await mock.request('k2');
    expect(segundo.id).toBe(primeiro.id);
    await expect(mock.mine()).resolves.toEqual(primeiro);
    const unsub = mock.subscribe(jest.fn());
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
