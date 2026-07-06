jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }));
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { apiReportsBackend } from './apiReportsBackend';

describe('apiReportsBackend', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (uploadImage as jest.Mock).mockReset();
  });

  it('list → GET /reports?page&limit (envelope {items,total})', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ items: [{ id: 'r1', title: 'T' }], total: 9 });
    const out = await apiReportsBackend.list(2, 4);
    expect(apiRequest).toHaveBeenCalledWith('/reports?page=2&limit=4', { auth: true });
    expect(out.total).toBe(9);
    expect(out.items[0].id).toBe('r1');
  });

  it('get inexistente (404) → null', async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    expect(await apiReportsBackend.get('x')).toBeNull();
  });

  it('get propaga erro não-404', async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await expect(apiReportsBackend.get('x')).rejects.toThrow('boom');
  });

  it('create: sobe cada imagem e POSTa com imageKeys', async () => {
    (uploadImage as jest.Mock).mockResolvedValueOnce('reports/a.jpg').mockResolvedValueOnce('reports/b.jpg');
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'novo', title: 'T' });
    await apiReportsBackend.create({ title: 'T', summary: 'S', details: 'D', responsibles: ['Ana'], imageUris: ['file://a', 'file://b'] });
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledWith('/reports', {
      method: 'POST',
      body: { title: 'T', summary: 'S', details: 'D', responsibles: ['Ana'], imageKeys: ['reports/a.jpg', 'reports/b.jpg'] },
      auth: true,
    });
  });
});
