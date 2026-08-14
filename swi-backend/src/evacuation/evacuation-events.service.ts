import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { NotificationService } from '../notifications/notification.service'
import type { Evacuation } from '@prisma/client'

// Evacuação real. O admin dispara, os workers
// da org são notificados (fila durável) e confirmam presença (ack idempotente);
// o progresso X/N flui ao vivo por WS. UMA ativa por org por vez.
// A fonte do ack (app mobile ou simulador dev) é indiferente ao service —
// mesmo princípio do PositionsService.

export interface EvacuationWorkerEntry {
  id: string
  name: string
  acked: boolean
  ackAt: string | null
}

export interface EvacuationProgress {
  id: string
  status: 'ACTIVE' | 'ENDED'
  startedAt: string
  endedAt: string | null
  total: number
  acked: number
  workers: EvacuationWorkerEntry[]
}

@Injectable()
export class EvacuationEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationService,
  ) {}

  async start(adminId: string, companyId: string | null): Promise<EvacuationProgress> {
    const existing = await this.prisma.evacuation.findFirst({
      where: { companyId, status: 'ACTIVE' },
    })
    if (existing) throw new ConflictException('Já existe uma evacuação ativa')

    const evac = await this.prisma.evacuation.create({
      data: { companyId, startedById: adminId },
    })
    const workers = await this.orgWorkers(companyId)

    // Notificação REAL (fila durável, fora do request path) pra todos os
    // workers da org — o app mobile mostra e leva pra tela de evacuação.
    await this.notifications.enqueueForMany(
      workers.map((w) => w.id),
      {
        domain: 'evacuation',
        title: 'Evacuação iniciada',
        body: 'Dirija-se ao ponto de encontro e confirme sua presença.',
        targetId: evac.id,
      },
    )

    const dto = this.toProgress(evac, workers, [])
    await this.emitToOrg(companyId, workers, 'evacuation', dto)
    return dto
  }

  async ack(workerId: string, evacuationId: string): Promise<void> {
    const worker = await this.prisma.user.findUnique({ where: { id: workerId } })
    const evac = await this.prisma.evacuation.findUnique({ where: { id: evacuationId } })
    // Org errada e inexistente respondem igual (NotFound) — não vaza existência.
    if (!worker || !evac || evac.companyId !== worker.companyId) {
      throw new NotFoundException('Evacuação não encontrada')
    }
    if (evac.status !== 'ACTIVE') throw new ConflictException('Evacuação já encerrada')

    // Idempotente: re-confirmar não duplica nem atualiza o ackAt original.
    await this.prisma.evacuationAck.upsert({
      where: { evacuationId_workerId: { evacuationId, workerId } },
      create: { evacuationId, workerId },
      update: {},
    })

    const acks = await this.prisma.evacuationAck.findMany({
      where: { evacuationId },
      select: { workerId: true, ackAt: true },
    })
    const workers = await this.orgWorkers(evac.companyId)
    const admins = await this.orgAdmins(evac.companyId)
    try {
      this.realtime.emitToUsers(
        admins.map((a) => a.id),
        'evacuation-ack',
        { evacuationId, workerId, acked: acks.length, total: workers.length },
      )
    } catch {
      /* push é derivado do write — falha de emit não pode rejeitar o ack */
    }
  }

  async active(companyId: string | null): Promise<EvacuationProgress | null> {
    const evac = await this.prisma.evacuation.findFirst({
      where: { companyId, status: 'ACTIVE' },
    })
    if (!evac) return null
    const acks = await this.prisma.evacuationAck.findMany({
      where: { evacuationId: evac.id },
      select: { workerId: true, ackAt: true },
    })
    const workers = await this.orgWorkers(companyId)
    return this.toProgress(evac, workers, acks)
  }

  async end(companyId: string | null, evacuationId: string): Promise<void> {
    const evac = await this.prisma.evacuation.findUnique({ where: { id: evacuationId } })
    if (!evac || evac.companyId !== companyId) {
      throw new NotFoundException('Evacuação não encontrada')
    }
    await this.prisma.evacuation.update({
      where: { id: evacuationId },
      data: { status: 'ENDED', endedAt: new Date() },
    })
    const workers = await this.orgWorkers(companyId)
    await this.emitToOrg(companyId, workers, 'evacuation-ended', { id: evacuationId })
  }

  private orgWorkers(companyId: string | null) {
    return this.prisma.user.findMany({
      where: { role: 'WORKER', active: true, companyId },
      select: { id: true, name: true },
    })
  }

  private orgAdmins(companyId: string | null) {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN', companyId },
      select: { id: true },
    })
  }

  // Workers + admins da org — início e fim interessam aos dois lados.
  private async emitToOrg(
    companyId: string | null,
    workers: { id: string }[],
    event: string,
    payload: unknown,
  ): Promise<void> {
    const admins = await this.orgAdmins(companyId)
    try {
      this.realtime.emitToUsers(
        [...workers.map((w) => w.id), ...admins.map((a) => a.id)],
        event,
        payload,
      )
    } catch {
      /* best-effort: o estado já persistiu */
    }
  }

  private toProgress(
    evac: Evacuation,
    workers: { id: string; name: string }[],
    acks: { workerId: string; ackAt: Date }[],
  ): EvacuationProgress {
    const ackByWorker = new Map(acks.map((a) => [a.workerId, a.ackAt]))
    return {
      id: evac.id,
      status: evac.status,
      startedAt: evac.createdAt.toISOString(),
      endedAt: evac.endedAt?.toISOString() ?? null,
      total: workers.length,
      acked: acks.length,
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        acked: ackByWorker.has(w.id),
        ackAt: ackByWorker.get(w.id)?.toISOString() ?? null,
      })),
    }
  }
}
