import { io, type Socket } from 'socket.io-client'
import type { PositionMarkerDto } from '../api/positions'
import { readToken } from '../api/http'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// Assina o canal de posições ao vivo (mesmo gateway do chat; o server emite
// 'position' pros admins da org a cada heartbeat). Retorna cleanup — espelho
// exato do subscribeMessages em chat/chatSocket.ts.
export function subscribePositions(cb: (m: PositionMarkerDto) => void): () => void {
  const socket: Socket = io(BASE_URL, {
    auth: { token: readToken() },
    // Espelho do chatSocket: polling primeiro pra atravessar a interstitial do
    // ngrok no QA remoto (WS puro morre no handshake; polling é XHR e carrega
    // o header). Upgrade pra WS quando o caminho deixa.
    transports: ['polling', 'websocket'],
  })
  socket.on('position', cb)
  return () => {
    socket.close()
  }
}
