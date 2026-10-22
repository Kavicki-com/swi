import { apiRequest } from '../api/http';
import { apiReportsBackend } from './apiReportsBackend';
import { mockReportsBackend } from './mockReportsBackend';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

// "Revisar relatório" edita o relatório pelo PATCH /reports/:id. O corpo leva
// os anexos que ficam (`imageKeys`) e os que o formulário carregou
// (`imageKeysBase`): com os dois, o servidor só apaga do bucket o anexo que a
// pessoa tirou, e preserva o que outra pessoa anexou depois.

const payload = {
  title: 'Inspeção revisada',
  summary: 'Resumo novo',
  details: 'Detalhes novos',
  responsibles: ['Ana', 'Bruno'],
  imageKeys: ['reports/11111111-1111-1111-1111-111111111111.jpg'],
  imageKeysBase: [
    'reports/11111111-1111-1111-1111-111111111111.jpg',
    'reports/22222222-2222-2222-2222-222222222222.pdf',
  ],
};

describe('apiReportsBackend.update', () => {
  beforeEach(() => (apiRequest as jest.Mock).mockReset());

  it('PATCH /reports/:id com os campos do formulário e as duas listas de anexos', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'r1', title: 'Inspeção revisada' });

    await apiReportsBackend.update('r1', payload);

    expect(apiRequest).toHaveBeenCalledWith('/reports/r1', {
      method: 'PATCH',
      body: payload,
      auth: true,
    });
  });

  it('devolve o relatório normalizado, com os arrays que a resposta omite', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'r1', title: 'Inspeção revisada' });

    const report = await apiReportsBackend.update('r1', payload);

    expect(report.id).toBe('r1');
    expect(report.title).toBe('Inspeção revisada');
    expect(report.comments).toEqual([]);
    expect(report.activities).toEqual([]);
  });

  it('erro do servidor propaga', async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    await expect(apiReportsBackend.update('r1', payload)).rejects.toThrow('boom');
  });
});

describe('mockReportsBackend.update', () => {
  it('troca os campos do relatório guardado e devolve o relatório novo', async () => {
    const [primeiro] = await mockReportsBackend.list();

    const report = await mockReportsBackend.update(primeiro.id, {
      ...payload,
      imageKeys: [],
      imageKeysBase: [],
    });

    expect(report.title).toBe('Inspeção revisada');
    expect(report.responsibles).toEqual(['Ana', 'Bruno']);
    expect((await mockReportsBackend.get(primeiro.id))?.summary).toBe('Resumo novo');
  });
});
