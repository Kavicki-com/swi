import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { MediaService } from '../media/media.service'
import { BACKFILL_MAX_AGE_MS, PositionHistoryService } from './position-history.service'
import type { TimedPoint } from './position-history'
import { CLOCK_SKEW_MS } from '../telemetry/domain/metric-state'
import { TelemetryQueryService } from '../telemetry/read-model/telemetry-query.service'
import type { HealthStatus } from '../telemetry/read-model/health-status'
import type { Profile, User, WorkerPosition } from '@prisma/client'
import { describeError } from '../common/describe-error'

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

/**
 * Colega no mapa do app: o marcador mais o estado de saúde. Só o estado sai do
 * servidor; nenhum número de saúde de um funcionário chega a outro.
 */
export interface ColleagueMarker extends PositionMarker {
  status: HealthStatus
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
    private readonly telemetry: TelemetryQueryService,
  ) {}

  // source: 'real' = GPS do app (default — o controller não precisa saber que
  // existe simulador); 'sim' = PositionSimulatorService. O simulador usa a
  // marca pra CEDER o pino a quem tem heartbeat real recente.
  async heartbeat(workerId: string, lat: number, lng: number, source: 'real' | 'sim' = 'real'): Promise<void> {
    const worker = await this.findWorker(workerId)

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
      this.logger.warn(`Trilha de posição não gravada: ${describeError(error)}`)
    }

    await this.pushToAdmins(worker, pos)
  }

  /**
   * Reenvio do que o app guardou enquanto não conseguia enviar. Cada ponto
   * entra na trilha com a hora em que foi medido. A última posição só avança
   * se o ponto mais novo do lote for mais recente que a gravada: o pino do
   * painel mostra onde a pessoa está agora e não volta no tempo.
   *
   * Ponto adiantado além da folga de relógio ou mais velho que a retenção é
   * ignorado, sem derrubar os demais. Ao contrário do heartbeat, a falha ao
   * gravar a trilha rejeita o pedido: o app mantém os pontos e tenta de novo,
   * e a repetição não duplica nada.
   */
  async backfill(
    workerId: string,
    points: readonly { lat: number; lng: number; recordedAt: string }[],
    now: Date,
  ): Promise<{ recorded: number; ignored: number }> {
    const worker = await this.findWorker(workerId)

    const earliest = now.getTime() - BACKFILL_MAX_AGE_MS
    const latest = now.getTime() + CLOCK_SKEW_MS
    const valid: TimedPoint[] = points
      .map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: new Date(p.recordedAt) }))
      .filter((p) => p.recordedAt.getTime() >= earliest && p.recordedAt.getTime() <= latest)
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    const ignored = points.length - valid.length
    if (valid.length === 0) return { recorded: 0, ignored }

    const recorded = await this.history.recordBackfill(
      { id: worker.id, companyId: worker.companyId },
      valid,
    )
    const pos = await this.advanceLastPosition(workerId, valid[valid.length - 1])
    if (pos) await this.pushToAdmins(worker, pos)
    return { recorded, ignored }
  }

  private async findWorker(workerId: string): Promise<WorkerWithProfile> {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      include: { profile: true },
    })
    if (!worker || worker.role !== 'WORKER') throw new NotFoundException('Worker não encontrado')
    return worker
  }

  /**
   * Avança a última posição para o ponto, se ele for mais novo que a gravada.
   * Devolve a posição nova, ou null quando a gravada fica.
   */
  private async advanceLastPosition(workerId: string, point: TimedPoint): Promise<WorkerPosition | null> {
    const data = { lat: point.lat, lng: point.lng, source: 'real', recordedAt: point.recordedAt }
    const current = await this.prisma.workerPosition.findUnique({ where: { workerId } })
    if (!current) {
      // upsert com update vazio: um heartbeat que crie a linha entre a leitura
      // e esta escrita é mais novo que qualquer ponto reenviado e fica.
      const row = await this.prisma.workerPosition.upsert({
        where: { workerId },
        create: { workerId, ...data },
        update: {},
      })
      return row.recordedAt.getTime() === point.recordedAt.getTime() ? row : null
    }
    if (current.recordedAt.getTime() >= point.recordedAt.getTime()) return null
    // A guarda de hora repete a comparação dentro da escrita, pelo mesmo motivo.
    const { count } = await this.prisma.workerPosition.updateMany({
      where: { workerId, recordedAt: { lt: point.recordedAt } },
      data,
    })
    return count === 0 ? null : { ...current, ...data }
  }

  // Push é derivado do write (que já commitou): falha de emit não pode
  // rejeitar quem gravou. Só os admins da MESMA empresa recebem (org-scoping;
  // companyId null = balde legado, null só casa com null).
  private async pushToAdmins(worker: WorkerWithProfile, pos: WorkerPosition): Promise<void> {
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
   * ativos da mesma empresa, no mesmo formato de marcador do painel, mais o
   * estado de saúde de cada um. Quem não tem empresa não tem colega, e o balde
   * sem empresa não é compartilhado.
   */
  async listColleagues(
    user: { userId: string; companyId: string | null },
    now: Date,
  ): Promise<ColleagueMarker[]> {
    if (user.companyId === null) return []
    const rows = await this.prisma.workerPosition.findMany({
      where: {
        workerId: { not: user.userId },
        recordedAt: { gte: new Date(now.getTime() - COLLEAGUE_STALE_MS) },
        worker: { role: 'WORKER', active: true, companyId: user.companyId },
      },
      include: { worker: { include: { profile: true } } },
    })
    if (rows.length === 0) return []

    // A posição é o que o mapa mostra; o estado é complemento. Falha ao lê-lo
    // fica no log e os colegas saem sem estado, que a tela pinta como sem
    // leitura, nunca como "bom".
    let statuses = new Map<string, HealthStatus>()
    try {
      statuses = await this.telemetry.healthStatusOfWorkers(
        rows.map((r) => r.workerId),
        now,
      )
    } catch (error) {
      this.logger.warn(`Estado de saúde dos colegas não lido: ${describeError(error)}`)
    }
    return Promise.all(
      rows.map(async (r: WorkerPosition & { worker: WorkerWithProfile }) => ({
        ...(await this.toMarker(r.worker, r)),
        status: statuses.get(r.workerId) ?? 'unknown',
      })),
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
