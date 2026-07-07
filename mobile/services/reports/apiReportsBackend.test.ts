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

  it('list → GET /reports (o server já devolve o shape pronto)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 'r1', title: 'T' }]);
    const out = await apiReportsBackend.list();
    expect(apiRequest).toHaveBeenCalledWith('/reports', { auth: true });
    expect(out[0].id).toBe('r1');
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

  it('update: PATCH só com os campos presentes; imagens nunca entram no body', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'r1', title: 'T2' });
    const out = await apiReportsBackend.update('r1', { title: 'T2', responsibles: ['Ana'] });
    expect(apiRequest).toHaveBeenCalledWith('/reports/r1', {
      method: 'PATCH',
      body: { title: 'T2', responsibles: ['Ana'] },
      auth: true,
    });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(out?.title).toBe('T2');
  });

  it('update 404 → null; erro não-404 propaga', async () => {
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    expect(await apiReportsBackend.update('x', { title: 'T' })).toBeNull();
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await expect(apiReportsBackend.update('x', { title: 'T' })).rejects.toThrow('boom');
  });

  it('addComment: POST /reports/:id/comments com text', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'c1', text: 'Oi', authorName: 'Ana', authorAvatarUri: '', date: '07/07/2026' });
    const out = await apiReportsBackend.addComment('r1', 'Oi');
    expect(apiRequest).toHaveBeenCalledWith('/reports/r1/comments', {
      method: 'POST',
      body: { text: 'Oi' },
      auth: true,
    });
    expect(out?.text).toBe('Oi');
  });

  it('addComment 404 → null; erro não-404 propaga', async () => {
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    expect(await apiReportsBackend.addComment('x', 'Oi')).toBeNull();
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await expect(apiReportsBackend.addComment('x', 'Oi')).rejects.toThrow('boom');
  });
});
