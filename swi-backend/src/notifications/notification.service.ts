import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { QueueService } from '../queue/queue.service'
import type { Notification, NotificationDomain } from '@prisma/client'

export interface NotificationPayload {
  title: string
  body?: string | null
  domain: NotificationDomain
  targetId?: string | null
}

const LIST_CAP = 200
const FANOUT_JOB = 'notifications.fanout'

// Contrato do job de fan-out: produtor (enqueue) e consumidor (handler) compartilham
// este tipo pra não driftar através do seam `any` do QueueService.
interface FanoutJobData {
  workerIds: string[]
  payload: NotificationPayload
}

@Injectable()
export class NotificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit() {
    await this.queue.registerWorker(FANOUT_JOB, async (data: FanoutJobData) => {
      await this.createForMany(data.workerIds, data.payload)
    })
  }

  // "Solicitar Pausa" real: notificação pro worker, com escopo por empresa.
  // Alvo de outra empresa, inexistente ou que não seja worker responde NotFound.
  async requestPause(workerId: string, adminCompanyId: string | null): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: workerId } })
    if (!target || target.role !== 'WORKER' || target.companyId !== adminCompanyId) {
      throw new NotFoundException('Funcionário não encontrado')
    }
    await this.enqueueForMany([workerId], {
      domain: 'journey',
      title: 'Pausa solicitada',
      body: 'A administração solicitou que você faça uma pausa.',
      targetId: workerId,
    })
  }

  async list(workerId: string) {
    const rows = await this.prisma.notification.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' }, take: LIST_CAP })
    return rows.map((n) => this.toDto(n))
  }

  async markRead(workerId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findUnique({ where: { id } })
    if (!n || n.workerId !== workerId) throw new NotFoundException('Notificação não encontrada')
    await this.prisma.notification.update({ where: { id }, data: { read: true } })
  }

  async markAllRead(workerId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { workerId, read: false }, data: { read: true } })
  }

  // Superfície injetável cross-domain: cria + empurra ao vivo pro destinatário.
  async createFor(workerId: string, payload: NotificationPayload) {
    const n = await this.prisma.notification.create({
      data: {
        workerId,
        title: payload.title,
        body: payload.body ?? null,
        domain: payload.domain,
        targetId: payload.targetId ?? null,
      },
    })
    const dto = this.toDto(n)
    // Push é derivado do write (que já commitou): uma falha de emit não pode
    // rejeitar a criação. Best-effort encapsulado na superfície injetável.
    try { this.realtime.emitToUsers([workerId], 'notification', dto) } catch { /* swallow */ }
    return dto
  }

  async createForMany(workerIds: string[], payload: NotificationPayload) {
    // allSettled: um destinatário ruim (ex.: FK de user removido concorrente) não
    // derruba o broadcast dos demais. Devolve só os dtos criados com sucesso.
    const results = await Promise.allSettled(workerIds.map((id) => this.createFor(id, payload)))
    return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  }

  // Enfileira o fan-out (job notifications.fanout) — o worker reusa createForMany.
  async enqueueForMany(workerIds: string[], payload: NotificationPayload): Promise<void> {
    if (workerIds.length === 0) return // evita job durável no-op + ciclo de poll no container
    const data: FanoutJobData = { workerIds, payload }
    await this.queue.enqueue(FANOUT_JOB, data)
  }

  private toDto(n: Notification) {
    return {
      id: n.id,
      title: n.title,
      body: n.body ?? '',
      domain: n.domain,
      targetId: n.targetId ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }
  }
}
