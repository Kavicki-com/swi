import { mockReportsBackend } from './mockReportsBackend';
import { ReportPermissionError, ReportVersionConflictError } from './types';

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
});

// Ticket 13 (U01): o mock reproduz a régua do backend (autoria e OCC) pra
// demo e dev local exercitarem os mesmos caminhos de erro da API real.
// O usuário do mock é um worker (não-admin): só edita/exclui o que criou.

const INPUT = { title: 'Meu relatório', summary: 's', details: 'd', responsibles: [], imageUris: [] };

describe('mockReportsBackend update/remove', () => {
  it('update edita o próprio relatório e incrementa a versão', async () => {
    const criado = await mockReportsBackend.create(INPUT);
    expect(criado.version).toBe(0);
    const out = await mockReportsBackend.update(criado.id, { title: 'Editado', baseVersion: 0 });
    expect(out.title).toBe('Editado');
    expect(out.version).toBe(1);
    const relido = await mockReportsBackend.get(criado.id);
    expect(relido?.title).toBe('Editado');
  });

  it('update de relatório de outro autor rejeita com ReportPermissionError', async () => {
    await expect(
      mockReportsBackend.update('inspecao-tecnica', { title: 'x', baseVersion: 0 }),
    ).rejects.toBeInstanceOf(ReportPermissionError);
  });

  it('update com baseVersion desatualizada rejeita com ReportVersionConflictError', async () => {
    const criado = await mockReportsBackend.create(INPUT);
    await mockReportsBackend.update(criado.id, { title: 'primeira edição', baseVersion: 0 });
    await expect(
      mockReportsBackend.update(criado.id, { title: 'segunda com versão velha', baseVersion: 0 }),
    ).rejects.toBeInstanceOf(ReportVersionConflictError);
  });

  it('update de id desconhecido rejeita com "Relatório não encontrado"', async () => {
    await expect(mockReportsBackend.update('nao-existe', { title: 'x', baseVersion: 0 })).rejects.toThrow(
      'Relatório não encontrado',
    );
  });

  it('remove exclui o próprio relatório', async () => {
    const criado = await mockReportsBackend.create(INPUT);
    await mockReportsBackend.remove(criado.id);
    expect(await mockReportsBackend.get(criado.id)).toBeNull();
  });

  it('remove de relatório de outro autor rejeita com ReportPermissionError e preserva o relatório', async () => {
    await expect(mockReportsBackend.remove('eficiencia-energetica')).rejects.toBeInstanceOf(ReportPermissionError);
    expect(await mockReportsBackend.get('eficiencia-energetica')).not.toBeNull();
  });
});

// Ticket 15: o mock espelha o canEdit do servidor: o usuário da demo é um
// worker, então só o que ele criou é editável.
describe('mockReportsBackend canEdit', () => {
  it('relatório do seed (de outro autor) vem com canEdit false', async () => {
    const alheio = await mockReportsBackend.get('qualidade-solo');
    expect(alheio?.canEdit).toBe(false);
  });

  it('relatório criado pelo usuário vem com canEdit true', async () => {
    const criado = await mockReportsBackend.create(INPUT);
    expect(criado.canEdit).toBe(true);
    const relido = await mockReportsBackend.get(criado.id);
    expect(relido?.canEdit).toBe(true);
  });
});

// Ticket 16: o mock reproduz a mesma prova de snapshot do backend. A "key" no
// mock é a própria uri (não há bucket): o form funciona idêntico nos dois modos.
describe('mockReportsBackend update: anexos', () => {
  it('aplica manter/adicionar/remover e PRESERVA anexo que chegou depois do load', async () => {
    const criado = await mockReportsBackend.create({ ...INPUT, imageUris: ['file:///a', 'file:///b'] });
    expect(criado.imageKeys).toEqual(['file:///a', 'file:///b']);

    // Outra sessão anexa file:///c depois que o form carregou (base = a,b).
    await mockReportsBackend.update(criado.id, {
      baseVersion: 0,
      imageKeys: ['file:///a', 'file:///b', 'file:///c'],
      imageKeysBase: ['file:///a', 'file:///b'],
    });

    // O form (base a,b) remove b e adiciona d. c não estava na base: sobrevive.
    const out = await mockReportsBackend.update(criado.id, {
      baseVersion: 1,
      imageKeys: ['file:///a'],
      imageUris: ['file:///d'],
      imageKeysBase: ['file:///a', 'file:///b'],
    });

    expect(out.imageKeys).toEqual(['file:///a', 'file:///d', 'file:///c']);
    expect(out.images).toEqual(['file:///a', 'file:///d', 'file:///c']);
  });
});
