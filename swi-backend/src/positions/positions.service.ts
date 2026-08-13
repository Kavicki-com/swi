import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { MediaService } from '../media/media.service'
import type { Profile, User, WorkerPosition } from '@prisma/client'

// Marker consumido pelos mapas do admin (Dashboard/Mapas/Detalhe). O shape
// espelha o DashboardMapMarker do site menos o que é derivado lá (status).
export interface PositionMarker {
  id: string
  name: string
  lat: number
  lng: number
  sector: string | null
  avatar: string
  recordedAt: string
}

type WorkerWithProfile = User & { profile: Profile | null }

// Fase 1 do realtime de localização (2026-07-24): última posição por worker.
// O service é agnóstico à FONTE do sinal — em produção o GPS do app mobile
// posta o heartbeat; em dev o PositionSimulatorService chama o mesmo método.
@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly media: MediaService,
  ) {}

  // source: 'real' = GPS do app (default — o controller não precisa saber que
  // existe simulador); 'sim' = PositionSimulatorService. O simulador usa a
  // marca pra CEDER o pino a quem tem heartbeat real recente.
  async heartbeat(workerId: string, lat: number, lng: number, source: 'real' | 'sim' = 'real'): Promise<void> {
    const worker = (await this.prisma.user.findUnique({
      where: { id: workerId },
      include: { profile: true },
    }))
    if (!worker || worker.role !== 'WORKER') throw new NotFoundException('Worker não encontrado')

    const pos = await this.prisma.workerPosition.upsert({
      where: { workerId },
      create: { workerId, lat, lng, source },
      // @updatedAt não cobre recordedAt — renova explícito no update.
      update: { lat, lng, source, recordedAt: new Date() },
    })

    // Push é derivado do write (que já commitou): falha de emit não pode
    // rejeitar o heartbeat. Só os admins da MESMA empresa recebem (org-scoping;
    // companyId null = balde legado, null só casa com null).
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', companyId: worker.companyId },
      select: { id: true },
    })
    const marker = await this.toMarker(worker, pos)
    try {
      this.realtime.emitToUsers(admins.map((a) => a.id), 'position', marker)
    } catch {
      /* swallow */
    }
  }

  async listForCompany(companyId: string | null): Promise<PositionMarker[]> {
    const rows = await this.prisma.workerPosition.findMany({
      where: { worker: { role: 'WORKER', active: true, companyId } },
      include: { worker: { include: { profile: true } } },
    })
    return Promise.all(
      rows.map((r: WorkerPosition & { worker: WorkerWithProfile }) => this.toMarker(r.worker, r)),
    )
  }

  private async toMarker(worker: WorkerWithProfile, pos: WorkerPosition): Promise<PositionMarker> {
    return {
      id: worker.id,
      name: worker.name,
      lat: pos.lat,
      lng: pos.lng,
      sector: worker.profile?.sector ?? null,
      avatar: worker.profile?.avatarKey ? await this.media.presignGet(worker.profile.avatarKey) : '',
      recordedAt: pos.recordedAt.toISOString(),
    }
  }
}
