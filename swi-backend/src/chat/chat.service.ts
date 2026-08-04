import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { NotificationService } from '../notifications/notification.service'
import { MailService } from '../mail/mail.service'
import { Prisma } from '@prisma/client'
import type { Conversation, Message, User, Profile } from '@prisma/client'

type UserWithProfile = User & { profile: Profile | null }

const LIST_CAP = 200

/** Texto que substitui a mensagem excluída no preview da caixa de entrada. */
const DELETED_PREVIEW = 'Mensagem excluída'

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationService,
    // Opcional no TIPO só pra não quebrar instanciações antigas (specs com 4
    // args); em runtime o Nest injeta sempre — ChatModule importa MailModule.
    private readonly mail?: MailService,
  ) {}

  async listDirectory(userId: string) {
    const users = await this.prisma.user.findMany({
      // Diretório ABERTO (decisão 2026-07-27): o worker conversa com quem
      // quiser no app — colegas, painel, gente de outra empresa.
      //
      // Saíram dois recortes: o de empresa (org-scoping da QA C1) e o de papel
      // (que listava WORKER+ADMIN, hoje todo mundo, mas excluiria em silêncio
      // qualquer papel novo).
      //
      // Sobrou o que ainda faz sentido: conta aprovada — PENDING e REJECTED
      // sequer conseguem entrar, então oferecê-los como contato só renderia
      // mensagem sem leitor — e eu fora da minha própria lista.
      where: { approvalStatus: 'APPROVED', id: { not: userId } },
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

  // QA Web #4 — editar e excluir mensagem. Só o AUTOR, sem limite de tempo, e
  // exclusão deixa marca em vez de apagar (decisões do usuário 2026-07-31).
  //
  // Os dois emitem o evento 'message' com o estado ATUAL da mensagem, e não um
  // evento novo: o cliente reconhece pelo id e faz upsert. Inventar
  // 'message:edited' obrigaria cada cliente a tratar um caso a mais, e um
  // cliente antigo simplesmente ignoraria a edição, seguindo com texto velho.
  async editMessage(userId: string, convId: string, msgId: string, dto: { body: string }) {
    const conv = await this.assertMember(userId, convId)
    const msg = await this.assertOwnMessage(userId, convId, msgId)
    if (msg.deletedAt) throw new BadRequestException('Mensagem excluída não pode ser editada')

    const body = dto.body?.trim()
    if (!body) throw new BadRequestException('Mensagem vazia')

    const updated = await this.prisma.message.update({
      where: { id: msgId },
      data: { body, editedAt: new Date() },
    })
    // O preview da caixa de entrada mostra o texto da última mensagem. Sem
    // isto, a lista continuaria exibindo a versão antiga do que foi corrigido.
    await this.syncPreviewIfLast(convId, msgId, body)

    const out = await this.toMsgDto(updated)
    this.realtime.emitToUsers(conv.participants, 'message', out)
    return out
  }

  async deleteMessage(userId: string, convId: string, msgId: string) {
    const conv = await this.assertMember(userId, convId)
    const msg = await this.assertOwnMessage(userId, convId, msgId)

    // Idempotente: excluir de novo não remarca a data. A primeira exclusão é a
    // que vale, e é ela que uma auditoria futura vai querer ler.
    if (msg.deletedAt) return this.toMsgDto(msg)

    const updated = await this.prisma.message.update({
      where: { id: msgId },
      // `body` e `imageKey` FICAM na linha: a lápide é reversível, e quem para
      // de devolver o conteúdo é o toMsgDto.
      data: { deletedAt: new Date() },
    })
    await this.syncPreviewIfLast(convId, msgId, DELETED_PREVIEW)

    const out = await this.toMsgDto(updated)
    this.realtime.emitToUsers(conv.participants, 'message', out)
    return out
  }

  // QA Web #9 — denunciar mensagem de outra pessoa. O e-mail é o único
  // registro (sem persistência por ora, decisão 2026-08-04), então quem não
  // tem destinatário configurado falha ALTO: 204 com denúncia pro vácuo faria
  // o cliente mostrar "enviada" pra ninguém ler.
  async reportMessage(userId: string, convId: string, msgId: string, dto: { reason: string; text?: string }) {
    await this.assertMember(userId, convId)
    const msg = await this.prisma.message.findUnique({ where: { id: msgId } })
    // Mesma regra do assertOwnMessage: mensagem de outra conversa é 404, não
    // 403 — responder "existe" contaria a existência a quem não é membro.
    if (!msg || msg.conversationId !== convId) throw new NotFoundException('Mensagem não encontrada')
    if (msg.senderId === userId) throw new BadRequestException('Não é possível denunciar a própria mensagem')

    const to = process.env.REPORT_TO_EMAIL
    if (!to || !this.mail) throw new ServiceUnavailableException('Denúncia indisponível no momento')

    const users = await this.prisma.user.findMany({
      where: { id: { in: [userId, msg.senderId] } },
      include: { profile: true },
    })
    const byId = new Map(users.map((u) => [u.id, u as UserWithProfile]))
    const name = (id: string) => byId.get(id)?.profile?.fullName || byId.get(id)?.name || id
    const email = (id: string) => byId.get(id)?.email ?? ''

    await this.mail.sendMessageReport(to, {
      reason: dto.reason,
      text: dto.text,
      messageId: msg.id,
      conversationId: convId,
      sentAt: msg.sentAt.toISOString(),
      // O corpo vai como está no banco, mesmo se a mensagem foi excluída
      // depois: quem denuncia viu o conteúdo, e ele é a evidência.
      messageBody: msg.body || (msg.imageKey ? '📷 Imagem' : ''),
      reporterName: name(userId),
      reporterEmail: email(userId),
      authorName: name(msg.senderId),
      authorEmail: email(msg.senderId),
    })
  }

  /** 404 se a mensagem não existe ou é de outra conversa, 403 se não é minha. */
  private async assertOwnMessage(userId: string, convId: string, msgId: string): Promise<Message> {
    const msg = await this.prisma.message.findUnique({ where: { id: msgId } })
    // Mensagem de OUTRA conversa vira 404 e não 403 de propósito: responder
    // "existe, mas não é sua" contaria que a mensagem existe a quem não é
    // membro de lá.
    if (!msg || msg.conversationId !== convId) {
      throw new NotFoundException('Mensagem não encontrada')
    }
    if (msg.senderId !== userId) throw new ForbiddenException('Só o autor pode editar ou excluir')
    return msg
  }

  /** Atualiza o preview da conversa apenas quando a mensagem tocada é a última. */
  private async syncPreviewIfLast(convId: string, msgId: string, preview: string) {
    const last = await this.prisma.message.findFirst({
      where: { conversationId: convId },
      orderBy: { sentAt: 'desc' },
    })
    if (last?.id !== msgId) return
    await this.prisma.conversation.update({
      where: { id: convId },
      data: { lastMessageBody: preview },
    })
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
      // Idem: o painel fixava `gender: 'male'`, então as colaboradoras do
      // quadro apareciam como "Masculino".
      gender: u.profile?.gender ?? null,
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
    // Lápide: a mensagem continua na listagem, mantendo a posição e a hora,
    // mas o conteúdo não sai mais da API. É aqui que "deixa marca" acontece de
    // verdade — se o texto vazasse no DTO, um cliente distraído mostraria o
    // que a pessoa acabou de excluir.
    // Boolean() e não `!== null`: mensagem carregada sem a coluna (fixture
    // parcial, projeção, cliente antigo) vem `undefined`, e `undefined !== null`
    // é verdadeiro — a mensagem inteira seria tratada como excluída.
    const deleted = Boolean(m.deletedAt)
    return {
      id: m.id,
      conversationId: m.conversationId,
      participants: m.conversationId.split('#'),
      senderId: m.senderId,
      body: deleted ? '' : (m.body ?? ''),
      imageUri: deleted || !m.imageKey ? null : await this.media.presignGet(m.imageKey),
      sentAt: m.sentAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    }
  }
}
