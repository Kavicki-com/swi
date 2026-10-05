import type { Socket } from 'socket.io'

/**
 * Token do handshake, pela mesma regra do RealtimeGateway (que guarda a dele
 * como privada): primeiro `auth.token`, depois o cabeçalho Bearer. Vazio
 * quando não há; quem recebe trata como sem identidade.
 */
export function socketToken(client: Pick<Socket, 'handshake'>): string {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth
  const header = client.handshake.headers?.authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
}
