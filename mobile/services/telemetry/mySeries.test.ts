import { apiRequest } from '../api/http';
import { fetchMySeries, mySeriesPath } from './mySeries';
import { series } from './mySeriesFixtures';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

const requestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('fetchMySeries', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it.each(['day', 'week', 'month'] as const)(
    'lê a série do próprio funcionário no período %s, com o token da sessão',
    async (period) => {
      const resposta = series(period, [100]);
      requestMock.mockResolvedValue(resposta);
      await expect(fetchMySeries(period)).resolves.toEqual(resposta);
      expect(requestMock).toHaveBeenCalledWith(`/telemetry/v1/me/series?period=${period}`, {
        auth: true,
      });
      expect(mySeriesPath(period)).toBe(`/telemetry/v1/me/series?period=${period}`);
    },
  );

  // O cliente HTTP devolve {} para corpo que não é JSON, e um backend antigo
  // pode responder outro formato: nos dois casos é falha, não série.
  it.each([[{}], [null], [{ points: 'x', bucket: 'hour' }], [{ points: [], bucket: 'week' }]])(
    'resposta fora do contrato (%j) é falha, não série',
    async (corpo) => {
      requestMock.mockResolvedValue(corpo);
      await expect(fetchMySeries('day')).rejects.toThrow('fora do contrato');
    },
  );

  it('falha de rede chega a quem chama, nunca vira série vazia', async () => {
    requestMock.mockRejectedValue(new Error('offline'));
    await expect(fetchMySeries('day')).rejects.toThrow('offline');
  });
});
