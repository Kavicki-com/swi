import { apiRequest } from '../api/http';
import { fetchMyTelemetry, MY_TELEMETRY_PATH } from './myTelemetry';
import { neverReported, reporting } from './myTelemetryFixtures';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

const requestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('fetchMyTelemetry', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('lê o estado atual do próprio funcionário com o token da sessão', async () => {
    requestMock.mockResolvedValue(reporting());
    await expect(fetchMyTelemetry()).resolves.toEqual(reporting());
    expect(requestMock).toHaveBeenCalledWith('/telemetry/v1/me/current', { auth: true });
    expect(MY_TELEMETRY_PATH).toBe('/telemetry/v1/me/current');
  });

  it('quem nunca reportou chega como leitura vazia, não como falha', async () => {
    requestMock.mockResolvedValue(neverReported());
    await expect(fetchMyTelemetry()).resolves.toMatchObject({ origin: null });
  });

  // O cliente HTTP devolve {} para corpo que não é JSON, e um backend antigo
  // pode não mandar condições ou alguma métrica. As telas desmontariam a
  // leitura e quebrariam, levando junto o botão de ajuda urgente.
  it.each([
    ['corpo vazio', {}],
    ['nulo', null],
    ['sem condições', { ...reporting(), conditions: undefined }],
    ['sem métricas', { ...reporting(), metrics: undefined }],
    [
      'sem uma métrica que a tela lê',
      { ...reporting(), metrics: { ...reporting().metrics, fatigueEtaMin: undefined } },
    ],
  ])('resposta fora do contrato (%s) é falha, não leitura', async (_caso, corpo) => {
    requestMock.mockResolvedValue(corpo);
    await expect(fetchMyTelemetry()).rejects.toThrow('fora do contrato');
  });

  it('falha de rede chega a quem chama, nunca vira leitura vazia', async () => {
    requestMock.mockRejectedValue(new Error('offline'));
    await expect(fetchMyTelemetry()).rejects.toThrow('offline');
  });
});
