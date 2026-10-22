import { apiRequest } from '../api/http';
import { fetchMyTelemetry } from './myTelemetry';
import { condition, reporting } from './myTelemetryFixtures';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

const requestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// O instante da medição que sustenta cada condição aberta. É dele que o app
// conta se a condição ainda pinta o avatar; fora da forma ele vira ausente e a
// leitura segue valendo, como os outros complementos.

const MEDIDO = '2026-10-01T09:12:00.000Z';

describe('fetchMyTelemetry: instante medido por condição', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('lê o instante da medição de cada condição aberta', async () => {
    requestMock.mockResolvedValue({
      ...reporting(),
      conditions: [{ ...condition('URGENT', 'BLOOD_PRESSURE_HIGH'), measuredAt: MEDIDO }],
    });
    const telemetry = await fetchMyTelemetry();
    expect(telemetry.conditions).toEqual([
      expect.objectContaining({ kind: 'BLOOD_PRESSURE_HIGH', measuredAt: MEDIDO }),
    ]);
  });

  it.each([
    ['nulo', null],
    ['texto', 'ontem'],
    ['número', 1700000000000],
    ['objeto', {}],
  ])('instante fora da forma (%s) vira null sem derrubar a leitura', async (_caso, measuredAt) => {
    const aberta = { ...condition('URGENT'), measuredAt };
    requestMock.mockResolvedValue({ ...reporting(), conditions: [aberta] });
    const telemetry = await fetchMyTelemetry();
    expect(telemetry.conditions).toEqual([{ ...aberta, measuredAt: null }]);
    expect(telemetry.metrics.heartRate.value).toBe(112);
  });

  // Backend anterior ao campo: a condição chega sem ele.
  it('sem o campo, o instante vem null', async () => {
    const { measuredAt: _ausente, ...semInstante } = condition('HEALTH');
    requestMock.mockResolvedValue({ ...reporting(), conditions: [semInstante] });
    const telemetry = await fetchMyTelemetry();
    expect(telemetry.conditions).toEqual([{ ...semInstante, measuredAt: null }]);
  });
});
