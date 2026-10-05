import { mockReportsBackend } from './mockReportsBackend';

describe('mockReportsBackend', () => {
  it('list retorna relatórios semeados', async () => {
    const reports = await mockReportsBackend.list();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]).toHaveProperty('title');
  });
  it('get retorna relatório com detalhes/atividades para id conhecido', async () => {
    const [first] = await mockReportsBackend.list();
    const found = await mockReportsBackend.get(first.id);
    expect(found).not.toBeNull();
    expect((found?.details ?? '').length).toBeGreaterThan(0);
    expect(Array.isArray(found?.activities)).toBe(true);
  });
  it('get retorna null para id desconhecido', async () => {
    expect(await mockReportsBackend.get('inexistente')).toBeNull();
  });
  it('create prepende um relatório recuperável por list/get', async () => {
    const created = await mockReportsBackend.create({ title: 'Teste', summary: 'Resumo', details: 'Detalhe', responsibles: ['Fulano'], imageKeys: ['file:///foto.jpg'] });
    expect(created.id).toBeTruthy();
    // No mock a "key" é a própria uri local: a foto aparece sem servidor.
    expect(created.images).toEqual(['file:///foto.jpg']);
    const list = await mockReportsBackend.list();
    expect(list.find((r) => r.id === created.id)).toBeTruthy();
    expect((await mockReportsBackend.get(created.id))?.title).toBe('Teste');
  });
  it('uploadImage devolve a própria uri (não há servidor para subir)', async () => {
    await expect(mockReportsBackend.uploadImage('file:///foto.jpg')).resolves.toBe('file:///foto.jpg');
  });
});
