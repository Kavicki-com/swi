jest.mock('./http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from './http';
import { contentTypeFor, uploadImage } from './uploadMedia';

describe('uploadMedia', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (global as any).fetch = jest.fn();
    (global as any).FormData = class {
      parts: [string, any][] = [];
      append(k: string, v: any) { this.parts.push([k, v]); }
    };
  });

  it('contentTypeFor infere png/jpeg pela extensão', () => {
    expect(contentTypeFor('file:///a/b.png')).toBe('image/png');
    expect(contentTypeFor('file:///a/b.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('file:///a/b')).toBe('image/jpeg');
  });

  it('uploadImage: presign → POST multipart (fields + file last) → devolve key', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://minio/bucket', fields: { key: 'reports/k.jpg', Policy: 'p', 'Content-Type': 'image/jpeg' }, key: 'reports/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const key = await uploadImage('file:///a/b.jpg');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'reports' }, auth: true });
    const call = (global as any).fetch.mock.calls[0];
    expect(call[0]).toBe('https://minio/bucket');
    expect(call[1].method).toBe('POST');
    const form = call[1].body;
    expect(form.parts.map((p: any) => p[0])).toEqual(['key', 'Policy', 'Content-Type', 'file']);
    expect(form.parts[form.parts.length - 1][0]).toBe('file');
    expect(form.parts[form.parts.length - 1][1]).toEqual({ uri: 'file:///a/b.jpg', name: 'k.jpg', type: 'image/jpeg' });
    expect(call[1].headers?.['Content-Type']).toBeUndefined();
    expect(call[1].headers).toBeUndefined();
    expect(key).toBe('reports/k.jpg');
  });

  it('uploadImage repassa o prefixo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', fields: {}, key: 'task/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 204 });
    await uploadImage('file:///a/b.jpg', 'task');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'task' }, auth: true });
  });

  it('uploadImage propaga falha do POST (policy violation)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', fields: {}, key: 'k' });
    (global as any).fetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'EntityTooLarge' });
    await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/400.*EntityTooLarge/);
  });
});
