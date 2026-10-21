import { apiRequest } from '../api/http';
import { fetchMyTelemetry, MY_TELEMETRY_PATH } from './myTelemetry';
import { metric, neverReported, reporting } from './myTelemetryFixtures';

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

  describe('sincronização do Health Connect', () => {
    const SYNC = {
      measuredUntil: '2026-10-01T14:10:00.000Z',
      syncedAt: '2026-10-01T14:56:30.000Z',
    };

    it('aparelho Android manda até quando há dado e quando sincronizou', async () => {
      requestMock.mockResolvedValue({ ...reporting(), sync: SYNC });
      await expect(fetchMyTelemetry()).resolves.toMatchObject({ sync: SYNC });
    });

    // iPhone não manda o campo, e backend antigo também não: os dois são
    // leitura sem atraso de sincronização, não falha.
    it('sem o campo, sync vem null', async () => {
      const { sync: _ausente, ...semSync } = reporting();
      requestMock.mockResolvedValue(semSync);
      await expect(fetchMyTelemetry()).resolves.toMatchObject({ sync: null });
    });

    it.each([
      ['texto', 'ontem'],
      ['sem syncedAt', { measuredUntil: SYNC.measuredUntil }],
      ['campo numérico', { ...SYNC, measuredUntil: 1700000000000 }],
      ['data ilegível', { ...SYNC, syncedAt: 'não é data' }],
    ])('sync fora da forma (%s) vira null sem derrubar a leitura', async (_caso, sync) => {
      requestMock.mockResolvedValue({ ...reporting(), sync });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.sync).toBeNull();
      expect(telemetry.metrics.heartRate.value).toBe(112);
    });

    it('medição vinda da pulseira chega com a origem HEALTH_CONNECT', async () => {
      const heartRate = metric(84, { source: 'HEALTH_CONNECT' });
      requestMock.mockResolvedValue({ ...reporting({ heartRate }), sync: SYNC });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.metrics.heartRate.source).toBe('HEALTH_CONNECT');
    });
  });

  it('falha de rede chega a quem chama, nunca vira leitura vazia', async () => {
    requestMock.mockRejectedValue(new Error('offline'));
    await expect(fetchMyTelemetry()).rejects.toThrow('offline');
  });
});
