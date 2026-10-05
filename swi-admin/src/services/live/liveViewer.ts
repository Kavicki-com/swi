// O lado do painel na conexão direta com o celular. O celular oferta o vídeo,
// o painel responde e os dois trocam candidatos pelo servidor até a imagem
// chegar. Sem React: o hook da aba repassa os avisos do socket para cá e
// mostra o estado que sai daqui.
import type { LiveWatchReply } from './liveSocket'

/**
 * Prazo para a imagem chegar depois do pedido. Conta até o primeiro quadro, e
 * não até a trilha ser anunciada: o navegador anuncia a trilha já ao receber a
 * oferta, antes de a conexão direta fechar. Sem TURN, celular em rede móvel
 * pode nunca fechar; é este prazo que leva a tela ao aviso de falha.
 */
export const LIVE_CONNECT_TIMEOUT_MS = 20_000

export type LiveViewStatus = 'idle' | 'connecting' | 'playing' | 'ended' | 'full' | 'failed'

export interface LiveViewState {
  status: LiveViewStatus
  /** Quem o administrador escolheu assistir; continua depois de encerrar, para religar sozinho. */
  workerId: string | null
  stream: MediaStream | null
}

export interface LiveViewerPort {
  watch: (workerId: string) => Promise<LiveWatchReply>
  unwatch: (sessionId: string) => void
  answer: (sessionId: string, sdp: string) => void
  candidate: (sessionId: string, candidate: RTCIceCandidateInit) => void
}

export interface LiveViewerDeps {
  port: LiveViewerPort
  iceServers: () => Promise<RTCIceServer[]>
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection
  onChange: (state: LiveViewState) => void
}

export interface LiveViewer {
  watch: (workerId: string) => Promise<void>
  retry: () => Promise<void>
  stop: () => void
  handleOffer: (sessionId: string, sdp: string) => Promise<void>
  handleCandidate: (sessionId: string, candidate: RTCIceCandidateInit) => Promise<void>
  handleEnded: (sessionId: string) => void
  handleStarted: (workerId: string) => void
  /** O socket da transmissão voltou de uma queda: a sessão antiga já não existe no servidor. */
  handleReconnect: () => void
}

const defaultPeer = (config: RTCConfiguration) => new RTCPeerConnection(config)

/** Candidato que o navegador recusa não derruba a conexão: os outros servem. */
async function addCandidate(peer: RTCPeerConnection, candidate: RTCIceCandidateInit) {
  try {
    await peer.addIceCandidate(candidate)
  } catch {
    // Ignorado de propósito.
  }
}

export function createLiveViewer(deps: LiveViewerDeps): LiveViewer {
  const createPeer = deps.createPeer ?? defaultPeer
  let state: LiveViewState = { status: 'idle', workerId: null, stream: null }
  let sessionId: string | null = null
  let peer: RTCPeerConnection | null = null
  // Candidatos da sessão atual que chegaram antes da oferta.
  let pending: RTCIceCandidateInit[] = []
  // Antes da confirmação do servidor a sessão ainda não é conhecida: o que
  // chega fica guardado por sessão, e só o da sessão confirmada é usado.
  const early = {
    offers: new Map<string, string>(),
    candidates: [] as Array<{ sessionId: string; candidate: RTCIceCandidateInit }>,
    ended: new Set<string>(),
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  // Cada pedido tem um número. Parar, trocar, encerrar ou falhar avança o
  // número, e trabalho de número antigo não mexe em mais nada.
  let attempt = 0
  // Ofertas de uma sessão são tratadas uma de cada vez: duas ao mesmo tempo
  // criariam duas conexões.
  let offers: Promise<void> = Promise.resolve()

  const publish = (next: Partial<LiveViewState>) => {
    state = { ...state, ...next }
    deps.onChange(state)
  }

  const awaitingReply = () => sessionId === null && state.status === 'connecting'

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const clearEarly = () => {
    early.offers.clear()
    early.candidates = []
    early.ended.clear()
  }

  /** Fecha a conexão e a sessão atuais; `tellServer` libera a vaga lá. */
  const teardown = (tellServer: boolean) => {
    clearTimer()
    if (sessionId && tellServer) deps.port.unwatch(sessionId)
    sessionId = null
    pending = []
    clearEarly()
    if (peer) {
      peer.ontrack = null
      peer.onicecandidate = null
      peer.onconnectionstatechange = null
      peer.close()
    }
    peer = null
  }

  const fail = () => {
    attempt += 1
    teardown(true)
    publish({ status: 'failed', stream: null })
  }

  const applyOffer = async (mine: number, offerSession: string, sdp: string) => {
    if (mine !== attempt || offerSession !== sessionId) return
    try {
      if (!peer) {
        const iceServers = await deps.iceServers()
        if (mine !== attempt) return
        const created = createPeer({ iceServers })
        peer = created
        created.ontrack = (event) => {
          const stream =
            event.streams[0] ??
            (typeof MediaStream === 'undefined' ? null : new MediaStream([event.track]))
          // A trilha chega anunciada sem imagem; "unmute" é o primeiro quadro.
          const show = () => {
            if (mine !== attempt) return
            clearTimer()
            publish({ status: 'playing', stream })
          }
          if (event.track.muted) event.track.addEventListener('unmute', show, { once: true })
          else show()
        }
        created.onicecandidate = (event) => {
          if (event.candidate && sessionId) deps.port.candidate(sessionId, event.candidate.toJSON())
        }
        created.onconnectionstatechange = () => {
          if (created.connectionState === 'failed' && mine === attempt) fail()
        }
      }
      const current = peer
      await current.setRemoteDescription({ type: 'offer', sdp })
      if (mine !== attempt) return
      const queued = pending
      pending = []
      for (const candidate of queued) await addCandidate(current, candidate)
      const answer = await current.createAnswer()
      await current.setLocalDescription(answer)
      if (mine === attempt && sessionId === offerSession && answer.sdp) {
        deps.port.answer(offerSession, answer.sdp)
      }
    } catch {
      if (mine === attempt) fail()
    }
  }

  const handleOffer = (offerSession: string, sdp: string): Promise<void> => {
    if (awaitingReply()) {
      early.offers.set(offerSession, sdp)
      return Promise.resolve()
    }
    if (offerSession !== sessionId) return Promise.resolve()
    const mine = attempt
    const run = offers.then(() => applyOffer(mine, offerSession, sdp))
    offers = run
    return run
  }

  const watch = async (workerId: string) => {
    teardown(true)
    const mine = ++attempt
    publish({ status: 'connecting', workerId, stream: null })
    const reply = await deps.port.watch(workerId)
    if (mine !== attempt) {
      // Parou ou trocou enquanto o servidor respondia: libera a vaga aberta.
      if (reply.ok) deps.port.unwatch(reply.sessionId)
      return
    }
    if (!reply.ok) {
      clearEarly()
      publish({
        status: reply.error === 'full' ? 'full' : reply.error === 'not-live' ? 'ended' : 'failed',
      })
      return
    }
    if (early.ended.has(reply.sessionId)) {
      // A transmissão acabou antes de a confirmação chegar.
      attempt += 1
      clearEarly()
      publish({ status: 'ended' })
      return
    }
    sessionId = reply.sessionId
    pending = early.candidates
      .filter((c) => c.sessionId === reply.sessionId)
      .map((c) => c.candidate)
    const offer = early.offers.get(reply.sessionId)
    clearEarly()
    timer = setTimeout(() => {
      if (mine === attempt && state.status === 'connecting') fail()
    }, LIVE_CONNECT_TIMEOUT_MS)
    if (offer !== undefined) await handleOffer(reply.sessionId, offer)
  }

  const handleCandidate = async (candidateSession: string, candidate: RTCIceCandidateInit) => {
    if (awaitingReply()) {
      early.candidates.push({ sessionId: candidateSession, candidate })
      return
    }
    if (candidateSession !== sessionId) return
    if (!peer || !peer.remoteDescription) {
      pending.push(candidate)
      return
    }
    await addCandidate(peer, candidate)
  }

  return {
    watch,
    retry: async () => {
      if (state.workerId) await watch(state.workerId)
    },
    stop: () => {
      attempt += 1
      teardown(true)
      publish({ status: 'idle', workerId: null, stream: null })
    },
    handleOffer,
    handleCandidate,
    handleEnded: (endedSession) => {
      if (awaitingReply()) {
        early.ended.add(endedSession)
        return
      }
      if (endedSession !== sessionId) return
      attempt += 1
      teardown(false)
      publish({ status: 'ended', stream: null })
    },
    handleStarted: (workerId) => {
      if (state.status === 'ended' && state.workerId === workerId) void watch(workerId)
    },
    handleReconnect: () => {
      if (state.workerId === null || state.status === 'idle') return
      // A sessão antiga morreu no servidor com a queda: não há o que avisar.
      sessionId = null
      void watch(state.workerId)
    },
  }
}
