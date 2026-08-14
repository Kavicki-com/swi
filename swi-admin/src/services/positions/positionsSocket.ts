import { io, type Socket } from 'socket.io-client'
import type { PositionMarkerDto } from '../api/positions'
import { readToken } from '../api/http'

import { getApiUrl } from '../api/apiConfig'

// Assina o canal de posições ao vivo (mesmo gateway do chat; o server emite
// 'position' pros admins da org a cada heartbeat). Retorna cleanup — espelho
// exato do subscribeMessages em chat/chatSocket.ts.
export function subscribePositions(cb: (m: PositionMarkerDto) => void): () => void {
  const socket: Socket = io(getApiUrl(), {
    auth: { token: readToken() },
    // Espelho do chatSocket: polling primeiro pra atravessar página
    // interstitial de túnel, onde o WS puro morre no handshake. Polling é XHR e
    // carrega o header, e o upgrade pra WS acontece quando o caminho deixa.
    transports: ['polling', 'websocket'],
  })
  socket.on('position', cb)
  return () => {
    socket.close()
  }
}
