import { io, type Socket } from 'socket.io-client'
import type { NotificationDto } from '../api/notifications'
import { readToken } from '../api/http'
import { getApiUrl } from '../api/apiConfig'
import { connectionStatus } from '../realtime/connectionStatus'

// Assina as notificações do próprio admin: o servidor emite 'notification' só
// para o destinatário, logo depois de gravar. Conexão própria, no mesmo molde
// das posições e da evacuação. Retorna a limpeza.
export function subscribeNotifications(cb: (n: NotificationDto) => void): () => void {
  const socket: Socket = io(getApiUrl(), {
    auth: { token: readToken() },
    // Polling primeiro, como os outros sockets do painel: atravessa a página
    // intermediária do túnel, onde o WS puro morre no handshake.
    transports: ['polling', 'websocket'],
  })
  socket.on('notification', cb)
  const unwatch = connectionStatus.watch(socket)
  return () => {
    unwatch()
    socket.close()
  }
}
