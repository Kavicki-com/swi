import { mockReportsBackend } from './mockReportsBackend';

describe('mockReportsBackend', () => {
  it('list pagina o store e devolve total', async () => {
    const p1 = await mockReportsBackend.list(1, 4);
    expect(p1.items.length).toBe(4);
    expect(p1.total).toBeGreaterThanOrEqual(10); // SEED_BASE tem 10
    const p2 = await mockReportsBackend.list(2, 4);
    expect(p2.items[0].id).not.toBe(p1.items[0].id); // página diferente
  });
  it('get retorna relatório com detalhes para id conhecido', async () => {
    const { items } = await mockReportsBackend.list(1, 4);
    const found = await mockReportsBackend.get(items[0].id);
    expect(found).not.toBeNull();
    expect((found?.details ?? '').length).toBeGreaterThan(0);
  });
  it('get null para id desconhecido', async () => {
    expect(await mockReportsBackend.get('inexistente')).toBeNull();
  });
  it('create prepende (aparece na página 1)', async () => {
    const created = await mockReportsBackend.create({ title: 'Teste', summary: 'R', details: 'D', responsibles: ['F'], imageUris: [] });
    const { items } = await mockReportsBackend.list(1, 4);
    expect(items.find((r) => r.id === created.id)).toBeTruthy();
    expect((await mockReportsBackend.get(created.id))?.title).toBe('Teste');
  });
});
