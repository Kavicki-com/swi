import {
  createLiveBroadcast,
  LIVE_ACCEPT_TIMEOUT_MS,
  LIVE_RECONNECT_TIMEOUT_MS,
  type LiveBroadcastDeps,
} from './liveBroadcast';
import type { LiveCamera, LiveCandidate, LiveIceServer, LivePeer, LivePeerOptions } from './liveMedia.types';
import type { LiveSocket, LiveSocketEvents } from './liveSocket';

// O serviço fala com a câmera, as conexões e o socket por interfaces. Aqui
// todos são dublês controlados pelo teste: o que o React Native e o servidor
// fariam vira chamada direta, na ordem que o caso precisa.

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

interface FakePeer extends LivePeer {
  options: LivePeerOptions;
  closed: boolean;
  answers: string[];
  candidates: LiveCandidate[];
}

interface FakeCamera extends LiveCamera {
  stopped: boolean;
}

interface FakeSocket extends LiveSocket {
  token: string | null;
  events: LiveSocketEvents;
  replies: Deferred<boolean>[];
  offers: [string, string][];
  sent: [string, LiveCandidate][];
  closed: boolean;
}

const ICE: LiveIceServer[] = [{ urls: 'stun:stun.example.org:3478' }];

function setup(
  over: {
    permission?: () => Promise<boolean>;
    openCamera?: () => Promise<LiveCamera>;
    iceServers?: () => Promise<LiveIceServer[]>;
    noMedia?: boolean;
  } = {},
) {
  const peers: FakePeer[] = [];
  const cameras: FakeCamera[] = [];
  const sockets: FakeSocket[] = [];
  const appListeners = new Set<(state: string) => void>();
  // A próxima oferta criada fica presa neste adiado, quando há um.
  const control = {
    nextOffer: null as Deferred<string> | null,
    connectError: null as Error | null,
    offerError: null as Error | null,
    answerError: null as Error | null,
    candidateError: null as Error | null,
  };

  const makeCamera = (): FakeCamera => {
    const camera: FakeCamera = {
      stopped: false,
      connect(options) {
        if (control.connectError) throw control.connectError;
        const n = peers.length + 1;
        const gate = control.nextOffer;
        control.nextOffer = null;
        const peer: FakePeer = {
          options,
          closed: false,
          answers: [],
          candidates: [],
          offer: async () => {
            if (control.offerError) throw control.offerError;
            return gate ? gate.promise : `sdp-${n}`;
          },
          acceptAnswer: async (sdp) => {
            if (control.answerError) throw control.answerError;
            peer.answers.push(sdp);
          },
          addCandidate: async (candidate) => {
            if (control.candidateError) throw control.candidateError;
            peer.candidates.push(candidate);
          },
          close: () => {
            peer.closed = true;
          },
        };
        peers.push(peer);
        return peer;
      },
      stop() {
        camera.stopped = true;
      },
    };
    cameras.push(camera);
    return camera;
  };

  const requestCameraPermission = jest.fn(over.permission ?? (async () => true));
  const openCamera = jest.fn(over.openCamera ?? (async () => makeCamera()));
  const iceServers = jest.fn(over.iceServers ?? (async () => ICE));
  const openSocket = jest.fn((token: string | null, events: LiveSocketEvents) => {
    const socket: FakeSocket = {
      token,
      events,
      replies: [],
      offers: [],
      sent: [],
      closed: false,
      announce: () => {
        const reply = deferred<boolean>();
        socket.replies.push(reply);
        return reply.promise;
      },
      offer: (sessionId, sdp) => {
        socket.offers.push([sessionId, sdp]);
      },
      candidate: (sessionId, candidate) => {
        socket.sent.push([sessionId, candidate]);
      },
      close: () => {
        socket.closed = true;
      },
    };
    sockets.push(socket);
    return socket;
  });

  const deps: LiveBroadcastDeps = {
    media: over.noMedia ? null : { requestCameraPermission, openCamera },
    readToken: async () => 'tok',
    iceServers,
    openSocket,
    appState: {
      onChange: (listener) => {
        appListeners.add(listener);
        return () => {
          appListeners.delete(listener);
        };
      },
    },
  };
  const broadcast = createLiveBroadcast(deps);

  const goTo = (state: string) => {
    for (const listener of [...appListeners]) listener(state);
  };

  /** Liga até o socket abrir, sem conectar. */
  const startToSocket = async () => {
    void broadcast.start();
    await flush();
    return sockets[sockets.length - 1];
  };

  /** Liga até o servidor aceitar. */
  const goLive = async () => {
    const socket = await startToSocket();
    socket.events.onConnect();
    socket.replies[socket.replies.length - 1].resolve(true);
    await flush();
    return socket;
  };

  /** Um espectador chega e recebe a oferta. */
  const viewer = async (socket: FakeSocket, sessionId: string) => {
    socket.events.onViewer(sessionId);
    await flush();
    return peers[peers.length - 1];
  };

  return {
    broadcast,
    control,
    peers,
    cameras,
    sockets,
    appListeners,
    requestCameraPermission,
    openCamera,
    iceServers,
    openSocket,
    makeCamera,
    goTo,
    startToSocket,
    goLive,
    viewer,
  };
}

const status = (t: ReturnType<typeof setup>) => t.broadcast.getState().status;
const notice = (t: ReturnType<typeof setup>) => t.broadcast.getState().notice;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ligar', () => {
  it('começa em repouso, sem aviso', () => {
    const t = setup();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
  });

  it('pede a permissão, liga a câmera e só então abre o socket com o token', async () => {
    const t = setup();
    const socket = await t.startToSocket();
    expect(t.requestCameraPermission).toHaveBeenCalledTimes(1);
    expect(t.openCamera).toHaveBeenCalledTimes(1);
    expect(t.iceServers).toHaveBeenCalledTimes(1);
    expect(t.openSocket).toHaveBeenCalledTimes(1);
    expect(socket.token).toBe('tok');
    expect(status(t)).toBe('starting');
  });

  it('o ponto só acende quando o servidor aceita a transmissão', async () => {
    const t = setup();
    const socket = await t.startToSocket();
    socket.events.onConnect();
    expect(socket.replies).toHaveLength(1);
    expect(status(t)).toBe('starting');
    socket.replies[0].resolve(true);
    await flush();
    expect(t.broadcast.getState()).toEqual({ status: 'live', notice: null });
  });

  it('permissão negada não liga a câmera nem abre socket, e avisa', async () => {
    const t = setup({ permission: async () => false });
    await t.broadcast.start();
    expect(t.openCamera).not.toHaveBeenCalled();
    expect(t.openSocket).not.toHaveBeenCalled();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'no-permission' });
  });

  it('sem câmera, como na web, é falha ao ligar', async () => {
    const t = setup({ noMedia: true });
    await t.broadcast.start();
    expect(t.openSocket).not.toHaveBeenCalled();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
  });

  it('erro ao pedir a permissão é falha ao ligar', async () => {
    const t = setup({ permission: async () => Promise.reject(new Error('sem módulo')) });
    await t.broadcast.start();
    expect(t.openCamera).not.toHaveBeenCalled();
    expect(notice(t)).toBe('failed');
  });

  it('câmera que não abre é falha, sem socket', async () => {
    const t = setup({ openCamera: async () => Promise.reject(new Error('ocupada')) });
    await t.broadcast.start();
    expect(t.openSocket).not.toHaveBeenCalled();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
  });

  it('falha ao buscar os servidores de conexão solta a câmera e avisa', async () => {
    const t = setup({ iceServers: async () => Promise.reject(new Error('offline')) });
    await t.broadcast.start();
    expect(t.cameras[0].stopped).toBe(true);
    expect(t.openSocket).not.toHaveBeenCalled();
    expect(notice(t)).toBe('failed');
  });

  it('recusa do servidor desliga tudo e avisa a falha', async () => {
    const t = setup();
    const socket = await t.startToSocket();
    socket.events.onConnect();
    socket.replies[0].resolve(false);
    await flush();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('servidor que não aceita em 20 s desliga tudo e avisa a falha', async () => {
    expect(LIVE_ACCEPT_TIMEOUT_MS).toBe(20_000);
    const t = setup();
    const socket = await t.startToSocket();
    jest.advanceTimersByTime(LIVE_ACCEPT_TIMEOUT_MS - 1);
    expect(status(t)).toBe('starting');
    jest.advanceTimersByTime(1);
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('o prazo conta desde a resposta da permissão: câmera e servidores de conexão entram nele', async () => {
    const servers = deferred<LiveIceServer[]>();
    const t = setup({ iceServers: () => servers.promise });
    void t.broadcast.start();
    await flush();
    expect(t.cameras).toHaveLength(1);
    jest.advanceTimersByTime(LIVE_ACCEPT_TIMEOUT_MS);
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
    expect(t.cameras[0].stopped).toBe(true);
    servers.resolve(ICE);
    await flush();
    expect(t.openSocket).not.toHaveBeenCalled();
  });

  it('o prazo não corre enquanto a pessoa responde a permissão', async () => {
    const permission = deferred<boolean>();
    const t = setup({ permission: () => permission.promise });
    void t.broadcast.start();
    jest.advanceTimersByTime(LIVE_ACCEPT_TIMEOUT_MS * 3);
    expect(status(t)).toBe('starting');
    permission.resolve(true);
    await flush();
    expect(t.openSocket).toHaveBeenCalledTimes(1);
  });

  it('ligar de novo limpa o aviso anterior', async () => {
    let granted = false;
    const t = setup({ permission: async () => granted });
    await t.broadcast.start();
    expect(notice(t)).toBe('no-permission');
    granted = true;
    void t.broadcast.start();
    expect(t.broadcast.getState()).toEqual({ status: 'starting', notice: null });
  });

  it('ligar duas vezes seguidas não abre duas câmeras', async () => {
    const t = setup();
    void t.broadcast.start();
    void t.broadcast.start();
    await flush();
    expect(t.openCamera).toHaveBeenCalledTimes(1);
    expect(t.openSocket).toHaveBeenCalledTimes(1);
  });

  it('tocar de novo enquanto liga cancela; a câmera que abrir depois é solta', async () => {
    const camera = deferred<LiveCamera>();
    const t = setup({ openCamera: () => camera.promise });
    void t.broadcast.start();
    await flush();
    t.broadcast.toggle();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
    const late = t.makeCamera();
    camera.resolve(late);
    await flush();
    expect(late.stopped).toBe(true);
    expect(t.openSocket).not.toHaveBeenCalled();
  });
});

describe('quem assiste', () => {
  it('cada espectador ganha a própria conexão, com os servidores recebidos, e o celular oferta', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    expect(peer.options.iceServers).toEqual(ICE);
    expect(socket.offers).toEqual([['s1', 'sdp-1']]);
  });

  it('três espectadores, três conexões, uma oferta para cada', async () => {
    const t = setup();
    const socket = await t.goLive();
    await t.viewer(socket, 's1');
    await t.viewer(socket, 's2');
    await t.viewer(socket, 's3');
    expect(t.peers).toHaveLength(3);
    expect(socket.offers).toEqual([
      ['s1', 'sdp-1'],
      ['s2', 'sdp-2'],
      ['s3', 'sdp-3'],
    ]);
  });

  it('o mesmo espectador anunciado duas vezes não abre outra conexão', async () => {
    const t = setup();
    const socket = await t.goLive();
    await t.viewer(socket, 's1');
    await t.viewer(socket, 's1');
    expect(t.peers).toHaveLength(1);
  });

  it('candidato achado antes de a oferta sair espera por ela', async () => {
    const t = setup();
    const socket = await t.goLive();
    const offer = deferred<string>();
    t.control.nextOffer = offer;
    const peer = await t.viewer(socket, 's1');
    peer.options.onCandidate({ candidate: 'candidate:1' });
    expect(socket.sent).toEqual([]);
    offer.resolve('sdp-segurada');
    await flush();
    expect(socket.offers).toEqual([['s1', 'sdp-segurada']]);
    expect(socket.sent).toEqual([['s1', { candidate: 'candidate:1' }]]);
  });

  it('candidato achado depois da oferta segue na hora', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    peer.options.onCandidate({ candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 });
    expect(socket.sent).toEqual([['s1', { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 }]]);
  });

  it('a resposta do painel entra na conexão da sessão certa', async () => {
    const t = setup();
    const socket = await t.goLive();
    const first = await t.viewer(socket, 's1');
    const second = await t.viewer(socket, 's2');
    socket.events.onAnswer('s2', 'resposta-2');
    await flush();
    expect(second.answers).toEqual(['resposta-2']);
    expect(first.answers).toEqual([]);
  });

  it('resposta repetida é ignorada', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onAnswer('s1', 'resposta');
    socket.events.onAnswer('s1', 'resposta');
    await flush();
    expect(peer.answers).toEqual(['resposta']);
  });

  it('candidato do painel antes da resposta espera; depois dela entra direto', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onCandidate('s1', { candidate: 'candidate:a' });
    await flush();
    expect(peer.candidates).toEqual([]);
    socket.events.onAnswer('s1', 'resposta');
    await flush();
    expect(peer.candidates).toEqual([{ candidate: 'candidate:a' }]);
    socket.events.onCandidate('s1', { candidate: 'candidate:b' });
    await flush();
    expect(peer.candidates).toEqual([{ candidate: 'candidate:a' }, { candidate: 'candidate:b' }]);
  });

  it('candidato recusado pela conexão não a derruba: os outros servem', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onAnswer('s1', 'resposta');
    await flush();
    t.control.candidateError = new Error('candidato inválido');
    socket.events.onCandidate('s1', { candidate: 'candidate:x' });
    await flush();
    expect(peer.closed).toBe(false);
  });

  it('aviso de sessão desconhecida é ignorado', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onAnswer('outra', 'resposta');
    socket.events.onCandidate('outra', { candidate: 'candidate:z' });
    socket.events.onViewerLeft('outra');
    await flush();
    expect(peer.answers).toEqual([]);
    expect(peer.closed).toBe(false);
    expect(status(t)).toBe('live');
  });

  it('quem sai tem a conexão fechada; os outros seguem assistindo', async () => {
    const t = setup();
    const socket = await t.goLive();
    const first = await t.viewer(socket, 's1');
    const second = await t.viewer(socket, 's2');
    socket.events.onViewerLeft('s1');
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(status(t)).toBe('live');
    expect(t.cameras[0].stopped).toBe(false);
  });

  it('conexão fechada não manda mais candidato', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onViewerLeft('s1');
    peer.options.onCandidate({ candidate: 'candidate:tarde' });
    expect(socket.sent).toEqual([]);
  });

  it('quem volta depois de sair ganha conexão nova', async () => {
    const t = setup();
    const socket = await t.goLive();
    await t.viewer(socket, 's1');
    socket.events.onViewerLeft('s1');
    await t.viewer(socket, 's1');
    expect(t.peers).toHaveLength(2);
    expect(t.peers[1].closed).toBe(false);
  });

  it('conexão que falha é fechada', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    peer.options.onFailed();
    expect(peer.closed).toBe(true);
    expect(status(t)).toBe('live');
  });

  it('oferta que falha fecha só a conexão daquele espectador', async () => {
    const t = setup();
    const socket = await t.goLive();
    const first = await t.viewer(socket, 's1');
    t.control.offerError = new Error('sem oferta');
    const second = await t.viewer(socket, 's2');
    expect(second.closed).toBe(true);
    expect(first.closed).toBe(false);
    expect(socket.offers).toEqual([['s1', 'sdp-1']]);
  });

  it('resposta que falha fecha a conexão', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    t.control.answerError = new Error('sdp ruim');
    socket.events.onAnswer('s1', 'resposta');
    await flush();
    expect(peer.closed).toBe(true);
  });

  it('conexão que o nativo se recusa a criar não derruba a transmissão nem os outros', async () => {
    const t = setup();
    const socket = await t.goLive();
    t.control.connectError = new Error('Failed to initialize PeerConnection');
    socket.events.onViewer('s1');
    await flush();
    expect(t.peers).toHaveLength(0);
    expect(status(t)).toBe('live');
    t.control.connectError = null;
    await t.viewer(socket, 's2');
    expect(socket.offers).toEqual([['s2', 'sdp-1']]);
  });

  it('quem sai enquanto a oferta é criada não recebe a oferta', async () => {
    const t = setup();
    const socket = await t.goLive();
    const offer = deferred<string>();
    t.control.nextOffer = offer;
    await t.viewer(socket, 's1');
    socket.events.onViewerLeft('s1');
    offer.resolve('sdp-tarde');
    await flush();
    expect(socket.offers).toEqual([]);
  });
});

describe('queda e volta do socket', () => {
  it('a queda apaga o ponto e fecha as conexões; a volta anuncia de novo', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onDisconnect(false);
    expect(status(t)).toBe('starting');
    expect(peer.closed).toBe(true);
    expect(t.cameras[0].stopped).toBe(false);
    expect(socket.closed).toBe(false);
    socket.events.onConnect();
    expect(socket.replies).toHaveLength(2);
    socket.replies[1].resolve(true);
    await flush();
    expect(status(t)).toBe('live');
  });

  it('sem volta em 60 s desliga tudo e avisa a falha', async () => {
    expect(LIVE_RECONNECT_TIMEOUT_MS).toBe(60_000);
    const t = setup();
    const socket = await t.goLive();
    socket.events.onDisconnect(false);
    jest.advanceTimersByTime(LIVE_RECONNECT_TIMEOUT_MS - 1);
    expect(status(t)).toBe('starting');
    jest.advanceTimersByTime(1);
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('a volta aceita a tempo cancela o prazo', async () => {
    const t = setup();
    const socket = await t.goLive();
    socket.events.onDisconnect(false);
    jest.advanceTimersByTime(LIVE_RECONNECT_TIMEOUT_MS / 2);
    socket.events.onConnect();
    socket.replies[1].resolve(true);
    await flush();
    jest.advanceTimersByTime(LIVE_RECONNECT_TIMEOUT_MS * 2);
    expect(status(t)).toBe('live');
  });

  it('queda antes do primeiro aceite não estica o prazo de ligar', async () => {
    const t = setup();
    const socket = await t.startToSocket();
    jest.advanceTimersByTime(LIVE_ACCEPT_TIMEOUT_MS / 2);
    socket.events.onDisconnect(false);
    jest.advanceTimersByTime(LIVE_ACCEPT_TIMEOUT_MS / 2);
    expect(notice(t)).toBe('failed');
  });

  it('resposta atrasada do anúncio de antes da queda não vale', async () => {
    const t = setup();
    const socket = await t.startToSocket();
    socket.events.onConnect();
    socket.events.onDisconnect(false);
    socket.events.onConnect();
    socket.replies[0].resolve(false);
    await flush();
    expect(t.broadcast.getState()).toEqual({ status: 'starting', notice: null });
    socket.replies[1].resolve(true);
    await flush();
    expect(status(t)).toBe('live');
  });

  it('o servidor fechando a conexão desliga tudo e avisa a falha', async () => {
    const t = setup();
    const socket = await t.goLive();
    socket.events.onDisconnect(true);
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: 'failed' });
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('o fim mandado pelo servidor desliga tudo, sem aviso', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    socket.events.onClosed();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
    expect(peer.closed).toBe(true);
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });
});

describe('desligar', () => {
  it('tocar com a câmera no ar desliga câmera, conexões e socket, sem aviso', async () => {
    const t = setup();
    const socket = await t.goLive();
    const peer = await t.viewer(socket, 's1');
    t.broadcast.toggle();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
    expect(peer.closed).toBe(true);
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('tocar em repouso liga', async () => {
    const t = setup();
    t.broadcast.toggle();
    await flush();
    expect(t.openSocket).toHaveBeenCalledTimes(1);
  });

  it('desligar em repouso só limpa o aviso', async () => {
    const t = setup({ permission: async () => false });
    await t.broadcast.start();
    t.broadcast.stop();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
  });

  it('fechar o aviso o tira sem mexer no resto', async () => {
    const t = setup({ permission: async () => false });
    await t.broadcast.start();
    t.broadcast.dismissNotice();
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
  });

  it('avisos do socket depois de desligar não mexem em nada', async () => {
    const t = setup();
    const socket = await t.goLive();
    t.broadcast.stop();
    socket.events.onViewer('s9');
    socket.events.onConnect();
    socket.events.onDisconnect(true);
    socket.events.onClosed();
    await flush();
    expect(t.peers).toHaveLength(0);
    expect(socket.replies).toHaveLength(1);
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
  });

  it('em repouso o estado do app deixa de ser ouvido', async () => {
    const t = setup();
    await t.goLive();
    expect(t.appListeners.size).toBe(1);
    t.broadcast.stop();
    expect(t.appListeners.size).toBe(0);
  });
});

describe('segundo plano', () => {
  it('ir para o segundo plano desliga a transmissão, sem aviso', async () => {
    const t = setup();
    const socket = await t.goLive();
    t.goTo('background');
    expect(t.broadcast.getState()).toEqual({ status: 'idle', notice: null });
    expect(t.cameras[0].stopped).toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('app inativo (central de controle, ligação chegando) segue transmitindo', async () => {
    const t = setup();
    await t.goLive();
    t.goTo('inactive');
    expect(status(t)).toBe('live');
  });

  it('o pedido de permissão do Android tira o app do primeiro plano sem desligar', async () => {
    const permission = deferred<boolean>();
    const t = setup({ permission: () => permission.promise });
    void t.broadcast.start();
    t.goTo('background');
    t.goTo('active');
    permission.resolve(true);
    await flush();
    expect(t.openCamera).toHaveBeenCalledTimes(1);
    expect(status(t)).toBe('starting');
  });

  it('segundo plano enquanto a câmera abre solta a câmera quando ela chega', async () => {
    const camera = deferred<LiveCamera>();
    const t = setup({ openCamera: () => camera.promise });
    void t.broadcast.start();
    await flush();
    t.goTo('background');
    expect(status(t)).toBe('idle');
    const late = t.makeCamera();
    camera.resolve(late);
    await flush();
    expect(late.stopped).toBe(true);
    expect(t.openSocket).not.toHaveBeenCalled();
  });
});

describe('assinatura', () => {
  it('avisa cada mudança e devolve o mesmo estado entre elas', async () => {
    const t = setup();
    const listener = jest.fn();
    const unsubscribe = t.broadcast.subscribe(listener);
    const before = t.broadcast.getState();
    expect(t.broadcast.getState()).toBe(before);
    void t.broadcast.start();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    t.broadcast.stop();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('mudança que não muda nada não avisa', async () => {
    const t = setup();
    const listener = jest.fn();
    t.broadcast.subscribe(listener);
    t.broadcast.stop();
    t.broadcast.dismissNotice();
    expect(listener).not.toHaveBeenCalled();
  });
});
