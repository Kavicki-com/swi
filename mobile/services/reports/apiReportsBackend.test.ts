import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { apiReportsBackend } from './apiReportsBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }));

describe('apiReportsBackend', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (uploadImage as jest.Mock).mockReset();
  });

  it('list → GET /reports', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 'r1', title: 'T' }]);
    const out = await apiReportsBackend.list();
    expect(apiRequest).toHaveBeenCalledWith('/reports', { auth: true });
    expect(out[0].id).toBe('r1');
  });

  // QA Mobile #9 — o app fechava ao abrir QUALQUER relatorio.
  //
  // A atividade que o servidor manda NAO tem `avatars` nem `id`: tem
  // `responsibleNames` e `responsibleAvatars` (o backend resolve nome -> foto
  // presigned no detalhe). A tela faz `activity.avatars.map(...)`, entao o
  // primeiro relatorio com atividade estourava TypeError no render e, em build
  // de release, o app simplesmente fecha. O mock local manda `avatars`, e por
  // isso a demo e a suite nunca viram o buraco.
  it('get normaliza a atividade do wire: responsibleAvatars → avatars, id sintetizado', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 'r1',
      title: 'Inspecao',
      activities: [
        {
          title: 'Verificacao de niveis de oleo',
          sector: 'Setor Noroeste',
          progress: 80,
          tone: 'success',
          responsibleNames: ['Josue Oliveira', 'Ezequiel Almeida'],
          responsibleAvatars: ['signed:josue', ''],
        },
      ],
    });

    const out = await apiReportsBackend.get('r1');

    expect(out?.activities[0].avatars).toEqual(['signed:josue', '']);
    expect(out?.activities[0].id).toBeTruthy();
    expect(out?.activities[0].progress).toBe(80);
    expect(out?.activities[0].tone).toBe('success');
  });

  // O aparelho pode estar numa build mais nova que o servidor no ar (o deploy
  // do backend e manual e atrasa). Campo de array ausente vira [], nunca
  // undefined: `report.comments.length` na tela derrubaria o app igual.
  it('get preenche os arrays que um servidor mais antigo omite', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'r1', title: 'T', status: 'pending' });

    const out = await apiReportsBackend.get('r1');

    expect(out?.activities).toEqual([]);
    expect(out?.comments).toEqual([]);
    expect(out?.images).toEqual([]);
    expect(out?.responsibles).toEqual([]);
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
