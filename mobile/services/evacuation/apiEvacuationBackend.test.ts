import { apiRequest } from '../api/http';
import { apiEvacuationBackend } from './apiEvacuationBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn(), readToken: jest.fn(async () => 'tok') }));
jest.mock('../api/session', () => ({ getUserId: jest.fn(() => 'me-id') }));
const on = jest.fn();
const close = jest.fn();
const mockIo = jest.fn((..._a: unknown[]) => ({ on, close }));
jest.mock('socket.io-client', () => ({ io: (...a: unknown[]) => mockIo(...a) }));
jest.mock('../auth/apiConfig', () => ({ getApiUrl: () => 'https://api.teste' }));

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => jest.clearAllMocks());

describe('apiEvacuationBackend', () => {
  const snap = {
    waypoints: [[-46.632, -23.552], [-46.62, -23.544]],
    durationSec: 1380,
    distanceM: 1500,
    fetchedAt: '2026-07-03T00:00:00.000Z',
    origin: [-46.632, -23.552],
    destination: [-46.62, -23.544],
    approximate: false,
  };

  // O `from` e a posicao do GPS. Sem ele o backend usa a ultima posicao real
  // gravada, entao a query vazia nao e detalhe: e um caminho de verdade.
  it('getRoute(from) → GET /evacuation/route com a posicao na query', async () => {
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    const out = await apiEvacuationBackend.getRoute([-46.6321, -23.5522]);
    expect(apiRequest).toHaveBeenCalledWith('/evacuation/route?from=-46.6321,-23.5522', { auth: true });
    expect(out).toBe(snap);
  });

  it('getRoute(null) → GET /evacuation/route sem query', async () => {
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    await apiEvacuationBackend.getRoute(null);
    expect(apiRequest).toHaveBeenCalledWith('/evacuation/route', { auth: true });
  });

  it('getActive → GET /evacuations/active; mapeia o dto pro view com o MEU ack', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 'ev1', status: 'ACTIVE', startedAt: '2026-07-25T18:00:00.000Z', endedAt: null,
      total: 2, acked: 1,
      workers: [
        { id: 'me-id', name: 'Eu', acked: true, ackAt: '2026-07-25T18:05:00.000Z' },
        { id: 'w2', name: 'Outro', acked: false, ackAt: null },
      ],
    });
    const out = await apiEvacuationBackend.getActive();
    expect(apiRequest).toHaveBeenCalledWith('/evacuations/active', { auth: true });
    expect(out).toEqual({ id: 'ev1', total: 2, ackedCount: 1, myAck: true });
  });

  it('getActive sem evacuação (corpo vazio {}) → null', async () => {
    // 200 de corpo vazio: o apiRequest resolve {} (json().catch(() => ({}))).
    (apiRequest as jest.Mock).mockResolvedValue({});
    const out = await apiEvacuationBackend.getActive();
    expect(out).toBeNull();
  });

  it('ack → POST /evacuations/:id/ack autenticado', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({});
    await apiEvacuationBackend.ack('ev1');
    expect(apiRequest).toHaveBeenCalledWith('/evacuations/ev1/ack', { method: 'POST', auth: true });
  });

  // O backend avisa o fim pelo socket ('evacuation-ended', { id }) para a
  // tela sair do modo evacuação na hora, sem esperar a consulta.
  it('subscribeEnded: escuta evacuation-ended e fecha o socket ao sair', async () => {
    const cb = jest.fn();
    const unsub = apiEvacuationBackend.subscribeEnded(cb);
    await flush();

    expect(mockIo).toHaveBeenCalledWith('https://api.teste', {
      auth: { token: 'tok' },
      transports: ['polling', 'websocket'],
    });
    const [evento, handler] = on.mock.calls[0];
    expect(evento).toBe('evacuation-ended');
    handler({ id: 'e1' });
    handler({});
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('e1');

    unsub();
    expect(close).toHaveBeenCalled();
  });

  it('subscribeEnded: sair antes de o token chegar não abre socket', async () => {
    const unsub = apiEvacuationBackend.subscribeEnded(jest.fn());
    unsub();
    await flush();

    expect(mockIo).not.toHaveBeenCalled();
  });
});
