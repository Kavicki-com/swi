jest.mock('./http', () => ({ apiRequest: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    size: 32696,
    arrayBuffer: jest.fn(async () => new ArrayBuffer(32696)),
  })),
}));
import { apiRequest } from './http';
import { File } from 'expo-file-system';
import { contentTypeFor, uploadImage } from './uploadMedia';

// O upload virou PUT presignado (2026-07-29). O R2 NÃO implementa presigned
// POST: devolvia 501 "Presigned post requests are not yet implemented" na cara
// do usuário ao anexar a foto do cadastro. Isso muda três coisas aqui:
//  - o presign precisa do contentLength (entra na assinatura no servidor);
//  - o método é PUT com os BYTES no corpo, não multipart;
//  - o Content-Type tem que ir no header e casar com o assinado, senão 403.
describe('uploadMedia', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (File as unknown as jest.Mock).mockClear();
    (global as any).fetch = jest.fn();
  });

  it('contentTypeFor infere png/jpeg pela extensão', () => {
    expect(contentTypeFor('file:///a/b.png')).toBe('image/png');
    expect(contentTypeFor('file:///a/b.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('file:///a/b')).toBe('image/jpeg');
  });

  it('presign leva contentLength; upload é PUT com bytes e Content-Type casado', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://r2/bucket/k', key: 'reports/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const key = await uploadImage('file:///a/b.jpg');

    expect(apiRequest).toHaveBeenCalledWith('/media/presign', {
      method: 'POST',
      body: { contentType: 'image/jpeg', contentLength: 32696, prefix: 'reports' },
      auth: true,
    });
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://r2/bucket/k');
    expect(init.method).toBe('PUT');
    // O header TEM que existir e casar com o content-type assinado — divergir
    // dá 403 SignatureDoesNotMatch (verificado no R2 real).
    expect(init.headers['Content-Type']).toBe('image/jpeg');
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect((init.body as ArrayBuffer).byteLength).toBe(32696);
    expect(key).toBe('reports/k.jpg');
  });

  it('repassa o prefixo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'task/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await uploadImage('file:///a/b.jpg', 'task');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', {
      method: 'POST',
      body: { contentType: 'image/jpeg', contentLength: 32696, prefix: 'task' },
      auth: true,
    });
  });

  // Arquivo vazio (ou uri morta, que o expo devolve como size 0) faria o
  // servidor recusar o presign com 400. Barrar aqui evita a ida à rede e dá
  // mensagem melhor que o erro do storage.
  it('arquivo vazio falha antes de pedir presign', async () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({
      uri,
      size: 0,
      arrayBuffer: jest.fn(),
    }));
    await expect(uploadImage('file:///a/vazio.jpg')).rejects.toThrow(/vazio|não encontrado/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('propaga falha do PUT com status e detalhe', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'k' });
    (global as any).fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'SignatureDoesNotMatch',
    });
    await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/403.*SignatureDoesNotMatch/);
  });
});
