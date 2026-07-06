import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { NotificationService } from '../notifications/notification.service'
import { Prisma } from '@prisma/client'
import type { Report } from '@prisma/client'
import type { CreateReportDto } from './dto'

const DEFAULT_LIMIT = 4
const MAX_LIMIT = 50

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  async list(page = 1, limit = DEFAULT_LIMIT) {
    const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const currentPage = Math.max(Math.trunc(page) || 1, 1)
    const skip = (currentPage - 1) * take
    // RepeatableRead: items + count read from the SAME snapshot (avoids "total 9 but page
    // empty" under concurrent create). Read-only tx → no serialization/write-skew risk.
    // Stable order needs a deterministic tiebreaker: createdAt is ms-precision, so ties at a
    // page boundary could duplicate/skip a row without id as secondary key.
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.report.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
        this.prisma.report.count(),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    const items = await Promise.all(rows.map((r) => this.toDto(r)))
    return { items, total }
  }

  async get(id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } })
    return r ? this.toDto(r) : null
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
