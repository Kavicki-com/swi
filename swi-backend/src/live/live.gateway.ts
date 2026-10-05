import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { describeError } from '../common/describe-error'
import { wsCorsOptions } from '../cors'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { socketServerOptions } from '../realtime/socket-options'
import { LiveRateLimit, type LiveEventKind } from './live-rate-limit'
import { LiveService, type LiveDelivery, type LiveOutcome, type LiveReply } from './live.service'
import { socketToken } from './socket-token'

type GatewayReply = LiveReply | { ok: false; error: 'internal' | 'rate-limited' }

/**
 * Sinalização da transmissão ao vivo, no MESMO socket do RealtimeGateway: sem
 * namespace, o Nest liga as duas classes ao mesmo servidor socket.io, então é
 * a mesma conexão, com o mesmo token. Classe à parte para não mexer no gateway
 * que outras frentes também alteram.
 *
 * Os guardas e pipes globais do REST não alcançam eventos de socket; a
 * conferência de quem fala e do conteúdo é do LiveService, e o limite por
 * socket é deste gateway.
 *
 * O socket.io entrega cada evento sem esperar o anterior, e ligar e assistir
 * esperam o banco antes de gravar. Por isso os eventos de um mesmo socket
 * passam por uma fila: um parar enviado logo depois de ligar, ou a queda do
 * socket, só rodam quando o que veio antes terminou.
 */
@WebSocketGateway({ cors: wsCorsOptions(process.env), ...socketServerOptions(process.env) })
export class LiveGateway implements OnGatewayDisconnect {
  @WebSocketServer() server!: Server
  private readonly logger = new Logger(LiveGateway.name)
  private readonly queues = new Map<string, Promise<GatewayReply>>()

  constructor(
    private readonly live: LiveService,
    private readonly realtime: RealtimeGateway,
    private readonly limits: LiveRateLimit,
  ) {}

  @SubscribeMessage('live.start')
  start(@ConnectedSocket() client: Socket): Promise<GatewayReply> {
    return this.run(client, 'control', () => this.live.start(client.id, socketToken(client)))
  }

  @SubscribeMessage('live.stop')
  stop(@ConnectedSocket() client: Socket): Promise<GatewayReply> {
    // O id gravado pelo RealtimeGateway depois de conferir a conta; só lido aqui.
    const userId = (client.data as { userId?: string } | undefined)?.userId
    return this.run(client, 'control', () => this.live.stop(client.id, userId))
  }

  @SubscribeMessage('live.watch')
  watch(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<GatewayReply> {
    return this.run(client, 'control', () => this.live.watch(client.id, socketToken(client), body))
  }

  @SubscribeMessage('live.unwatch')
  unwatch(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<GatewayReply> {
    return this.run(client, 'control', () => this.live.unwatch(client.id, body))
  }

  @SubscribeMessage('live.offer')
  offer(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<GatewayReply> {
    return this.run(client, 'relay', () => this.live.relay('offer', client.id, body))
  }

  @SubscribeMessage('live.answer')
  answer(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<GatewayReply> {
    return this.run(client, 'relay', () => this.live.relay('answer', client.id, body))
  }

  @SubscribeMessage('live.candidate')
  candidate(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<GatewayReply> {
    return this.run(client, 'relay', () => this.live.relay('candidate', client.id, body))
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const pending = this.queues.get(client.id)
    this.queues.delete(client.id)
    if (pending) await pending
    try {
      this.deliver(await this.live.leave(client.id))
    } catch (error) {
      this.logger.warn(`Falha ao encerrar a transmissão do socket que caiu: ${describeError(error)}`)
    } finally {
      this.limits.forget(client.id)
    }
  }

  private run(
    client: Socket,
    kind: LiveEventKind,
    work: () => LiveOutcome | Promise<LiveOutcome>,
  ): Promise<GatewayReply> {
    // O limite vem antes da fila: excesso não chega a enfileirar nem a consultar o banco.
    if (!this.limits.take(client.id, kind)) return Promise.resolve({ ok: false, error: 'rate-limited' })
    const previous = this.queues.get(client.id) ?? Promise.resolve<GatewayReply>({ ok: true })
    const current = previous.then(() => this.execute(work))
    this.queues.set(client.id, current)
    void current.then(() => {
      if (this.queues.get(client.id) === current) this.queues.delete(client.id)
    })
    return current
  }

  /** Nunca rejeita: uma falha vira resposta de erro e não trava a fila do socket. */
  private async execute(work: () => LiveOutcome | Promise<LiveOutcome>): Promise<GatewayReply> {
    try {
      const { reply, deliveries } = await work()
      this.deliver(deliveries)
      return reply
    } catch (error) {
      this.logger.warn(`Falha na sinalização da transmissão: ${describeError(error)}`)
      return { ok: false, error: 'internal' }
    }
  }

  private deliver(deliveries: LiveDelivery[]): void {
    for (const delivery of deliveries) {
      if ('socketId' in delivery) this.server.to(delivery.socketId).emit(delivery.event, delivery.payload)
      else this.realtime.emitToUsers(delivery.userIds, delivery.event, delivery.payload)
    }
  }
}
