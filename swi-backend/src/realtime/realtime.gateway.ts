import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { requireJwtSecret } from '../auth/jwt-secret'
import { corsOrigins } from '../cors'

// Gateway WS único (chat agora; notificações na Fatia 5). Mesma porta HTTP (3000).
// Autentica no handshake com o MESMO segredo JWT do REST; cada conexão entra na
// sala `user:<userId>` pra ser endereçável por `emitToUsers`.
// CORS alinhado ao HTTP (mesma env CORS_ORIGINS do PR #41). Cliente RN não manda
// header Origin no handshake, então o mobile não é afetado; browser (admin) só
// conecta das origins liberadas.
@WebSocketGateway({ cors: { origin: corsOrigins(process.env) } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server
  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    const token = this.extractToken(client)
    try {
      const payload = this.jwt.verify(token, { secret: requireJwtSecret() }) as { sub: string }
      client.data.userId = payload.sub
      client.join(this.room(payload.sub))
    } catch {
      client.disconnect()
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const id of userIds) this.server.to(this.room(id)).emit(event, payload)
  }

  private room(userId: string): string { return `user:${userId}` }

  private extractToken(client: Socket): string {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth
    const header = client.handshake.headers?.authorization
    return header?.startsWith('Bearer ') ? header.slice(7) : ''
  }
}
