import { io, type Socket } from 'socket.io-client'
import type { Message } from './types'
import { readToken } from '../api/http'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// Assina o canal global de mensagens ao vivo. Retorna cleanup. O server só
// emite 'message'; toda escrita é REST (ver design).
export function subscribeMessages(cb: (m: Message) => void): () => void {
  const socket: Socket = io(BASE_URL, {
    auth: { token: readToken() },
    transports: ['websocket'],
  })
  socket.on('message', cb)
  return () => {
    socket.close()
  }
}
