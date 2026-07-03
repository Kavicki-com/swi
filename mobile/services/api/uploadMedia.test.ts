jest.mock('./http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from './http';
import { contentTypeFor, uploadImage } from './uploadMedia';

describe('uploadMedia', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (global as any).fetch = jest.fn();
  });

  it('contentTypeFor infere png/jpeg pela extensão', () => {
    expect(contentTypeFor('file:///a/b.png')).toBe('image/png');
    expect(contentTypeFor('file:///a/b.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('file:///a/b')).toBe('image/jpeg'); // default
  });

  it('uploadImage: presign → PUT do blob → devolve key', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://minio/put?sig=1', key: 'reports/k.jpg' });
    const blob = { size: 3 };
    (global as any).fetch
      .mockResolvedValueOnce({ blob: async () => blob }) // fetch(file://)
      .mockResolvedValueOnce({ ok: true, status: 200 }); // PUT presigned
    const key = await uploadImage('file:///a/b.jpg');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'reports' }, auth: true });
    const putCall = (global as any).fetch.mock.calls[1];
    expect(putCall[0]).toBe('https://minio/put?sig=1');
    expect(putCall[1].method).toBe('PUT');
    expect(putCall[1].body).toBe(blob);
    expect(key).toBe('reports/k.jpg');
  });

  it('uploadImage repassa o prefixo pro presign', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'task/k.jpg' });
    (global as any).fetch
      .mockResolvedValueOnce({ blob: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await uploadImage('file:///a/b.jpg', 'task');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'task' }, auth: true });
  });

  it('uploadImage propaga falha de PUT', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'k' });
    (global as any).fetch
      .mockResolvedValueOnce({ blob: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/500/);
  });
});
