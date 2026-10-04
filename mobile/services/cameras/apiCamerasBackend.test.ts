import { apiRequest } from '../api/http';
import { apiCamerasBackend } from './apiCamerasBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

afterEach(() => jest.clearAllMocks());

describe('apiCamerasBackend', () => {
  it('list → GET /cameras autenticado, com o ponto de cada câmera', async () => {
    const portaria = { id: 'c1', name: 'Portaria', lat: -19.9, lng: -43.9 };
    (apiRequest as jest.Mock).mockResolvedValue([portaria]);
    await expect(apiCamerasBackend.list()).resolves.toEqual([portaria]);
    expect(apiRequest).toHaveBeenCalledWith('/cameras', { auth: true });
  });

  // O administrador recebe também o endereço da câmera e as datas do cadastro.
  // O mapa do app só desenha o ponto, então nada além dele segue adiante.
  it('fica só com o ponto, mesmo quando o backend manda o endereço', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      {
        id: 'c1',
        name: 'Portaria',
        lat: -19.9,
        lng: -43.9,
        url: 'https://cameras.exemplo.com.br/portaria',
        createdAt: '2026-10-04T12:00:00.000Z',
        updatedAt: '2026-10-04T12:00:00.000Z',
      },
    ]);
    await expect(apiCamerasBackend.list()).resolves.toEqual([
      { id: 'c1', name: 'Portaria', lat: -19.9, lng: -43.9 },
    ]);
  });
});
