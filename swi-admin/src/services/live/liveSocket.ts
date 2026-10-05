import { io, type Socket } from 'socket.io-client'
import type { LiveBroadcast } from '../api/live'
import { readToken } from '../api/http'
import { getApiUrl } from '../api/apiConfig'
import { connectionStatus } from '../realtime/connectionStatus'

/** Prazo da confirmação do servidor ao pedir para assistir. */
const WATCH_TIMEOUT_MS = 10_000

export type LiveWatchReply = { ok: true; sessionId: string } | { ok: false; error: string }

export interface LiveSocketEvents {
  onStarted: (broadcast: LiveBroadcast) => void
  onStopped: (workerId: string) => void
  /** O celular ofertou vídeo para a sessão deste painel. */
  onOffer: (sessionId: string, sdp: string) => void
  onCandidate: (sessionId: string, candidate: RTCIceCandidateInit) => void
  /** A transmissão acabou para esta sessão (parou, caiu ou trocou de aparelho). */
  onEnded: (sessionId: string, workerId: string) => void
  /**
   * Este socket voltou depois de uma queda: o servidor encerrou as sessões
   * dele. É só deste socket; a volta de outro socket do painel não conta.
   */
  onReconnect: () => void
}

export interface LiveSocket {
  watch: (workerId: string) => Promise<LiveWatchReply>
  unwatch: (sessionId: string) => void
  answer: (sessionId: string, sdp: string) => void
  candidate: (sessionId: string, candidate: RTCIceCandidateInit) => void
  close: () => void
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const fields = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/**
 * Socket da transmissão ao vivo: mesma conexão do servidor que os outros
 * serviços de socket, aberta só enquanto a aba "Ao vivo" está aberta. Recebe
 * quem liga e quem para, e faz a sinalização da conexão direta com o celular.
 * Aviso fora do contrato é descartado aqui, antes de chegar à tela.
 */
export function openLiveSocket(events: LiveSocketEvents): LiveSocket {
  const socket: Socket = io(getApiUrl(), {
    auth: { token: readToken() },
    // Espelho do chatSocket: polling primeiro para atravessar página
    // interstitial de túnel, e o upgrade para WS acontece quando dá.
    transports: ['polling', 'websocket'],
  })
  const unwatch = connectionStatus.watch(socket)

  socket.on('live.started', (raw: unknown) => {
    const { workerId, name, startedAt } = fields(raw)
    if (isText(workerId) && typeof name === 'string' && isText(startedAt))
      events.onStarted({ workerId, name, startedAt })
  })
  socket.on('live.stopped', (raw: unknown) => {
    const { workerId } = fields(raw)
    if (isText(workerId)) events.onStopped(workerId)
  })
  socket.on('live.offer', (raw: unknown) => {
    const { sessionId, sdp } = fields(raw)
    if (isText(sessionId) && isText(sdp)) events.onOffer(sessionId, sdp)
  })
  socket.on('live.candidate', (raw: unknown) => {
    const { sessionId, candidate } = fields(raw)
    if (isText(sessionId) && typeof candidate === 'object' && candidate !== null) {
      events.onCandidate(sessionId, candidate as RTCIceCandidateInit)
    }
  })
  socket.on('live.ended', (raw: unknown) => {
    const { sessionId, workerId } = fields(raw)
    if (isText(sessionId) && isText(workerId)) events.onEnded(sessionId, workerId)
  })
  let connectedOnce = false
  socket.on('connect', () => {
    if (connectedOnce) events.onReconnect()
    connectedOnce = true
  })

  return {
    async watch(workerId) {
      try {
        const reply = fields(
          await socket.timeout(WATCH_TIMEOUT_MS).emitWithAck('live.watch', { workerId }),
        )
        if (reply.ok === true && isText(reply.sessionId))
          return { ok: true, sessionId: reply.sessionId }
        if (reply.ok === false && isText(reply.error)) return { ok: false, error: reply.error }
        return { ok: false, error: 'invalid' }
      } catch {
        return { ok: false, error: 'timeout' }
      }
    },
    unwatch: (sessionId) => {
      socket.emit('live.unwatch', { sessionId })
    },
    answer: (sessionId, sdp) => {
      socket.emit('live.answer', { sessionId, sdp })
    },
    candidate: (sessionId, candidate) => {
      socket.emit('live.candidate', { sessionId, candidate })
    },
    close: () => {
      unwatch()
      socket.close()
    },
  }
}
