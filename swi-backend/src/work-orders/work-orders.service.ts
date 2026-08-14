import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { NotificationService } from '../notifications/notification.service'
import { Prisma } from '@prisma/client'
import type { Profile, User, WorkOrderStatus } from '@prisma/client'
import { distributeMinutes, orderTimeProgressPct } from './order-status'
import { lockOrder, recomputeOrder } from './order-lock'
import type { CreateWorkOrderDto, UpdateWorkOrderDto } from './dto'

type Db = PrismaService | Prisma.TransactionClient
type UserWithProfile = User & { profile: Profile | null }

const LIST_CAP = 200

// Pai completo (autor+perfil, responsáveis+perfil, itens ordenados) — tudo que o
// DTO de detalhe/edição do admin precisa.
const detailInclude = {
  author: { include: { profile: true } },
  responsibles: { include: { profile: true }, orderBy: { name: 'asc' } },
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.WorkOrderInclude
type OrderDetail = Prisma.WorkOrderGetPayload<{ include: typeof detailInclude }>

// Só o necessário pra linha da lista: status dos itens (progressPct) + avatares.
const listInclude = {
  // Âncoras do timer: o progresso da ordem é POR TEMPO (decorrido ÷ estimado),
  // então a lista precisa das mesmas colunas que o detalhe.
  items: { select: { status: true, startedAt: true, accumulatedSeconds: true, estimatedMinutes: true } },
  responsibles: { include: { profile: true } },
} satisfies Prisma.WorkOrderInclude
type OrderRow = Prisma.WorkOrderGetPayload<{ include: typeof listInclude }>

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  async create(adminId: string, dto: CreateWorkOrderDto, companyId: string | null) {
    const ids = await this.validateResponsibles(this.prisma, dto.responsibleIds, companyId)
    // Decisão B: sem checklist explícito, cria 1 item automático (título=título
    // do pai, descrição=summary) — o worker precisa de ao menos um card.
    const items = dto.items?.length ? dto.items : [{ title: dto.title, description: dto.summary ?? '' }]
    const mins = distributeMinutes(dto.estimatedMinutes ?? null, items.length)
    const order = await this.prisma.workOrder.create({
      data: {
        authorId: adminId,
        title: dto.title,
        summary: dto.summary ?? null,
        details: dto.details ?? null,
        sector: dto.sector ?? null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        imageKeys: dto.imageKeys ?? [],
        responsibles: { connect: ids.map((id) => ({ id })) },
        items: {
          create: items.map((it, i) => ({
            title: it.title,
            description: it.description ?? null,
            position: i,
            estimatedMinutes: mins[i],
          })),
        },
      },
    })
    // status default = pending (todos os itens nascem pending) → um recompute
    // seria no-op na criação, então não é chamado.
    await this.notify(ids, order.id, order.title) // ids já deduplicados
    return this.detailById(order.id)
  }

  // Escopo por empresa: WorkOrder não tem companyId, a empresa é a do autor.
  async list(status: string | undefined, companyId: string | null) {
    const rows = await this.prisma.workOrder.findMany({
      where: {
        ...(status ? { status: status as WorkOrderStatus } : {}),
        author: { companyId },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_CAP,
      include: listInclude,
    })
    return Promise.all(rows.map((r) => this.toRowDto(r)))
  }

  async get(id: string, companyId: string | null) {
    const order = await this.prisma.workOrder.findUnique({ where: { id }, include: detailInclude })
    if (!order || order.author.companyId !== companyId) throw new NotFoundException('Tarefa não encontrada')
    return this.toDetailDto(order)
  }

  // Caminho interno de create/update: o id acabou de ser validado na mesma
  // operação, então não repete o check de empresa.
  private async detailById(id: string) {
    const order = await this.prisma.workOrder.findUnique({ where: { id }, include: detailInclude })
    if (!order) throw new NotFoundException('Tarefa não encontrada')
    return this.toDetailDto(order)
  }

  async update(id: string, dto: UpdateWorkOrderDto, companyId: string | null) {
    const { newlyAdded, title } = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id)
      const existing = await tx.workOrder.findUnique({
        where: { id },
        include: {
          items: { orderBy: { position: 'asc' } },
          responsibles: { select: { id: true } },
          author: { select: { companyId: true } },
        },
      })
      // Org-scoping: tarefa de outra empresa é invisível (404, não 403).
      if (!existing || existing.author.companyId !== companyId) throw new NotFoundException('Tarefa não encontrada')

      // ---- patch de escalares + responsáveis ----
      const data: Prisma.WorkOrderUpdateInput = {}
      if (dto.title !== undefined) data.title = dto.title
      if (dto.summary !== undefined) data.summary = dto.summary ?? null
      if (dto.details !== undefined) data.details = dto.details ?? null
      if (dto.sector !== undefined) data.sector = dto.sector ?? null
      if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes ?? null
      if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null
      if (dto.imageKeys !== undefined) data.imageKeys = dto.imageKeys

      let newlyAdded: string[] = []
      if (dto.responsibleIds !== undefined) {
        const ids = await this.validateResponsibles(tx, dto.responsibleIds, companyId)
        data.responsibles = { set: ids.map((rid) => ({ id: rid })) }
        const oldIds = new Set(existing.responsibles.map((r) => r.id))
        newlyAdded = ids.filter((rid) => !oldIds.has(rid))
      }

      // ---- reconciliação dos itens ----
      // finalItems = lista final ORDENADA; cada elemento casa com um item
      // existente (update) ou é novo (create). deletes = existentes fora do payload.
      let itemSetChanged = false
      let finalItems: { existingId: string | null; title: string; description: string | null }[]
      if (dto.items !== undefined) {
        const existingIds = new Set(existing.items.map((it) => it.id))
        const kept = new Set<string>()
        finalItems = dto.items.map((item) => {
          if (item.id) {
            if (!existingIds.has(item.id)) throw new BadRequestException('item inválido')
            // #6: id repetido no payload apagaria silenciosamente um irmão (o Set
            // dedup só conta 1 p/ o delete, mas o loop faria 2 updates no mesmo id).
            if (kept.has(item.id)) throw new BadRequestException('item duplicado')
            kept.add(item.id)
            return { existingId: item.id, title: item.title, description: item.description ?? null }
          }
          return { existingId: null, title: item.title, description: item.description ?? null }
        })
        if (finalItems.length === 0) throw new BadRequestException('a tarefa precisa de pelo menos 1 item')
        const deletes = existing.items.filter((it) => !kept.has(it.id))
        itemSetChanged = deletes.length > 0 || finalItems.some((f) => f.existingId === null)
        if (deletes.length) await tx.task.deleteMany({ where: { id: { in: deletes.map((d) => d.id) } } })
      } else {
        finalItems = existing.items.map((it) => ({ existingId: it.id, title: it.title, description: it.description }))
      }

      // Re-rateia quando a estimativa do pai mudou OU o conjunto de itens mudou.
      const estimatedChanged =
        dto.estimatedMinutes !== undefined && (dto.estimatedMinutes ?? null) !== existing.estimatedMinutes
      const totalEstimate =
        dto.estimatedMinutes !== undefined ? dto.estimatedMinutes ?? null : existing.estimatedMinutes
      const mins = estimatedChanged || itemSetChanged ? distributeMinutes(totalEstimate, finalItems.length) : null

      if (Object.keys(data).length) await tx.workOrder.update({ where: { id }, data })

      for (let i = 0; i < finalItems.length; i++) {
        const f = finalItems[i]
        if (f.existingId) {
          const itemData: Prisma.TaskUpdateInput = {}
          if (dto.items !== undefined) {
            itemData.title = f.title
            itemData.description = f.description
            itemData.position = i // normaliza 0..n-1 na ordem final
          }
          if (mins) itemData.estimatedMinutes = mins[i]
          if (Object.keys(itemData).length) await tx.task.update({ where: { id: f.existingId }, data: itemData })
        } else {
          await tx.task.create({
            data: { orderId: id, title: f.title, description: f.description, position: i, estimatedMinutes: mins ? mins[i] : null },
          })
        }
      }

      // Recompute só é relevante quando o CONJUNTO de itens muda: edições de
      // admin nunca tocam item.status; só add/delete pode virar o status do pai.
      if (itemSetChanged) await recomputeOrder(tx, id)
      return { newlyAdded, title: dto.title ?? existing.title }
    })

    // Best-effort, FORA da tx (derivado do write commitado): notifica só os
    // responsáveis recém-adicionados. Falha aqui não quebra o update.
    await this.notify(newlyAdded, id, title)
    return this.detailById(id)
  }

  async listAssignable(companyId: string | null) {
    // Espelha chat.listDirectory, mas SEM excluir ninguém (o admin pode atribuir
    // a qualquer worker aprovado DA SUA empresa).
    const users = await this.prisma.user.findMany({
      where: { role: 'WORKER', approvalStatus: 'APPROVED', companyId },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: LIST_CAP,
    })
    return Promise.all(users.map((u) => this.toWorkerDto(u)))
  }

  // Valida que TODOS os ids (deduplicados) são workers APROVADOS; devolve os ids
  // únicos. Usado no create e no update (com o client da tx).
  private async validateResponsibles(db: Db, responsibleIds: string[], companyId: string | null): Promise<string[]> {
    const ids = [...new Set(responsibleIds)]
    const found = await db.user.findMany({
      // Org-scoping: worker de outra empresa é inválido como responsável.
      where: { id: { in: ids }, role: 'WORKER', approvalStatus: 'APPROVED', companyId },
      select: { id: true },
    })
    if (found.length !== ids.length) throw new BadRequestException('responsável inválido')
    return ids
  }

  private async notify(workerIds: string[], orderId: string, title: string): Promise<void> {
    if (!workerIds.length) return
    try {
      await this.notifications.enqueueForMany(workerIds, {
        title: 'Nova tarefa atribuída',
        body: title,
        domain: 'journey',
        targetId: orderId,
      })
    } catch (e) {
      this.logger.warn(`enqueueForMany falhou (work order ${orderId}): ${String(e)}`)
    }
  }

  private async toRowDto(order: OrderRow) {
    // #5: index-parallel com responsibleCount — responsável sem avatarKey vira ''
    // (NÃO é filtrado), senão o count e o "+N" do overflow no AvatarGroup divergem.
    const responsibleAvatars = await Promise.all(
      order.responsibles.map((u) => (u.profile?.avatarKey ? this.media.presignGet(u.profile.avatarKey) : Promise.resolve(''))),
    )
    return {
      id: order.id,
      title: order.title,
      sector: order.sector ?? '',
      status: order.status,
      progressPct: orderTimeProgressPct(order.items, order.estimatedMinutes, Date.now()),
      responsibleCount: order.responsibles.length,
      responsibleAvatars,
    }
  }

  private async toDetailDto(order: OrderDetail) {
    const [authorAvatar, responsibles, images] = await Promise.all([
      order.author.profile?.avatarKey ? this.media.presignGet(order.author.profile.avatarKey) : Promise.resolve(''),
      Promise.all(order.responsibles.map((u) => this.toWorkerDto(u))),
      this.media.presignGetMany(order.imageKeys),
    ])
    return {
      id: order.id,
      title: order.title,
      summary: order.summary ?? '',
      details: order.details ?? '',
      sector: order.sector ?? '',
      estimatedMinutes: order.estimatedMinutes,
      startDate: order.startDate ? order.startDate.toISOString() : null,
      dueDate: order.dueDate ? order.dueDate.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
      progressPct: orderTimeProgressPct(order.items, order.estimatedMinutes, Date.now()),
      author: { name: order.author.profile?.fullName ?? order.author.name, avatar: authorAvatar },
      responsibles,
      items: order.items.map((it) => ({
        id: it.id,
        title: it.title,
        description: it.description ?? '',
        status: it.status,
        // Âncoras do timer: o painel recalcula o progresso a cada segundo em
        // cima delas, senão a barra fica congelada no valor do último request.
        startedAt: it.startedAt ? it.startedAt.toISOString() : null,
        accumulatedSeconds: it.accumulatedSeconds,
        estimatedMinutes: it.estimatedMinutes,
      })),
      images,
      // Keys cruas em par posicional com `images` (images[i] assina imageKeys[i]).
      // O PATCH substitui o array inteiro, então o cliente precisa das keys pra
      // reenviar as existentes ao editar anexos — a URL assinada não passa no
      // regex ^order/<uuid>.(jpg|png)$ do DTO.
      imageKeys: order.imageKeys,
    }
  }

  // Card de worker (responsável no detalhe + diretório de atribuíveis). Decisão
  // 2: SEM bloodType. birthDate em ISO (paridade com o Profile cru do wire).
  private async toWorkerDto(u: UserWithProfile) {
    return {
      id: u.id,
      name: u.profile?.fullName ?? u.name,
      jobTitle: u.profile?.jobTitle ?? '',
      sector: u.profile?.sector ?? '',
      birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
      avatar: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
    }
  }
}
