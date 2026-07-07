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
    const created = await mockReportsBackend.create({ title: 'Teste', summary: 'Resumo', details: 'Detalhe', responsibles: ['Fulano'], imageUris: [] });
    expect(created.id).toBeTruthy();
    const list = await mockReportsBackend.list();
    expect(list.find((r) => r.id === created.id)).toBeTruthy();
    expect((await mockReportsBackend.get(created.id))?.title).toBe('Teste');
  });
  it('update aplica só os campos enviados e persiste', async () => {
    const created = await mockReportsBackend.create({ title: 'Original', summary: 'S', details: 'D', responsibles: ['Fulano'], imageUris: [] });
    const updated = await mockReportsBackend.update(created.id, { title: 'Editado', responsibles: ['Beltrano'] });
    expect(updated?.title).toBe('Editado');
    expect(updated?.summary).toBe('S'); // não enviado → preservado
    expect((await mockReportsBackend.get(created.id))?.responsibles).toEqual(['Beltrano']);
  });
  it('update de id desconhecido → null', async () => {
    expect(await mockReportsBackend.update('inexistente', { title: 'X' })).toBeNull();
  });
  it('addComment anexa comentário recuperável pelo get', async () => {
    const [first] = await mockReportsBackend.list();
    const c = await mockReportsBackend.addComment(first.id, 'Meu comentário');
    expect(c?.text).toBe('Meu comentário');
    expect(c?.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    const found = await mockReportsBackend.get(first.id);
    expect(found?.comments.map((x) => x.text)).toContain('Meu comentário');
  });
  it('addComment em id desconhecido → null', async () => {
    expect(await mockReportsBackend.addComment('inexistente', 'X')).toBeNull();
  });
});
