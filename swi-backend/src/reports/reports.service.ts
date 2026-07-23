import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { NotificationService } from '../notifications/notification.service'
import type { Comment, Profile, Report, ReportStatus, User } from '@prisma/client'
import type { CreateCommentDto, CreateReportDto, UpdateReportDto } from './dto'

const LIST_CAP = 200

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  async list() {
    const rows = await this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: LIST_CAP })
    return Promise.all(rows.map((r) => this.toDto(r)))
  }

  async get(id: string) {
    const r = await this.prisma.report.findUnique({
      where: { id },
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { include: { profile: true } } },
        },
      },
    })
    if (!r) return null
    const comments = await Promise.all(r.comments.map((c) => this.toCommentDto(c, c.author)))
    return { ...(await this.toDto(r)), comments }
  }

  async create(authorId: string, dto: CreateReportDto) {
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
    const r = await this.prisma.report.create({
      data: {
        authorId,
        title: dto.title,
        summary: dto.summary,
        details: dto.details,
        responsibles: dto.responsibles ?? [],
        imageKeys: dto.imageKeys ?? [],
        status: 'pending',
        statusLabel: 'Em Revisão',
        authorName: author?.profile?.fullName ?? author?.name ?? null,
        authorAvatarKey: author?.profile?.avatarKey ?? null,
        sector: author?.profile?.sector ?? null,
        activities: [],
      },
    })
    // Cross-domain best-effort: relatório novo notifica os OUTROS workers aprovados
    // (inbox de relatórios é org-wide). Falha aqui não quebra a criação.
    try {
      const others = await this.prisma.user.findMany({
        where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: authorId } },
        select: { id: true },
      })
      await this.notifications.enqueueForMany(others.map((u) => u.id), {
        domain: 'reports',
        title: 'Novo relatório',
        body: dto.title,
        targetId: r.id,
      })
    } catch { /* best-effort */ }
    return this.toDto(r)
  }

  async update(id: string, _userId: string, dto: UpdateReportDto) {
    try {
      const r = await this.prisma.report.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.summary !== undefined && { summary: dto.summary }),
          ...(dto.details !== undefined && { details: dto.details }),
          ...(dto.responsibles !== undefined && { responsibles: dto.responsibles }),
          ...(dto.status !== undefined && { status: dto.status as ReportStatus }),
          ...(dto.statusLabel !== undefined && { statusLabel: dto.statusLabel }),
          ...(dto.imageKeys !== undefined && { imageKeys: dto.imageKeys }),
        },
      })
      return this.toDto(r)
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') throw new NotFoundException('Relatório não encontrado')
      throw e
    }
  }

  async addComment(reportId: string, authorId: string, dto: CreateCommentDto) {
    const exists = await this.prisma.report.findUnique({ where: { id: reportId }, select: { id: true } })
    if (!exists) throw new NotFoundException('Relatório não encontrado')
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
    const c = await this.prisma.comment.create({ data: { reportId, authorId, body: dto.body } })
    return this.toCommentDto(c, author)
  }

  private async toCommentDto(c: Comment, author: (User & { profile: Profile | null }) | null) {
    // Identidade do autor resolvida ao vivo (nome/avatar atuais), ao contrário do
    // Report que faz snapshot do autor na criação — escolha deliberada.
    return {
      id: c.id,
      body: c.body,
      authorName: author?.profile?.fullName ?? author?.name ?? '',
      authorAvatarUri: author?.profile?.avatarKey ? await this.media.presignGet(author.profile.avatarKey) : '',
      createdAt: this.formatDate(c.createdAt),
    }
  }

  // Devolve exatamente o shape mobile `Report` (keys→urls presigned, date
  // dd/mm/yyyy, null→'' nos campos string que as telas exigem).
  private async toDto(r: Report) {
    return {
      id: r.id,
      title: r.title,
      summary: r.summary ?? '',
      status: r.status,
      statusLabel: r.statusLabel ?? '',
      authorName: r.authorName ?? '',
      authorAvatarUri: r.authorAvatarKey ? await this.media.presignGet(r.authorAvatarKey) : '',
      creationDate: this.formatDate(r.creationDate),
      sector: r.sector ?? '',
      responsibles: r.responsibles,
      details: r.details ?? '',
      images: await this.media.presignGetMany(r.imageKeys),
      activities: (r.activities as unknown) ?? [],
    }
  }

  private formatDate(d: Date): string {
    // BRT (America/Sao_Paulo) é UTC-3 fixo (Brasil aboliu o horário de verão em
    // 2019). Sem depender de ICU/tz-data: subtrai 3h e lê os componentes UTC.
    // Paridade com o mock, que formata em hora local do device (BR).
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000)
    const dd = String(brt.getUTCDate()).padStart(2, '0')
    const mm = String(brt.getUTCMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${brt.getUTCFullYear()}`
  }
}
