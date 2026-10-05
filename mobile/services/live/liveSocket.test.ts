import { LIVE_ACK_TIMEOUT_MS, openLiveSocket, type LiveSocketEvents } from './liveSocket';

// Dublê do socket do socket.io: guarda os ouvintes para o teste disparar os
// eventos do servidor e registra o que o app emite.
type Handler = (...args: unknown[]) => void;
const mockHandlers = new Map<string, Handler>();
const mockEmitWithAck = jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true }));
const mockSocket = {
  on: jest.fn((event: string, handler: Handler) => {
    mockHandlers.set(event, handler);
  }),
  emit: jest.fn(),
  close: jest.fn(),
  emitWithAck: mockEmitWithAck,
  timeout: jest.fn((_ms: number) => ({ emitWithAck: mockEmitWithAck })),
};
const mockIo = jest.fn((..._args: unknown[]) => mockSocket);
jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...args) }));
jest.mock('../auth/apiConfig', () => ({ getApiUrl: () => 'https://api.example.org' }));
const mockOrder: string[] = [];
const mockUnwatch = jest.fn(() => mockOrder.push('unwatch'));
const mockWatch = jest.fn((..._args: unknown[]) => {
  mockOrder.push('watch');
  return mockUnwatch;
});
jest.mock('../realtime/connectionStatus', () => ({
  connectionStatus: { watch: (...args: unknown[]) => mockWatch(...args) },
}));

const events = (): jest.Mocked<LiveSocketEvents> => ({
  onConnect: jest.fn(),
  onDisconnect: jest.fn(),
  onViewer: jest.fn(),
  onAnswer: jest.fn(),
  onCandidate: jest.fn(),
  onViewerLeft: jest.fn(),
  onClosed: jest.fn(),
});

const server = (event: string, ...args: unknown[]) => mockHandlers.get(event)!(...args);

beforeEach(() => {
  mockHandlers.clear();
  mockOrder.length = 0;
  jest.clearAllMocks();
  mockIo.mockImplementation((..._args: unknown[]) => {
    mockOrder.push('io');
    return mockSocket;
  });
  mockSocket.close.mockImplementation(() => {
    mockOrder.push('close');
  });
  mockSocket.emitWithAck.mockResolvedValue({ ok: true });
});

describe('conexão', () => {
  it('abre a mesma conexão dos outros sockets, com o token da sessão', () => {
    openLiveSocket('tok', events());
    expect(mockIo).toHaveBeenCalledWith('https://api.example.org', {
      auth: { token: 'tok' },
      transports: ['polling', 'websocket'],
    });
  });

  it('registra o socket no estado da conexão logo depois de abrir', () => {
    openLiveSocket('tok', events());
    expect(mockWatch).toHaveBeenCalledWith(mockSocket);
    expect(mockOrder).toEqual(['io', 'watch']);
  });

  it('fechar tira o registro e só então fecha o socket', () => {
    const live = openLiveSocket('tok', events());
    live.close();
    expect(mockOrder).toEqual(['io', 'watch', 'unwatch', 'close']);
  });

  // O servidor encerra a transmissão do socket que cai. Já o `live.stop` de um
  // socket que não transmite para a transmissão do funcionário em outro
  // aparelho: o celular que perdeu a vez derrubaria o que assumiu.
  it('fechar não manda live.stop: o fim vem da queda do próprio socket', () => {
    const live = openLiveSocket('tok', events());
    live.close();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });
});

describe('anúncio', () => {
  it('anuncia com prazo e devolve true quando o servidor aceita', async () => {
    const live = openLiveSocket('tok', events());
    await expect(live.announce()).resolves.toBe(true);
    expect(mockSocket.timeout).toHaveBeenCalledWith(LIVE_ACK_TIMEOUT_MS);
    expect(mockSocket.emitWithAck).toHaveBeenCalledWith('live.start');
    expect(LIVE_ACK_TIMEOUT_MS).toBe(10_000);
  });

  it.each([
    ['recusa', { ok: false, error: 'forbidden' }],
    ['resposta fora do contrato', 'ok'],
    ['sem resposta', undefined],
  ])('%s vira false', async (_caso, reply) => {
    mockSocket.emitWithAck.mockResolvedValue(reply);
    const live = openLiveSocket('tok', events());
    await expect(live.announce()).resolves.toBe(false);
  });

  it('prazo esgotado vira false', async () => {
    mockSocket.emitWithAck.mockRejectedValue(new Error('operation has timed out'));
    const live = openLiveSocket('tok', events());
    await expect(live.announce()).resolves.toBe(false);
  });
});

describe('sinalização para o painel', () => {
  it('oferta e candidato saem com a sessão de quem assiste', () => {
    const live = openLiveSocket('tok', events());
    live.offer('s1', 'sdp-oferta');
    live.candidate('s1', { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });
    expect(mockSocket.emit.mock.calls).toEqual([
      ['live.offer', { sessionId: 's1', sdp: 'sdp-oferta' }],
      ['live.candidate', { sessionId: 's1', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } }],
    ]);
  });
});

describe('avisos do servidor', () => {
  it('conectar e reconectar chegam como onConnect', () => {
    const ev = events();
    openLiveSocket('tok', ev);
    server('connect');
    server('connect');
    expect(ev.onConnect).toHaveBeenCalledTimes(2);
  });

  it('queda de rede tenta de novo; recusa do servidor não', () => {
    const ev = events();
    openLiveSocket('tok', ev);
    server('disconnect', 'transport close');
    server('disconnect', 'io server disconnect');
    expect(ev.onDisconnect.mock.calls).toEqual([[false], [true]]);
  });

  it('entrega quem chega, a resposta, o candidato, quem sai e o fim', () => {
    const ev = events();
    openLiveSocket('tok', ev);
    server('live.viewer', { sessionId: 's1' });
    server('live.answer', { sessionId: 's1', sdp: 'sdp-resposta' });
    server('live.candidate', { sessionId: 's1', candidate: { candidate: 'candidate:9', sdpMid: '0', sdpMLineIndex: 0 } });
    server('live.viewer-left', { sessionId: 's1' });
    server('live.closed', { workerId: 'w1' });
    expect(ev.onViewer).toHaveBeenCalledWith('s1');
    expect(ev.onAnswer).toHaveBeenCalledWith('s1', 'sdp-resposta');
    expect(ev.onCandidate).toHaveBeenCalledWith('s1', { candidate: 'candidate:9', sdpMid: '0', sdpMLineIndex: 0 });
    expect(ev.onViewerLeft).toHaveBeenCalledWith('s1');
    expect(ev.onClosed).toHaveBeenCalledTimes(1);
  });

  it('candidato chega só com os campos do protocolo', () => {
    const ev = events();
    openLiveSocket('tok', ev);
    server('live.candidate', { sessionId: 's1', candidate: { candidate: 'candidate:9', extra: 'x' } });
    expect(ev.onCandidate).toHaveBeenCalledWith('s1', { candidate: 'candidate:9' });
  });

  it('aviso fora do contrato é descartado antes de chegar ao serviço', () => {
    const ev = events();
    openLiveSocket('tok', ev);
    server('live.viewer', {});
    server('live.viewer', null);
    server('live.answer', { sessionId: 's1' });
    server('live.answer', { sessionId: 's1', sdp: '' });
    server('live.candidate', { sessionId: 's1' });
    server('live.candidate', { sessionId: 's1', candidate: { candidate: 7 } });
    server('live.candidate', { sessionId: 's1', candidate: { candidate: 'c', sdpMid: 1 } });
    server('live.candidate', { sessionId: 's1', candidate: { candidate: 'c', sdpMLineIndex: 'a' } });
    server('live.viewer-left', { sessionId: 7 });
    expect(ev.onViewer).not.toHaveBeenCalled();
    expect(ev.onAnswer).not.toHaveBeenCalled();
    expect(ev.onCandidate).not.toHaveBeenCalled();
    expect(ev.onViewerLeft).not.toHaveBeenCalled();
  });
});
