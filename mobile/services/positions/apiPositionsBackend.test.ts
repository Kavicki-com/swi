import { apiRequest } from '../api/http';
import { apiPositionsBackend } from './apiPositionsBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

afterEach(() => jest.clearAllMocks());

describe('apiPositionsBackend', () => {
  it('heartbeat → POST /positions/heartbeat autenticado com {lat, lng} NA ORDEM CERTA', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({});
    await apiPositionsBackend.heartbeat(-23.55, -46.63);
    // A ordem dos args é o que este teste protege: lat é o ~-23.5, lng o ~-46.6.
    expect(apiRequest).toHaveBeenCalledWith('/positions/heartbeat', {
      method: 'POST',
      auth: true,
      body: { lat: -23.55, lng: -46.63 },
    });
  });

  it('listColleagues → GET /positions/colleagues autenticado, com o estado de cada colega', async () => {
    const colega = {
      id: 'w2', name: 'Ana', lat: -19.9, lng: -43.9, sector: 'Leste',
      avatar: 'https://cdn/a.png', recordedAt: '2026-10-03T12:00:00.000Z', status: 'alert',
    };
    (apiRequest as jest.Mock).mockResolvedValue([colega]);
    await expect(apiPositionsBackend.listColleagues()).resolves.toEqual([colega]);
    expect(apiRequest).toHaveBeenCalledWith('/positions/colleagues', { auth: true });
  });

  // Backend anterior ao campo: o colega aparece sem leitura, nunca como "bom".
  it('colega sem estado na resposta vira unknown', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      { id: 'w2', name: 'Ana', lat: -19.9, lng: -43.9, sector: null, avatar: '', recordedAt: '2026-10-03T12:00:00.000Z' },
    ]);
    const [colega] = await apiPositionsBackend.listColleagues();
    expect(colega.status).toBe('unknown');
  });

  it('estado que o app não conhece também vira unknown, e não vai cru para o pino', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      { id: 'w2', name: 'Ana', lat: -19.9, lng: -43.9, sector: null, avatar: '', recordedAt: '2026-10-03T12:00:00.000Z', status: 'critical' },
    ]);
    const [colega] = await apiPositionsBackend.listColleagues();
    expect(colega.status).toBe('unknown');
  });

  it('heat → GET /positions/heat autenticado, janela padrão do servidor', async () => {
    const calor = {
      cellSizeM: 50, from: '2026-10-02T12:00:00.000Z', to: '2026-10-03T12:00:00.000Z',
      cells: [{ lat: -19.9, lng: -43.9, weight: 12 }],
    };
    (apiRequest as jest.Mock).mockResolvedValue(calor);
    await expect(apiPositionsBackend.heat()).resolves.toEqual(calor);
    expect(apiRequest).toHaveBeenCalledWith('/positions/heat', { auth: true });
  });
});
