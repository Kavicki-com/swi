import { apiRequest } from '../api/http';
import { fetchMyTelemetry, MY_TELEMETRY_PATH } from './myTelemetry';
import { metric, neverReported, noMetric, reporting } from './myTelemetryFixtures';

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

  describe('calibração e origem do repouso', () => {
    const CALIBRACAO = {
      version: 'cal-v1',
      phase: 'CALIBRATING',
      recalibrating: false,
      day: 4,
      metrics: {
        EFFORT: { zone: 'NORMAL', cuts: { excellence: 40, fatigue: 80 }, source: 'START' },
        STEPS: { zone: null, cuts: { below: 6000, above: null }, source: 'LEARNED' },
      },
    };

    it('lê a fase, o dia, as faixas e a origem do repouso', async () => {
      requestMock.mockResolvedValue({ ...reporting(), baseline: 'PROVISIONAL', calibration: CALIBRACAO });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.baseline).toBe('PROVISIONAL');
      expect(telemetry.calibration).toEqual({
        phase: 'CALIBRATING',
        recalibrating: false,
        day: 4,
        metrics: {
          EFFORT: { zone: 'NORMAL', cuts: { excellence: 40, fatigue: 80 }, source: 'START' },
          STEPS: { zone: null, cuts: { below: 6000, above: null }, source: 'LEARNED' },
        },
      });
    });

    it('calibração fechada chega sem dia', async () => {
      requestMock.mockResolvedValue({
        ...reporting(),
        calibration: { ...CALIBRACAO, phase: 'CALIBRATED', day: null },
      });
      await expect(fetchMyTelemetry()).resolves.toMatchObject({
        calibration: { phase: 'CALIBRATED', day: null },
      });
    });

    // Backend anterior não manda nenhum dos dois: leitura sem selo, não falha.
    it('sem os campos, os dois vêm null', async () => {
      const { baseline: _b, calibration: _c, ...semCampos } = reporting();
      requestMock.mockResolvedValue(semCampos);
      await expect(fetchMyTelemetry()).resolves.toMatchObject({ baseline: null, calibration: null });
    });

    it.each([
      ['texto', 'calibrando'],
      ['fase desconhecida', { ...CALIBRACAO, phase: 'ALMOST' }],
      ['dia zero', { ...CALIBRACAO, day: 0 }],
      ['dia fracionado', { ...CALIBRACAO, day: 4.5 }],
      ['dia em texto', { ...CALIBRACAO, day: '4' }],
      ['dia ausente', { ...CALIBRACAO, day: undefined }],
      ['recalibrando em texto', { ...CALIBRACAO, recalibrating: 'não' }],
      ['faixas em lista', { ...CALIBRACAO, metrics: [] }],
    ])('calibração torta (%s) vira null sem derrubar a leitura', async (_caso, calibration) => {
      requestMock.mockResolvedValue({ ...reporting(), calibration });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.calibration).toBeNull();
      expect(telemetry.metrics.heartRate.value).toBe(112);
    });

    it('faixa torta some sozinha; as outras e a fase ficam', async () => {
      requestMock.mockResolvedValue({
        ...reporting(),
        calibration: {
          ...CALIBRACAO,
          metrics: {
            EFFORT: CALIBRACAO.metrics.EFFORT,
            WEAR: { zone: 'NORMAL', cuts: 'alto', source: 'START' },
            HEART_RATE: { zone: 'MUITO', cuts: { fatigue: 150 }, source: 'START' },
            OXYGEN_SATURATION: { zone: null, cuts: { fatigue: '92' }, source: 'START' },
            MOVEMENT: { zone: null, cuts: { above: 50 }, source: 'INVENTADO' },
            INVENTADA: { zone: null, cuts: { above: 1 }, source: 'START' },
          },
        },
      });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.calibration).toMatchObject({ phase: 'CALIBRATING', day: 4 });
      expect(telemetry.calibration?.metrics).toEqual({ EFFORT: CALIBRACAO.metrics.EFFORT });
    });

    it.each([['texto qualquer', 'ESTIMATED'], ['número', 1], ['objeto', {}]])(
      'origem do repouso torta (%s) vira null sem derrubar a leitura',
      async (_caso, baseline) => {
        requestMock.mockResolvedValue({ ...reporting(), baseline });
        const telemetry = await fetchMyTelemetry();
        expect(telemetry.baseline).toBeNull();
        expect(telemetry.metrics.heartRate.value).toBe(112);
      },
    );
  });

  // Por que falta uma métrica, decidido no backend: AWAITING enquanto é
  // normal não ter chegado, NOT_SENT quando a pulseira não a entrega.
  describe('ausência por métrica', () => {
    const vazia = (ausencia: unknown) => ({ ...noMetric<number>('%'), ausencia });

    it('lê a ausência das métricas sem valor', async () => {
      const leitura = neverReported();
      requestMock.mockResolvedValue({
        ...leitura,
        metrics: {
          ...leitura.metrics,
          heartRate: vazia('AWAITING'),
          bloodPressure: vazia('NOT_SENT'),
          steps: vazia('AWAITING'),
          energyRatePerHour: { ...vazia('NOT_SENT'), calculating: false },
          oxygenSaturation: vazia('NOT_SENT'),
        },
      });
      const { metrics } = await fetchMyTelemetry();
      expect(metrics.heartRate.ausencia).toBe('AWAITING');
      expect(metrics.bloodPressure.ausencia).toBe('NOT_SENT');
      expect(metrics.steps.ausencia).toBe('AWAITING');
      expect(metrics.energyRatePerHour.ausencia).toBe('NOT_SENT');
      expect(metrics.oxygenSaturation.ausencia).toBe('NOT_SENT');
    });

    // Backend antigo não manda o campo, e o iPhone recebe nulo: os dois são
    // "o backend não disse", não falha.
    it('sem o campo, a ausência vem nula', async () => {
      requestMock.mockResolvedValue(neverReported());
      const { metrics } = await fetchMyTelemetry();
      expect(metrics.heartRate.ausencia).toBeNull();
      expect(metrics.bloodPressure.ausencia).toBeNull();
    });

    it.each([
      ['texto desconhecido', 'MISSING'],
      ['minúsculo', 'awaiting'],
      ['número', 1],
      ['objeto', { kind: 'AWAITING' }],
    ])('campo torto (%s) vira nulo sem derrubar a leitura', async (_caso, ausencia) => {
      const leitura = reporting();
      requestMock.mockResolvedValue({
        ...leitura,
        metrics: { ...leitura.metrics, bloodPressure: vazia(ausencia) },
      });
      const telemetry = await fetchMyTelemetry();
      expect(telemetry.metrics.bloodPressure.ausencia).toBeNull();
      expect(telemetry.metrics.heartRate.value).toBe(112);
    });

    // Valor manda: uma ausência junto de um valor é contradição, e o valor é
    // o que foi medido.
    it('métrica com valor nunca carrega ausência', async () => {
      const leitura = reporting();
      requestMock.mockResolvedValue({
        ...leitura,
        metrics: { ...leitura.metrics, heartRate: { ...metric(84), ausencia: 'AWAITING' } },
      });
      const { metrics } = await fetchMyTelemetry();
      expect(metrics.heartRate.value).toBe(84);
      expect(metrics.heartRate.ausencia).toBeNull();
    });
  });

  it('falha de rede chega a quem chama, nunca vira leitura vazia', async () => {
    requestMock.mockRejectedValue(new Error('offline'));
    await expect(fetchMyTelemetry()).rejects.toThrow('offline');
  });
});
