import { io, type Socket } from 'socket.io-client'
import type { EvacuationProgressDto } from '../api/evacuations'
import { readToken } from '../api/http'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export type EvacuationAckEvent = {
  evacuationId: string
  workerId: string
  acked: number
  total: number
}

export interface EvacuationHandlers {
  onStarted: (dto: EvacuationProgressDto) => void
  onAck: (ev: EvacuationAckEvent) => void
  onEnded: (ev: { id: string }) => void
}

// Assina os 3 eventos do ciclo de evacuação (mesmo gateway do chat/posições).
// Retorna cleanup — espelho do subscribePositions em positions/positionsSocket.ts.
export function subscribeEvacuationEvents(handlers: EvacuationHandlers): () => void {
  const socket: Socket = io(BASE_URL, {
    auth: { token: readToken() },
    // Espelho do chatSocket: polling primeiro pra atravessar a interstitial do
    // ngrok no QA remoto (WS puro morre no handshake; polling é XHR e carrega
    // o header). Upgrade pra WS quando o caminho deixa.
    transports: ['polling', 'websocket'],
  })
  socket.on('evacuation', handlers.onStarted)
  socket.on('evacuation-ack', handlers.onAck)
  socket.on('evacuation-ended', handlers.onEnded)
  return () => {
    socket.close()
  }
}
