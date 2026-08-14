import { apiRequest, REQUEST_TIMEOUT_MS } from './http';
import { getApiUrl } from '../auth/apiConfig';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => {
  let v: string | null = null;
  return {
    setItemAsync: jest.fn(async (_k: string, x: string) => { v = x; }),
    getItemAsync: jest.fn(async () => v),
    deleteItemAsync: jest.fn(async () => { v = null; }),
  };
});

const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, body: any) => ({ ok: false, status, json: async () => body });

describe('apiRequest', () => {
  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await SecureStore.deleteItemAsync('swi.auth.token');
  });

  it('monta a URL com a base da API e respeita o método explícito e o body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ ok: 1 }));
    await apiRequest('/profile/me', { method: 'PUT', body: { city: 'SP' } });
    expect(global.fetch).toHaveBeenCalledWith(
      `${getApiUrl()}/profile/me`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ city: 'SP' }) }),
    );
  });

  it('default: GET sem body, POST com body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({}));
    await apiRequest('/a');
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');
    await apiRequest('/b', { body: { x: 1 } });
    expect((global.fetch as jest.Mock).mock.calls[1][1].method).toBe('POST');
  });

  it('inclui Authorization Bearer quando auth:true e há token', async () => {
    await SecureStore.setItemAsync('swi.auth.token', 'tok1');
    (global.fetch as jest.Mock).mockResolvedValue(okJson({}));
    await apiRequest('/profile/me', { auth: true });
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer tok1');
  });

  it('sem auth não manda Authorization mesmo com token guardado', async () => {
    await SecureStore.setItemAsync('swi.auth.token', 'tok1');
    (global.fetch as jest.Mock).mockResolvedValue(okJson({}));
    await apiRequest('/profile/me');
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('quando !res.ok lança com a message do backend', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(400, { message: 'CPF inválido' }));
    await expect(apiRequest('/profile/me', { method: 'PUT', body: {} }))
      .rejects.toThrow('CPF inválido');
  });

  it('anexa o status ao erro lançado (pra o caller distinguir 404 de 500)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(404, { message: 'Not Found' }));
    await expect(apiRequest('/profile/me', { auth: true }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('sem message na resposta usa o fallback "Erro na requisição" e anexa o status', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(500, {}));
    await expect(apiRequest('/x'))
      .rejects.toMatchObject({ message: 'Erro na requisição', status: 500 });
  });
});

// Toda tela que carrega dados depende da requisição resolver ou rejeitar.
// O prazo cobre conexões e leituras de token que não retornam.
// O RN não salva: o OkHttp que ele monta vem com todos os timeouts em 0. Por
// isso o prazo cobre o apiRequest inteiro, não só o fetch.
describe('apiRequest, prazo', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Uma promessa pendente não "falha" um teste sozinha, ela some. Anexar a
  // expectativa ANTES de avançar o relógio faz duas coisas: torna o pendente
  // observável (o teste falha de verdade sem a correção) e evita que a rejeição
  // apareça como unhandled no meio do advanceTimers.
  const expectPending = (p: Promise<unknown>) => {
    const state = { done: false };
    void p.then(() => { state.done = true; }, () => { state.done = true; });
    return state;
  };

  it('rejeita quando a resposta não chega no prazo padrão', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const p = apiRequest('/chat/conversations', { auth: true });
    const rejects = expect(p).rejects.toThrow(/Tempo esgotado/);
    const state = expectPending(p);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1000);
    expect(state.done).toBe(false); // antes do prazo segue pendente

    await jest.advanceTimersByTimeAsync(1000);
    await rejects;
  });

  it('aborta o fetch ao estourar o prazo (libera a conexão)', async () => {
    let signal: AbortSignal | undefined;
    (global.fetch as jest.Mock).mockImplementation((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise(() => {});
    });
    const p = apiRequest('/chat/directory', { auth: true });
    const rejects = expect(p).rejects.toThrow(/Tempo esgotado/);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await rejects;
    expect(signal?.aborted).toBe(true);
  });

  it('o prazo cobre a leitura do token, não só o fetch', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const p = apiRequest('/chat/conversations', { auth: true });
    const rejects = expect(p).rejects.toThrow(/Tempo esgotado/);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await rejects;
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('respeita um prazo maior quando o caller pede', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const p = apiRequest('/media/presign', { method: 'POST', timeoutMs: 60_000 });
    const rejects = expect(p).rejects.toThrow(/Tempo esgotado/);
    const state = expectPending(p);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    expect(state.done).toBe(false); // o prazo padrão não derruba o upload

    await jest.advanceTimersByTimeAsync(60_000);
    await rejects;
  });

  it('resposta dentro do prazo passa normal e não deixa timer pendurado', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ ok: 1 }));
    await expect(apiRequest('/a')).resolves.toEqual({ ok: 1 });
    expect(jest.getTimerCount()).toBe(0);
  });
});
