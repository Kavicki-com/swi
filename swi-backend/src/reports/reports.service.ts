import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { NotificationService } from '../notifications/notification.service'
import type { Comment, Profile, Report, ReportStatus, User } from '@prisma/client'
import type { CreateCommentDto, CreateReportDto, UpdateReportDto } from './dto'
import { isStaffJobTitle } from '../common/staff'

const LIST_CAP = 200

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  // Escopo por empresa: Report não tem companyId, a empresa é a do autor.
  //
  // Devolve `{ items, total }`. O cap de 200 vale por segurança, e o TOTAL vai
  // junto pra UI poder dizer quantos ficaram de fora, senão o que passa do cap
  // some em silêncio na tela. O controller achata em array mais header, então o
  // contrato do wire, e o mobile, não mudam.
  /**
   * Quem pode ser atribuído como responsável por um relatório.
   *
   * Não serve pedir isso ao /chat/directory, que devolve a empresa INTEIRA de
   * propósito, porque sem os admins ali o worker não consegue iniciar conversa
   * com o painel. Usá-lo aqui ofereceria todos os operadores como revisores.
   * São perguntas diferentes: "com quem posso falar" e "quem revisa meu
   * relatório".
   *
   * Fica aqui, e não em chat, porque a régua é de relatórios — e porque o
   * painel tem o seletor dele (ResponsablesModal, hoje via adminsApi) e
   * precisa convergir pra mesma fonte.
   *
   * Acessível ao worker: /users é @Roles('ADMIN'), e foi essa barreira que
   * empurrou o app pro diretório de chat em primeiro lugar.
   */
  async listAssignees(userId: string, companyId: string | null) {
    const users = await this.prisma.user.findMany({
      where: { approvalStatus: 'APPROVED', id: { not: userId }, companyId },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: LIST_CAP,
    })
    // Filtro em JS, não no Prisma: a régua é sobre TEXTO LIVRE acentuado
    // (jobTitle), e um `contains` do Postgres não normaliza acento nem caixa
    // sem extensão. O cap de 200 mantém isso barato.
    const staff = users.filter((u) => u.role === 'ADMIN' || isStaffJobTitle(u.profile?.jobTitle))
    return Promise.all(staff.map((u) => this.toAssignee(u)))
  }

  // Mesmo shape do contato do chat — o modal do app já consome esse formato
  // (avatar presigned, idade derivada do birthDate, tipo sanguíneo). Mantidos
  // em sincronia à mão: são dois módulos, e unificar exigiria mexer no chat,
  // que está estável.
  private async toAssignee(u: User & { profile: Profile | null }) {
    return {
      workerId: u.id,
      name: u.profile?.fullName ?? u.name,
      sector: u.profile?.sector ?? '',
      role: u.profile?.jobTitle ?? '',
      avatarUri: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
      birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
      bloodType: u.profile?.bloodType ?? null,
      allergies: u.profile?.allergies ?? null,
      gender: u.profile?.gender ?? null,
    }
  }

  async list(companyId: string | null, page?: { limit?: number; offset?: number }) {
    const where = { author: { companyId } }
    const take = Math.min(Math.max(page?.limit ?? LIST_CAP, 1), LIST_CAP)
    const skip = Math.max(page?.offset ?? 0, 0)
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.report.count({ where }),
    ])
    return { items: await Promise.all(rows.map((r) => this.toDto(r))), total }
  }

  async get(id: string, companyId: string | null) {
    const r = await this.prisma.report.findUnique({
      where: { id },
      include: {
        author: { select: { companyId: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { include: { profile: true } } },
        },
      },
    })
    if (!r || r.author.companyId !== companyId) return null
    const comments = await Promise.all(r.comments.map((c) => this.toCommentDto(c, c.author)))
    const dto = await this.toDto(r)
    // Fotos reais das equipes por atividade. O desenho pede um grupo de
    // avatares em cada linha, e eles têm que ser das pessoas de verdade, nunca
    // decorativos. Só no detalhe: a lista não renderiza atividades e não paga
    // a query.
    return { ...dto, activities: await this.resolveActivityAvatars(dto.activities), comments }
  }

  /**
   * `responsibleNames` de cada atividade → `responsibleAvatars` presigned, na
   * MESMA ordem ('' sem match — nunca a foto de outra pessoa). Uma única
   * passada do avatarsForNames sobre os nomes únicos de TODAS as atividades.
   */
  private async resolveActivityAvatars(activities: unknown): Promise<unknown[]> {
    const acts = Array.isArray(activities)
      ? (activities as Array<{ responsibleNames?: string[] }>)
      : []
    const allNames = [...new Set(acts.flatMap((a) => a.responsibleNames ?? []))]
    if (allNames.length === 0) return acts
    const urls = await this.avatarsForNames(allNames)
    const byName = new Map(allNames.map((n, i) => [n, urls[i] ?? '']))
    return acts.map((a) => ({
      ...a,
      responsibleAvatars: (a.responsibleNames ?? []).map((n) => byName.get(n) ?? ''),
    }))
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
        // Broadcast restrito à empresa do autor — inbox é org-wide, não global.
        where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: authorId }, companyId: author?.companyId ?? null },
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

  /**
   * Anexos na edição: o form manda o array completo, mas o array que ele viu
   * pode estar VELHO (outra pessoa anexou entre o load e o save). Por isso o
   * cliente manda também o `imageKeysBase`, o snapshot que carregou, e aqui:
   *  - o que existe no banco fora do base chegou DEPOIS do load: o form nunca
   *    o viu e não pode removê-lo, então é preservado no array final;
   *  - só sai do bucket a remoção PROVADA (estava no base e saiu do payload).
   * Sem base não há prova: o array substitui como sempre (contrato antigo) e
   * nada é apagado do bucket, porque destruir evidência de campo é pior que
   * vazar storage. Diff e write na MESMA transação, senão um write concorrente
   * entre a leitura e o update deixaria o banco citando objeto apagado.
   */
  async update(id: string, _userId: string, dto: UpdateReportDto, companyId: string | null) {
    try {
      const { r, removidos } = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.report.findUnique({
          where: { id },
          select: { id: true, imageKeys: true, author: { select: { companyId: true } } },
        })
        if (!existing || existing.author.companyId !== companyId) throw new NotFoundException('Relatório não encontrado')

        let imageKeys = dto.imageKeys
        let removidos: string[] = []
        if (dto.imageKeys !== undefined && dto.imageKeysBase !== undefined) {
          const base = new Set(dto.imageKeysBase)
          const want = new Set(dto.imageKeys)
          const chegaramDepois = existing.imageKeys.filter((k) => !base.has(k) && !want.has(k))
          imageKeys = [...dto.imageKeys, ...chegaramDepois]
          removidos = existing.imageKeys.filter((k) => base.has(k) && !want.has(k))
        }

        const r = await tx.report.update({
          where: { id },
          data: {
            ...(dto.title !== undefined && { title: dto.title }),
            ...(dto.summary !== undefined && { summary: dto.summary }),
            ...(dto.details !== undefined && { details: dto.details }),
            ...(dto.responsibles !== undefined && { responsibles: dto.responsibles }),
            ...(dto.status !== undefined && { status: dto.status as ReportStatus }),
            ...(dto.statusLabel !== undefined && { statusLabel: dto.statusLabel }),
            ...(imageKeys !== undefined && { imageKeys }),
          },
        })
        return { r, removidos }
      })
      // Depois do commit e best-effort: falha do bucket não desfaz uma edição
      // que já aconteceu, e um rollback não pode ter apagado anexo de relatório
      // intacto.
      if (removidos.length) await this.media.deleteObjects(removidos)
      return this.toDto(r)
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') throw new NotFoundException('Relatório não encontrado')
      throw e
    }
  }

  /**
   * Exclusão de relatório. Os comentários vão junto por cascade declarado no
   * schema (Comment.report onDelete: Cascade), e os anexos saem do bucket
   * depois do commit.
   *
   * A régua aqui é mais apertada que a do update, que é apenas org-scoped:
   * editar é reversível, apagar não, e o relatório é o registro de segurança do
   * trabalho. Por isso só o AUTOR ou um ADMIN da mesma empresa exclui. Fora da
   * empresa responde 404, nunca 403, para não confirmar que o id existe.
   */
  async remove(id: string, userId: string, role: string, companyId: string | null) {
    const existing = await this.prisma.report.findUnique({
      where: { id },
      select: { id: true, authorId: true, imageKeys: true, author: { select: { companyId: true } } },
    })
    if (!existing || existing.author.companyId !== companyId) throw new NotFoundException('Relatório não encontrado')
    if (role !== 'ADMIN' && existing.authorId !== userId) {
      throw new ForbiddenException('Apenas o autor ou um administrador pode excluir o relatório')
    }
    try {
      await this.prisma.report.delete({ where: { id } })
    } catch (e) {
      // Corrida entre dois admins: sem esta tradução o segundo levaria 500 por
      // ter apenas chegado tarde a uma exclusão que já aconteceu.
      if ((e as { code?: string }).code === 'P2025') throw new NotFoundException('Relatório não encontrado')
      throw e
    }
    // Depois do commit e best-effort: o registro já não existe, e falha de
    // bucket não pode transformar uma exclusão bem-sucedida em erro.
    await this.media.deleteObjects(existing.imageKeys)
  }

  async addComment(reportId: string, authorId: string, dto: CreateCommentDto) {
    const exists = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, author: { select: { companyId: true } } },
    })
    if (!exists) throw new NotFoundException('Relatório não encontrado')
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
    // Comentar exige pertencer à mesma empresa do relatório (org-scoping).
    if (exists.author.companyId !== (author?.companyId ?? null)) throw new NotFoundException('Relatório não encontrado')
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
      // Foto REAL de cada responsável, resolvida pelo nome, já que o campo é um
      // snapshot denormalizado de nomes. Sem isso o painel exibiria rostos
      // decorativos que não são das pessoas listadas. Sem correspondência o
      // valor vai vazio e a UI cai no placeholder, que é honesto.
      responsibleAvatars: await this.avatarsForNames(r.responsibles),
      details: r.details ?? '',
      images: await this.media.presignGetMany(r.imageKeys),
      imageKeys: r.imageKeys, // keys crus (não-presigned) pro form de edição preservar/mesclar anexos
      activities: (r.activities as unknown) ?? [],
    }
  }

  /**
   * Nomes de responsáveis → URLs presigned dos avatares, na MESMA ordem.
   * Uma consulta só (`fullName in [...]`); quem não estiver no diretório (ou
   * não tiver foto) recebe ''. Lista vazia não vai ao banco.
   */
  private async avatarsForNames(names: string[]): Promise<string[]> {
    if (names.length === 0) return []
    const profiles = await this.prisma.profile.findMany({
      where: { fullName: { in: names } },
      select: { fullName: true, avatarKey: true },
    })
    const keyByName = new Map(profiles.map((p) => [p.fullName, p.avatarKey]))
    return Promise.all(
      names.map(async (n) => {
        const key = keyByName.get(n)
        return key ? this.media.presignGet(key) : ''
      }),
    )
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
