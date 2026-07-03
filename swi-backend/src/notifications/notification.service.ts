import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import type { Notification, NotificationDomain } from '@prisma/client'

export interface NotificationPayload {
  title: string
  body?: string | null
  domain: NotificationDomain
  targetId?: string | null
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(workerId: string) {
    const rows = await this.prisma.notification.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' } })
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
