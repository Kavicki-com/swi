import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import type { Report } from '@prisma/client'
import type { CreateReportDto } from './dto'

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list() {
    const rows = await this.prisma.report.findMany({ orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.map((r) => this.toDto(r)))
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
