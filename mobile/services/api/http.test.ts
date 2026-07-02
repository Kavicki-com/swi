import { apiRequest } from './http';
import { API_URL } from '../auth/apiConfig';
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

  it('monta a URL com API_URL e respeita o método explícito e o body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ ok: 1 }));
    await apiRequest('/profile/me', { method: 'PUT', body: { city: 'SP' } });
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_URL}/profile/me`,
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
