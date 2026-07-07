import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { NotificationService } from '../notifications/notification.service'
import type { Report, ReportComment } from '@prisma/client'
import type { CreateReportDto, UpdateReportDto } from './dto'

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
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    })
    return r ? this.toDto(r, r.comments) : null
  }

  // PATCH parcial: só os campos presentes no dto entram no update (undefined
  // não sobrescreve). Inexistente → null (controller vira 404); P2025 é o
  // "record not found" do Prisma no update sem pre-check.
  async update(id: string, dto: UpdateReportDto) {
    const data: Record<string, unknown> = {}
    if (dto.title !== undefined) data.title = dto.title
    if (dto.summary !== undefined) data.summary = dto.summary
    if (dto.details !== undefined) data.details = dto.details
    if (dto.responsibles !== undefined) data.responsibles = dto.responsibles
    if (dto.imageKeys !== undefined) data.imageKeys = dto.imageKeys
    try {
      await this.prisma.report.update({ where: { id }, data })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') return null
      throw e
    }
    return this.get(id)
  }

  // Snapshot denorm do autor no momento do comentário (paridade com o
  // create do Report). Relatório inexistente → null (controller vira 404).
  async addComment(reportId: string, authorId: string, text: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } })
    if (!report) return null
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
    const c = await this.prisma.reportComment.create({
      data: {
        reportId,
        authorId,
        authorName: author?.profile?.fullName ?? author?.name ?? null,
        authorAvatarKey: author?.profile?.avatarKey ?? null,
        text,
      },
    })
    return this.commentToDto(c)
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

  // Devolve exatamente o shape mobile `Report` (keys→urls presigned, date
  // dd/mm/yyyy, null→'' nos campos string que as telas exigem). `comments`
  // só vem populado no get (detail); o list não faz o join (inbox não usa).
  private async toDto(r: Report, comments: ReportComment[] = []) {
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
      comments: await Promise.all(comments.map((c) => this.commentToDto(c))),
    }
  }

  private async commentToDto(c: ReportComment) {
    return {
      id: c.id,
      authorName: c.authorName ?? '',
      authorAvatarUri: c.authorAvatarKey ? await this.media.presignGet(c.authorAvatarKey) : '',
      text: c.text,
      date: this.formatDate(c.createdAt),
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
