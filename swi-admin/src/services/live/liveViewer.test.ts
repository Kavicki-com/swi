// Quem assiste: pede ao servidor, recebe a oferta do celular, responde e
// troca candidatos até o vídeo chegar. O RTCPeerConnection é falso, mas se
// comporta como o do navegador onde importa: a trilha é anunciada dentro do
// setRemoteDescription, ainda sem imagem, e só "desmuta" quando chegam
// quadros.
import { vi } from 'vitest'
import type { LiveWatchReply } from './liveSocket'
import { createLiveViewer, LIVE_CONNECT_TIMEOUT_MS, type LiveViewState } from './liveViewer'

class FakeTrack {
  muted = true
  private listeners: Array<() => void> = []
  addEventListener(type: string, listener: () => void) {
    if (type === 'unmute') this.listeners.push(listener)
  }
  unmute() {
    this.muted = false
    for (const listener of this.listeners.splice(0)) listener()
  }
}

class FakePeer {
  static all: FakePeer[] = []
  static rejectCandidate = ''
  static startUnmuted = false
  remoteDescription: RTCSessionDescriptionInit | null = null
  localDescription: RTCSessionDescriptionInit | null = null
  connectionState: RTCPeerConnectionState = 'new'
  ontrack: ((e: { streams: unknown[]; track: FakeTrack }) => void) | null = null
  onicecandidate:
    | ((e: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void)
    | null = null
  onconnectionstatechange: (() => void) | null = null
  added: RTCIceCandidateInit[] = []
  closed = false
  track = new FakeTrack()
  stream = { id: 'video' }
  private announced = false
  constructor(public config: RTCConfiguration) {
    FakePeer.all.push(this)
    if (FakePeer.startUnmuted) this.track.muted = false
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d
    if (!this.announced) {
      this.announced = true
      this.ontrack?.({ streams: [this.stream], track: this.track })
    }
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'v=0 resposta' }
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    if (c.candidate === FakePeer.rejectCandidate) throw new Error('candidato recusado')
    this.added.push(c)
  }
  close() {
    this.closed = true
    this.connectionState = 'closed'
  }
  emitCandidate(c: RTCIceCandidateInit) {
    this.onicecandidate?.({ candidate: { toJSON: () => c } })
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

/** Promessa que o teste resolve na hora que quiser. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const peerAt = (i: number) => FakePeer.all[i]!

function setup(
  replies: LiveWatchReply[] = [{ ok: true, sessionId: 's1' }],
  iceServers: () => Promise<RTCIceServer[]> = async () => [{ urls: 'stun:stun.exemplo.com:3478' }],
) {
  const queue = [...replies]
  const port = {
    watch: vi.fn(
      async (_workerId: string): Promise<LiveWatchReply> =>
        queue.shift() ?? { ok: true, sessionId: 'sx' },
    ),
    unwatch: vi.fn(),
    answer: vi.fn(),
    candidate: vi.fn(),
  }
  const states: LiveViewState[] = []
  const viewer = createLiveViewer({
    port,
    iceServers,
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
    onChange: (s) => states.push(s),
  })
  const last = () => states[states.length - 1]!
  return { port, viewer, states, last }
}

beforeEach(() => {
  FakePeer.all = []
  FakePeer.rejectCandidate = ''
  FakePeer.startUnmuted = false
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createLiveViewer', () => {
  it('pede para assistir, responde a oferta e só mostra o vídeo quando a imagem chega', async () => {
    const { port, viewer, last } = setup()
    await viewer.watch('w1')
    expect(port.watch).toHaveBeenCalledWith('w1')
    expect(last()).toEqual({ status: 'connecting', workerId: 'w1', stream: null })

    await viewer.handleOffer('s1', 'v=0 oferta')
    const peer = peerAt(0)
    expect(peer.config).toEqual({ iceServers: [{ urls: 'stun:stun.exemplo.com:3478' }] })
    expect(peer.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 oferta' })
    expect(port.answer).toHaveBeenCalledWith('s1', 'v=0 resposta')
    // A trilha foi anunciada, mas sem imagem: ainda conectando.
    expect(last().status).toBe('connecting')

    peer.emitCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 })
    expect(port.candidate).toHaveBeenCalledWith('s1', {
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })

    peer.track.unmute()
    expect(last()).toEqual({ status: 'playing', workerId: 'w1', stream: peer.stream })
  })

  it('trilha que já chega com imagem mostra o vídeo na hora', async () => {
    FakePeer.startUnmuted = true
    const { viewer, last } = setup()
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    expect(last().status).toBe('playing')
  })

  it('sem imagem dentro do prazo, desiste mesmo com a trilha anunciada', async () => {
    vi.useFakeTimers()
    const { viewer, port, last } = setup()
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    vi.advanceTimersByTime(LIVE_CONNECT_TIMEOUT_MS)
    expect(last().status).toBe('failed')
    expect(port.unwatch).toHaveBeenCalledWith('s1')
    expect(peerAt(0).closed).toBe(true)
    // A imagem que chegasse depois da desistência não volta a tela para o vídeo.
    peerAt(0).track.unmute()
    expect(last().status).toBe('failed')
  })

  it('candidatos que chegam antes da oferta esperam por ela', async () => {
    const { viewer } = setup()
    await viewer.watch('w1')
    await viewer.handleCandidate('s1', { candidate: 'cedo' })
    await viewer.handleOffer('s1', 'v=0 oferta')
    await viewer.handleCandidate('s1', { candidate: 'depois' })
    expect(peerAt(0).added).toEqual([{ candidate: 'cedo' }, { candidate: 'depois' }])
  })

  it('candidato recusado pelo navegador não derruba a conexão, nem quando estava na fila', async () => {
    FakePeer.rejectCandidate = 'ruim'
    const { viewer, port, last } = setup()
    await viewer.watch('w1')
    await viewer.handleCandidate('s1', { candidate: 'ruim' })
    await viewer.handleCandidate('s1', { candidate: 'bom' })
    await viewer.handleOffer('s1', 'v=0 oferta')
    expect(port.answer).toHaveBeenCalledWith('s1', 'v=0 resposta')
    expect(peerAt(0).added).toEqual([{ candidate: 'bom' }])
    expect(last().status).toBe('connecting')
    await viewer.handleCandidate('s1', { candidate: 'ruim' })
    expect(last().status).toBe('connecting')
  })

  it('oferta e candidato de outra sessão são ignorados', async () => {
    const { viewer, port } = setup()
    await viewer.watch('w1')
    await viewer.handleOffer('outra', 'v=0')
    await viewer.handleCandidate('outra', { candidate: 'x' })
    expect(FakePeer.all).toHaveLength(0)
    expect(port.answer).not.toHaveBeenCalled()
  })

  it('oferta e candidatos que chegam antes da confirmação são usados quando ela chega', async () => {
    const reply = deferred<LiveWatchReply>()
    const { viewer, port } = setup()
    port.watch.mockImplementationOnce(() => reply.promise)
    const watching = viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    await viewer.handleCandidate('s1', { candidate: 'adiantado' })
    expect(FakePeer.all).toHaveLength(0)
    reply.resolve({ ok: true, sessionId: 's1' })
    await watching
    await flush()
    expect(port.answer).toHaveBeenCalledWith('s1', 'v=0 resposta')
    expect(peerAt(0).added).toEqual([{ candidate: 'adiantado' }])
  })

  it('na troca de funcionário, o que chega da sessão antiga não entra na conexão nova', async () => {
    const reply = deferred<LiveWatchReply>()
    const { viewer, port } = setup()
    await viewer.watch('w1')
    port.watch.mockImplementationOnce(() => reply.promise)
    const watching = viewer.watch('w2')
    // Atrasados da sessão do primeiro celular, durante a espera da confirmação.
    await viewer.handleCandidate('s1', { candidate: 'do-celular-antigo' })
    await viewer.handleOffer('s2', 'v=0 oferta nova')
    await viewer.handleOffer('s1', 'v=0 oferta antiga')
    await viewer.handleCandidate('s2', { candidate: 'do-celular-novo' })
    reply.resolve({ ok: true, sessionId: 's2' })
    await watching
    await flush()
    expect(FakePeer.all).toHaveLength(1)
    expect(peerAt(0).remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 oferta nova' })
    expect(peerAt(0).added).toEqual([{ candidate: 'do-celular-novo' }])
  })

  it('duas ofertas seguidas na mesma sessão usam uma conexão só', async () => {
    const ice = deferred<RTCIceServer[]>()
    const { viewer, port } = setup(undefined, () => ice.promise)
    await viewer.watch('w1')
    const first = viewer.handleOffer('s1', 'v=0 primeira')
    const second = viewer.handleOffer('s1', 'v=0 segunda')
    ice.resolve([])
    await Promise.all([first, second])
    expect(FakePeer.all).toHaveLength(1)
    expect(peerAt(0).remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 segunda' })
    expect(port.answer).toHaveBeenCalledTimes(2)
  })

  it('desistir enquanto busca os servidores de conexão não abre conexão depois', async () => {
    vi.useFakeTimers()
    const ice = deferred<RTCIceServer[]>()
    const { viewer, last } = setup(undefined, () => ice.promise)
    await viewer.watch('w1')
    const offering = viewer.handleOffer('s1', 'v=0 oferta')
    vi.advanceTimersByTime(LIVE_CONNECT_TIMEOUT_MS)
    expect(last().status).toBe('failed')
    ice.resolve([])
    await offering
    expect(FakePeer.all).toHaveLength(0)
    expect(last().status).toBe('failed')
  })

  it.each([
    [{ ok: false, error: 'full' }, 'full'],
    [{ ok: false, error: 'not-live' }, 'ended'],
    [{ ok: false, error: 'timeout' }, 'failed'],
    [{ ok: false, error: 'forbidden' }, 'failed'],
  ] as const)('recusa %o do servidor vira o estado %s', async (reply, status) => {
    const { viewer, last } = setup([reply])
    await viewer.watch('w1')
    expect(last()).toEqual({ status, workerId: 'w1', stream: null })
  })

  it('conexão que falha depois de aberta vira falha', async () => {
    const { viewer, last } = setup()
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    peerAt(0).track.unmute()
    peerAt(0).setState('failed')
    expect(last()).toEqual({ status: 'failed', workerId: 'w1', stream: null })
  })

  it('erro ao montar a resposta vira falha', async () => {
    const { viewer, last, port } = setup()
    await viewer.watch('w1')
    const original = FakePeer.prototype.createAnswer
    FakePeer.prototype.createAnswer = async () => {
      throw new Error('sem codec')
    }
    try {
      await viewer.handleOffer('s1', 'v=0 oferta')
    } finally {
      FakePeer.prototype.createAnswer = original
    }
    expect(last().status).toBe('failed')
    expect(port.unwatch).toHaveBeenCalledWith('s1')
  })

  it('o funcionário desliga: encerra e, se ele religar, volta a assistir sozinho', async () => {
    const { viewer, port, last } = setup([
      { ok: true, sessionId: 's1' },
      { ok: true, sessionId: 's2' },
    ])
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    viewer.handleEnded('s1')
    expect(last()).toEqual({ status: 'ended', workerId: 'w1', stream: null })
    expect(peerAt(0).closed).toBe(true)

    viewer.handleStarted('w2')
    expect(port.watch).toHaveBeenCalledTimes(1)
    viewer.handleStarted('w1')
    await flush()
    expect(port.watch).toHaveBeenCalledTimes(2)
    expect(last()).toEqual({ status: 'connecting', workerId: 'w1', stream: null })
  })

  it('fim que chega antes da confirmação não deixa a tela presa em "conectando"', async () => {
    const reply = deferred<LiveWatchReply>()
    const { viewer, port, last } = setup()
    port.watch.mockImplementationOnce(() => reply.promise)
    const watching = viewer.watch('w1')
    viewer.handleEnded('s1')
    reply.resolve({ ok: true, sessionId: 's1' })
    await watching
    expect(last()).toEqual({ status: 'ended', workerId: 'w1', stream: null })
  })

  it('parar de assistir avisa o servidor, fecha a conexão e volta ao início', async () => {
    const { viewer, port, last } = setup()
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    viewer.stop()
    expect(port.unwatch).toHaveBeenCalledWith('s1')
    expect(peerAt(0).closed).toBe(true)
    expect(last()).toEqual({ status: 'idle', workerId: null, stream: null })
  })

  it('trocar de funcionário encerra a sessão anterior antes', async () => {
    const { viewer, port } = setup([
      { ok: true, sessionId: 's1' },
      { ok: true, sessionId: 's2' },
    ])
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    await viewer.watch('w2')
    expect(port.unwatch).toHaveBeenCalledWith('s1')
    expect(peerAt(0).closed).toBe(true)
    expect(port.watch).toHaveBeenLastCalledWith('w2')
  })

  it('confirmação que chega depois de parar não abre nada e libera a vaga no servidor', async () => {
    const reply = deferred<LiveWatchReply>()
    const { viewer, port, last } = setup()
    port.watch.mockImplementationOnce(() => reply.promise)
    const watching = viewer.watch('w1')
    viewer.stop()
    reply.resolve({ ok: true, sessionId: 's1' })
    await watching
    expect(port.unwatch).toHaveBeenCalledWith('s1')
    expect(last()).toEqual({ status: 'idle', workerId: null, stream: null })
  })

  it('na volta do socket, pede de novo sem avisar a sessão que morreu com a queda', async () => {
    const { viewer, port } = setup([
      { ok: true, sessionId: 's1' },
      { ok: true, sessionId: 's2' },
    ])
    await viewer.watch('w1')
    await viewer.handleOffer('s1', 'v=0 oferta')
    viewer.handleReconnect()
    await flush()
    expect(port.watch).toHaveBeenCalledTimes(2)
    expect(port.unwatch).not.toHaveBeenCalled()
    expect(peerAt(0).closed).toBe(true)
  })

  it('sem ninguém escolhido, a volta do socket não pede nada', async () => {
    const { viewer, port } = setup()
    viewer.handleReconnect()
    await flush()
    expect(port.watch).not.toHaveBeenCalled()
  })

  it('tentar de novo repete o pedido do mesmo funcionário', async () => {
    const { viewer, port } = setup([
      { ok: false, error: 'timeout' },
      { ok: true, sessionId: 's2' },
    ])
    await viewer.watch('w1')
    await viewer.retry()
    expect(port.watch).toHaveBeenNthCalledWith(2, 'w1')
  })
})
