import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { requireJwtSecret } from '../auth/jwt-secret'
import { wsCorsOptions } from '../cors'
import { PrismaService } from '../prisma/prisma.service'

// Gateway WS único (chat agora; notificações na Fatia 5). Mesma porta HTTP (3000).
// Autentica no handshake com o MESMO segredo JWT do REST e confere no banco que
// o usuário existe e está ativo: o token vale por dias, e sem a conferência um
// usuário desativado seguiria recebendo eventos até ele vencer. Cada conexão
// entra na sala `user:<userId>` pra ser endereçável por `emitToUsers`.
// CORS alinhado ao HTTP (mesma env CORS_ORIGINS do PR #41). Cliente RN não manda
// header Origin no handshake, então o mobile não é afetado; browser (admin) só
// conecta das origins liberadas.
// No modo proxy (Cloudez) o cors sai undefined: o socket.io emitindo ACAO
// duplicaria o `*` que o nginx do host injeta — ver cors.ts.
@WebSocketGateway({ cors: wsCorsOptions(process.env) })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client)
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, { secret: requireJwtSecret() })
      // Falha na conferência também fecha: sem saber se o usuário está ativo,
      // a conexão não abre, e o cliente tenta de novo.
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { active: true } })
      if (user === null || !user.active) {
        client.disconnect()
        return
      }
      // `client.data` é `any` no tipo do socket.io (o payload por conexão é
      // livre); a asserção estreita só o campo que este gateway grava.
      ;(client.data as { userId?: string }).userId = payload.sub
      void client.join(this.room(payload.sub))
    } catch {
      client.disconnect()
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const id of userIds) this.server.to(this.room(id)).emit(event, payload)
  }

  // Derruba as conexões abertas de quem foi desativado ou excluído. O handshake
  // só confere o usuário ao conectar: sem isto, um socket já aberto seguiria
  // recebendo chat, notificação e telemetria até cair sozinho. Quem tentar
  // reconectar é recusado pelo handleConnection.
  disconnectUser(userId: string): void {
    this.server.in(this.room(userId)).disconnectSockets(true)
  }

  private room(userId: string): string { return `user:${userId}` }

  private extractToken(client: Socket): string {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth
    const header = client.handshake.headers?.authorization
    return header?.startsWith('Bearer ') ? header.slice(7) : ''
  }
}
