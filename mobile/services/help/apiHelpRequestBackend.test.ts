import { apiRequest } from '../api/http';
import { apiHelpRequestBackend } from './apiHelpRequestBackend';

jest.mock('../api/http', () => ({ apiRequest: jest.fn(), readToken: jest.fn(async () => 'tok') }));
const on = jest.fn();
const close = jest.fn();
const mockIo = jest.fn((..._a: unknown[]) => ({ on, close }));
jest.mock('socket.io-client', () => ({ io: (...a: unknown[]) => mockIo(...a) }));
jest.mock('../auth/apiConfig', () => ({ getApiUrl: () => 'https://api.teste' }));

const flush = () => new Promise((r) => setTimeout(r, 0));

const VIEW = {
  id: 'h1',
  status: 'OPEN',
  createdAt: '2026-10-22T12:00:00.000Z',
  attendedAt: null,
  closedAt: null,
  rescue: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('apiHelpRequestBackend', () => {
  it('request: POST /help-requests autenticado, sem corpo, com a chave do toque', async () => {
    (apiRequest as jest.Mock).mockResolvedValue(VIEW);

    await expect(apiHelpRequestBackend.request('chave-1')).resolves.toEqual(VIEW);

    expect(apiRequest).toHaveBeenCalledWith('/help-requests', {
      method: 'POST',
      auth: true,
      idempotencyKey: 'chave-1',
    });
  });

  it('mine: GET /help-requests/mine devolve o pedido', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ helpRequest: VIEW });

    await expect(apiHelpRequestBackend.mine()).resolves.toEqual(VIEW);
    expect(apiRequest).toHaveBeenCalledWith('/help-requests/mine', { auth: true });
  });

  it('mine: nunca pediu é null', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ helpRequest: null });

    await expect(apiHelpRequestBackend.mine()).resolves.toBeNull();
  });

  it('subscribe: escuta help-request.changed e fecha o socket ao sair', async () => {
    const cb = jest.fn();
    const unsub = apiHelpRequestBackend.subscribe(cb);
    await flush();

    expect(mockIo).toHaveBeenCalledWith('https://api.teste', {
      auth: { token: 'tok' },
      transports: ['polling', 'websocket'],
    });
    const [evento, handler] = on.mock.calls[0];
    expect(evento).toBe('help-request.changed');
    const change = { workerId: 'w1', helpRequestId: 'h1', status: 'ATTENDED', at: 'x' };
    handler(change);
    expect(cb).toHaveBeenCalledWith(change);

    unsub();
    expect(close).toHaveBeenCalled();
  });

  it('subscribe: sair antes de o token chegar não abre socket', async () => {
    const unsub = apiHelpRequestBackend.subscribe(jest.fn());
    unsub();
    await flush();

    expect(mockIo).not.toHaveBeenCalled();
  });
});
