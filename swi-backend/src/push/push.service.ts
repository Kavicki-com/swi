import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PushPlatform } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { JsonResponse } from '../common/httpGet'
import { describeError } from '../common/describe-error'
import { parseExpoAccessToken, parsePushEnabled } from '../config/runtime-env'

// Push para o app pelo serviço da Expo, que repassa ao FCM (Android) e ao
// APNs (iOS). Existe porque o socket só alcança o app aberto: com o celular no
// bolso, a evacuação precisa chegar como notificação do sistema.

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
/** Limite de mensagens por requisição do serviço da Expo. */
export const PUSH_BATCH_SIZE = 100
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT')

/** POST JSON. Em produção é o httpPostJson; nos testes, sempre um dublê. */
export type PushTransport = (url: string, body: unknown, headers: Record<string, string>) => Promise<JsonResponse>

export interface PushContent {
  /** Sem título e sem corpo, a mensagem é só de dados: o app trata em silêncio. */
  title?: string
  body?: string
  data: Record<string, unknown>
  priority: 'default' | 'normal' | 'high'
  /** Canal de notificação do Android, criado pelo app. */
  channelId?: string
  sound?: 'default'
  /** iOS: acorda o app em segundo plano para tratar uma mensagem só de dados. */
  contentAvailable?: boolean
}

// Recorte da resposta que este serviço lê. Cada ticket vem na mesma posição
// da mensagem enviada, e é essa posição que liga o erro ao token.
interface ExpoTicket {
  status?: unknown
  message?: unknown
  details?: { error?: unknown }
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport,
  ) {}

  // Upsert pelo token, não pelo usuário: o token é do aparelho. Se outra conta
  // entra no mesmo celular, a linha passa a ser dela, e o aviso da conta
  // anterior deixa de tocar ali.
  async register(userId: string, token: string, platform: PushPlatform): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    })
  }

  // No logout. Filtra pelo dono para um usuário não desligar o aparelho de
  // outro; token alheio ou já removido não é erro, o logout segue igual.
  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } })
  }

  /**
   * Dispara sem esperar. Quem chama (o start da evacuação) devolve a resposta
   * HTTP sem aguardar a Expo, e nenhuma rejeição escapa para o processo.
   */
  notifyUsers(userIds: string[], content: PushContent): void {
    this.sendToUsers(userIds, content).catch((err: unknown) => {
      this.logger.warn(`push: envio interrompido (${describeError(err)})`)
    })
  }

  /** Envia para todos os aparelhos dos usuários. Nunca rejeita: falha vira log. */
  async sendToUsers(userIds: string[], content: PushContent): Promise<void> {
    if (!parsePushEnabled(process.env) || userIds.length === 0) return
    let tokens: string[]
    try {
      const rows = await this.prisma.pushToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
      })
      tokens = rows.map((r) => r.token)
    } catch (err) {
      this.logger.warn(`push: tokens não lidos (${describeError(err)})`)
      return
    }
    // Lotes em sequência, não em paralelo: o servidor tem pouca memória, e um
    // lote que falha não impede os outros.
    for (let i = 0; i < tokens.length; i += PUSH_BATCH_SIZE) {
      await this.sendBatch(tokens.slice(i, i + PUSH_BATCH_SIZE), content)
    }
  }

  private async sendBatch(tokens: string[], content: PushContent): Promise<void> {
    const messages = tokens.map((to) => this.toMessage(to, content))
    let tickets: ExpoTicket[]
    try {
      const res = await this.transport(EXPO_PUSH_URL, messages, this.headers())
      if (!res.ok) {
        this.logger.warn(`push: serviço da Expo respondeu ${res.status} para ${tokens.length} mensagens`)
        return
      }
      const body = (await res.json()) as { data?: unknown } | null
      tickets = Array.isArray(body?.data) ? (body.data as ExpoTicket[]) : []
    } catch (err) {
      this.logger.warn(`push: lote de ${tokens.length} mensagens não enviado (${describeError(err)})`)
      return
    }

    const dead: string[] = []
    let otherErrors = 0
    tickets.forEach((ticket, i) => {
      if (ticket?.status !== 'error' || i >= tokens.length) return
      // Aparelho desinstalou o app ou revogou a permissão: o token não volta a
      // valer, e mantê-lo só gasta envio a cada evacuação.
      if (ticket.details?.error === 'DeviceNotRegistered') dead.push(tokens[i])
      else otherErrors++
    })
    if (otherErrors > 0) this.logger.warn(`push: ${otherErrors} mensagens recusadas pelo serviço da Expo`)
    if (dead.length === 0) return
    try {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } })
    } catch (err) {
      this.logger.warn(`push: tokens mortos não apagados (${describeError(err)})`)
    }
  }

  private toMessage(to: string, content: PushContent): Record<string, unknown> {
    return {
      to,
      ...(content.title !== undefined ? { title: content.title } : {}),
      ...(content.body !== undefined ? { body: content.body } : {}),
      ...(content.sound !== undefined ? { sound: content.sound } : {}),
      priority: content.priority,
      ...(content.channelId !== undefined ? { channelId: content.channelId } : {}),
      data: content.data,
      ...(content.contentAvailable ? { _contentAvailable: true } : {}),
    }
  }

  // Envio autenticado só quando a conta Expo exige: sem token, sem header.
  private headers(): Record<string, string> {
    const token = parseExpoAccessToken(process.env)
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
}
