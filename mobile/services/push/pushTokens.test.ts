import { deletePushToken, PUSH_UNREGISTER_TIMEOUT_MS, sendPushToken } from './pushTokens';

const mockApiRequest = jest.fn(async (_path: string, _opts: unknown) => ({}));
jest.mock('../api/http', () => ({
  apiRequest: (path: string, opts: unknown) => mockApiRequest(path, opts),
}));

afterEach(() => mockApiRequest.mockClear());

const TOKEN = 'ExponentPushToken[abc123]';

describe('pushTokens', () => {
  it('registra o token do aparelho com a plataforma, autenticado', async () => {
    await sendPushToken(TOKEN, 'android');
    expect(mockApiRequest).toHaveBeenCalledWith('/push/tokens', {
      method: 'POST',
      body: { token: TOKEN, platform: 'android' },
      auth: true,
    });
  });

  // O logout espera esta chamada antes de apagar o JWT: o prazo é curto para
  // a saída sem sinal não ficar presa nos 20 s do prazo padrão.
  it('remove o token com o token no corpo e prazo curto', async () => {
    await deletePushToken(TOKEN);
    expect(mockApiRequest).toHaveBeenCalledWith('/push/tokens', {
      method: 'DELETE',
      body: { token: TOKEN },
      auth: true,
      timeoutMs: PUSH_UNREGISTER_TIMEOUT_MS,
    });
    expect(PUSH_UNREGISTER_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('erro da API sobe para quem chamou decidir', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('400'));
    await expect(sendPushToken(TOKEN, 'ios')).rejects.toThrow('400');
  });
});
