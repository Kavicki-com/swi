import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { MediaService } from '../media/media.service'
import { PositionHistoryService } from './position-history.service'
import type { Profile, User, WorkerPosition } from '@prisma/client'

/**
 * Posição de colega mais velha que isto não aparece no mapa do app: quem
 * fechou o app ou saiu do turno some do mapa em vez de ficar parado num ponto
 * onde já não está.
 */
export const COLLEAGUE_STALE_MS = 30 * 60 * 1000

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

// Última posição por worker. O service é agnóstico à FONTE do sinal: em
// produção o GPS do app mobile posta o heartbeat, e em dev o
// PositionSimulatorService chama o mesmo método.
@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly media: MediaService,
    private readonly history: PositionHistoryService,
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

    // A trilha do mapa de calor é secundária à posição ao vivo: uma falha ao
    // gravá-la fica no log e não derruba o heartbeat.
    try {
      await this.history.record(
        { id: worker.id, companyId: worker.companyId },
        lat,
        lng,
        source,
        pos.recordedAt,
      )
    } catch (error) {
      this.logger.warn(`Trilha de posição não gravada: ${(error as Error).message}`)
    }

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

  /**
   * Colegas no mapa do app: a última posição recente dos outros funcionários
   * ativos da mesma empresa, no mesmo formato de marcador do painel. Quem não
   * tem empresa não tem colega, e o balde sem empresa não é compartilhado.
   */
  async listColleagues(
    user: { userId: string; companyId: string | null },
    now: Date,
  ): Promise<PositionMarker[]> {
    if (user.companyId === null) return []
    const rows = await this.prisma.workerPosition.findMany({
      where: {
        workerId: { not: user.userId },
        recordedAt: { gte: new Date(now.getTime() - COLLEAGUE_STALE_MS) },
        worker: { role: 'WORKER', active: true, companyId: user.companyId },
      },
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
