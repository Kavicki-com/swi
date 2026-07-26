import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { NotificationService } from '../notifications/notification.service'
import { Prisma } from '@prisma/client'
import type { Conversation, Message, User, Profile } from '@prisma/client'

type UserWithProfile = User & { profile: Profile | null }

const LIST_CAP = 200

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationService,
  ) {}

  async listDirectory(userId: string, companyId: string | null) {
    const users = await this.prisma.user.findMany({
      // Org-scoping (QA C1): diretório restrito à empresa do usuário.
      where: { approvalStatus: 'APPROVED', role: 'WORKER', id: { not: userId }, companyId },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: LIST_CAP,
    })
    return Promise.all(users.map((u) => this.toContact(u)))
  }

  async listConversations(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { has: userId } },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      take: LIST_CAP,
    })
    return Promise.all(rows.map((c) => this.toConvDto(c)))
  }

  async listMessages(userId: string, convId: string) {
    await this.assertMember(userId, convId)
    // take negativo = as 200 mensagens MAIS RECENTES, mantendo a ordem asc (Prisma pega os últimos N).
    const rows = await this.prisma.message.findMany({ where: { conversationId: convId }, orderBy: { sentAt: 'asc' }, take: -LIST_CAP })
    return Promise.all(rows.map((m) => this.toMsgDto(m)))
  }

  async sendMessage(userId: string, convId: string, dto: { body?: string; imageKey?: string }) {
    // O id é o contrato determinístico [a,b].sort().join('#'): exige exatamente 2
    // partes, forma canônica e comigo dentro — senão 404. Impede criar thread
    // paralela por id invertido, self-conversa (a#a) ou id malformado.
    const participants = convId.split('#')
    if (
      participants.length !== 2 ||
      convId !== [...participants].sort().join('#') ||
      !participants.includes(userId)
    ) {
      throw new NotFoundException('Conversa não encontrada')
    }
    const recipientId = participants.find((p) => p !== userId)
    if (!recipientId) throw new NotFoundException('Conversa não encontrada') // self-conv a#a: sem destinatário

    let conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
    if (!conv) {
      try {
        conv = await this.createConversation(convId, participants)
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Outro request criou a conversa entre o findUnique e o create → re-busca.
          conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
          if (!conv) throw e // P2002 sem linha visível: não engolir silenciosamente.
        } else {
          throw e // NotFoundException (user inexistente) e afins seguem propagando.
        }
      }
    }

    const now = new Date()
    const msg = await this.prisma.message.create({
      data: { conversationId: convId, senderId: userId, body: dto.body ?? null, imageKey: dto.imageKey ?? null, sentAt: now },
    })

    // Destinatário já resolvido (guarded) a partir do id validado — 2-party.
    const lastBody = dto.body || (dto.imageKey ? '📷 Imagem' : '')
    // UPDATE atômico: incrementa o contador do destinatário sem read-modify-write (fecha o lost-update).
    await this.prisma.$executeRaw`
      UPDATE "Conversation"
      SET "lastMessageBody" = ${lastBody},
          "lastMessageAt"   = ${now},
          "unreadByJson"    = jsonb_set(
            COALESCE("unreadByJson", '{}'::jsonb),
            ARRAY[${recipientId}],
            to_jsonb(COALESCE(("unreadByJson"->>${recipientId})::int, 0) + 1),
            true)
      WHERE id = ${convId}`

    const out = await this.toMsgDto(msg)
    this.realtime.emitToUsers(conv.participants, 'message', out)
    // Cross-domain best-effort: notifica o(s) destinatário(s). Falha aqui NUNCA
    // quebra o envio da mensagem — a notificação é derivada do write-fonte.
    const recipients = conv.participants.filter((p) => p !== userId)
    if (recipients.length) {
      try {
        const sender = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
        const senderName = sender?.profile?.fullName || sender?.name || 'Nova mensagem'
        await this.notifications.enqueueForMany(recipients, {
          domain: 'chat',
          title: senderName,
          body: dto.body || 'Enviou um anexo',
          targetId: convId,
        })
      } catch { /* best-effort */ }
    }
    return out
  }

  async markRead(userId: string, convId: string) {
    await this.assertMember(userId, convId)   // membership → 404 se não-membro
    await this.prisma.$executeRaw`
      UPDATE "Conversation"
      SET "unreadByJson" = jsonb_set(COALESCE("unreadByJson", '{}'::jsonb), ARRAY[${userId}], '0'::jsonb, true)
      WHERE id = ${convId}`
  }

  private async assertMember(userId: string, convId: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
    if (!conv || !conv.participants.includes(userId)) throw new NotFoundException('Conversa não encontrada')
    return conv
  }

  private async createConversation(convId: string, parts: string[]): Promise<Conversation> {
    const users = await this.prisma.user.findMany({ where: { id: { in: parts } }, include: { profile: true } })
    if (users.length !== parts.length) throw new NotFoundException('Conversa não encontrada')
    const byId = new Map(users.map((u) => [u.id, u as UserWithProfile]))
    return this.prisma.conversation.create({
      data: {
        id: convId,
        participants: parts,
        participantNames: parts.map((id) => byId.get(id)?.profile?.fullName ?? byId.get(id)?.name ?? ''),
        participantSubtitles: parts.map((id) => byId.get(id)?.profile?.sector ?? ''),
        participantAvatarKeys: parts.map((id) => byId.get(id)?.profile?.avatarKey ?? ''),
        unreadByJson: {},
      },
    })
  }

  private async toContact(u: UserWithProfile) {
    return {
      workerId: u.id,
      name: u.profile?.fullName ?? u.name,
      sector: u.profile?.sector ?? '',
      role: u.profile?.jobTitle ?? '',
      avatarUri: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
      // Identidade clínica REAL (QA de volume 2026-07-26): sem estes campos o
      // painel do chat mostrava 26 anos / O+ pra TODO mundo, contradizendo as
      // outras telas do mesmo trabalhador. Não são vitais de smartband.
      birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
      bloodType: u.profile?.bloodType ?? null,
      allergies: u.profile?.allergies ?? null,
    }
  }

  private async toConvDto(c: Conversation) {
    const participantAvatars = await Promise.all(
      c.participantAvatarKeys.map((k) => (k ? this.media.presignGet(k) : Promise.resolve(''))),
    )
    return {
      id: c.id,
      participants: c.participants,
      participantNames: c.participantNames,
      participantSubtitles: c.participantSubtitles,
      participantAvatars,
      lastMessageBody: c.lastMessageBody ?? '',
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      unreadBy: (c.unreadByJson as Record<string, number>) ?? {},
    }
  }

  private async toMsgDto(m: Message) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      participants: m.conversationId.split('#'),
      senderId: m.senderId,
      body: m.body ?? '',
      imageUri: m.imageKey ? await this.media.presignGet(m.imageKey) : null,
      sentAt: m.sentAt.toISOString(),
    }
  }
}
