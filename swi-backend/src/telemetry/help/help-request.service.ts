import { Injectable, Logger } from '@nestjs/common'
import type { OperationalAlertStatus, Prisma, RescueStatus } from '@prisma/client'
import { describeError } from '../../common/describe-error'
import { writeOnce } from '../../idempotency/write-once'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeGateway } from '../../realtime/realtime.gateway'
import { CONDITION_CHANGED_EVENT, type ConditionChange } from '../alerts/condition.service'
import { TelemetryHealthNotifier } from '../alerts/health-notifier'
import type { AdminHelpRequest } from '../read-model/telemetry-projector'
import { TelemetryAudienceService } from '../realtime/telemetry-audience.service'

// Pedido de ajuda do funcionário, pelo botão "Ajuda urgente" do app.
//
// Mora na fila de alertas que o painel já trata: o pedido é uma condição
// HELP_REQUESTED que nasce recuperada (não é medição e nunca pinta o estado de
// saúde) e um alerta urgente aberto. O alerta é a fonte do estado do pedido:
// OPEN é aberto, ACKNOWLEDGED é atendido (alguém reconheceu no painel ou
// despachou um socorrista) e RESOLVED ou DISMISSED é fechado.
//
// Não passa pelo motor de condições, e por isso a pausa dos alertas do
// funcionário não o cala: pedido de ajuda nunca é ruído.

/** Versão gravada em thresholdProfile: o pedido não tem régua, só origem. */
export const HELP_REQUEST_PROFILE = 'help-request-v1'

/** Aviso de socket a cada mudança de estado de um pedido. Só identificadores e estado. */
export const HELP_REQUEST_CHANGED_EVENT = 'help-request.changed'

/** Nota gravada no alerta quando o encerramento do resgate fecha o pedido. */
export const RESCUE_ENDED_NOTE = 'Resgate encerrado.'

export type HelpRequestStatus = 'OPEN' | 'ATTENDED' | 'CLOSED'

export interface HelpRequestChanged {
  workerId: string
  helpRequestId: string
  status: HelpRequestStatus
  /** ISO-8601 do relógio do servidor. */
  at: string
}

/** O pedido como o próprio funcionário o lê. */
export interface HelpRequestView {
  /** Id do alerta da fila: é o mesmo que o painel reconhece e resolve. */
  id: string
  status: HelpRequestStatus
  createdAt: string
  attendedAt: string | null
  closedAt: string | null
  /** O resgate despachado para este pedido; nulo enquanto ninguém foi despachado. */
  rescue: {
    id: string
    status: RescueStatus
    dispatchedAt: string
    arrivedAt: string | null
    /**
     * Última posição conhecida do socorrista, para o app estimar a chegada.
     * Nula sem posição gravada e depois que o resgate encerra.
     */
    rescuerPosition: { lat: number; lng: number; recordedAt: string } | null
  } | null
}


const UNRESOLVED: OperationalAlertStatus[] = ['OPEN', 'ACKNOWLEDGED']

export const helpStatusOf = (status: OperationalAlertStatus): HelpRequestStatus =>
  status === 'OPEN' ? 'OPEN' : status === 'ACKNOWLEDGED' ? 'ATTENDED' : 'CLOSED'

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

/**
 * Pedidos abertos ou atendidos, um por funcionário, para a lista do painel.
 * Função solta, e não método, para o read model ler sem depender do socket e
 * da notificação que o serviço usa.
 */
export async function openHelpRequestsOf(
  db: Pick<PrismaService, 'operationalAlert'>,
  workerIds: readonly string[],
): Promise<Map<string, AdminHelpRequest>> {
  if (workerIds.length === 0) return new Map()
  const rows = await db.operationalAlert.findMany({
    where: { workerId: { in: [...workerIds] }, status: { in: UNRESOLVED }, condition: { kind: 'HELP_REQUESTED' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workerId: true,
      status: true,
      createdAt: true,
      rescues: { where: { status: { not: 'ended' } }, orderBy: { startedAt: 'desc' }, take: 1, select: { id: true } },
    },
  })
  // Do mais velho ao mais novo: se houver mais de um, fica o mais novo.
  return new Map(
    rows.map((r) => [
      r.workerId,
      {
        id: r.id,
        status: r.status === 'OPEN' ? 'OPEN' : 'ATTENDED',
        createdAt: r.createdAt.toISOString(),
        rescueId: r.rescues[0]?.id ?? null,
      },
    ]),
  )
}

const openHelpWhere = (workerId: string): Prisma.OperationalAlertWhereInput => ({
  workerId,
  status: { in: UNRESOLVED },
  condition: { kind: 'HELP_REQUESTED' },
})

@Injectable()
export class HelpRequestService {
  private readonly logger = new Logger(HelpRequestService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audience: TelemetryAudienceService,
    private readonly healthNotifier: TelemetryHealthNotifier,
  ) {}

  /**
   * Abre o pedido, ou devolve o que já está aberto ou atendido: o toque duplo
   * e o reenvio da fila offline nunca viram dois alertas. Com Idempotency-Key,
   * o reenvio da mesma chave devolve o mesmo pedido mesmo depois de fechado.
   */
  async request(workerId: string, key: string | undefined, now = new Date()): Promise<HelpRequestView> {
    const create = (db: Prisma.TransactionClient) => this.openOrReuse(db, workerId, now)
    const opened = key
      ? (
          await writeOnce(this.prisma, {
            userId: workerId,
            key,
            scope: 'help.request',
            request: {},
            create: async (db) => {
              const result = await create(db)
              return { id: result.alertId, value: result }
            },
            replay: (alertId) => Promise.resolve({ alertId, conditionId: null }),
          })
        ).value
      : await this.prisma.$transaction(create)

    if (opened.conditionId !== null) await this.announceOpened(workerId, opened.alertId, opened.conditionId, now)
    const view = await this.viewOf(opened.alertId)
    if (view === null) throw new Error(`Pedido de ajuda ${opened.alertId} sumiu logo depois de gravado`)
    return view
  }

  /** O pedido mais recente do funcionário, em qualquer estado; nulo se nunca pediu. */
  async mine(workerId: string): Promise<HelpRequestView | null> {
    const latest = await this.prisma.operationalAlert.findFirst({
      where: { workerId, condition: { kind: 'HELP_REQUESTED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
    return latest === null ? null : this.viewOf(latest.id)
  }

  /**
   * Despacho de socorrista para o ferido: o pedido aberto dele passa a
   * atendido (ACKNOWLEDGED, por quem despachou). Devolve o id do pedido para o
   * resgate guardar o vínculo, ou nulo quando ele não tinha pedido aberto. O
   * pedido já atendido no painel só ganha o vínculo.
   */
  async attendByRescue(injuredId: string, dispatcherId: string, now = new Date()): Promise<string | null> {
    const open = await this.prisma.operationalAlert.findFirst({
      where: openHelpWhere(injuredId),
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    })
    if (open === null) return null
    if (open.status === 'OPEN') {
      const { count } = await this.prisma.operationalAlert.updateMany({
        where: { id: open.id, status: 'OPEN' },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, triagedById: dispatcherId },
      })
      if (count > 0) this.announceChanged(injuredId, open.id, 'ATTENDED', now)
    }
    return open.id
  }

  /** Encerramento do resgate: fecha (RESOLVED) o pedido que ele atendia, se ainda não fechado. */
  async closeByRescue(helpAlertId: string, closerId: string, now = new Date()): Promise<void> {
    const alert = await this.prisma.operationalAlert.findUnique({ where: { id: helpAlertId }, select: { workerId: true } })
    if (alert === null) return
    const { count } = await this.prisma.operationalAlert.updateMany({
      where: { id: helpAlertId, status: { in: UNRESOLVED } },
      data: { status: 'RESOLVED', resolvedAt: now, triagedById: closerId, resolutionNote: RESCUE_ENDED_NOTE },
    })
    if (count > 0) this.announceChanged(alert.workerId, helpAlertId, 'CLOSED', now)
  }

  /**
   * Avisa o funcionário e a equipe do painel da empresa dele. Nunca levanta: o
   * estado já está gravado, e quem perder o aviso relê pela API.
   */
  announceChanged(workerId: string, helpRequestId: string, status: HelpRequestStatus, now = new Date()): void {
    const payload: HelpRequestChanged = { workerId, helpRequestId, status, at: now.toISOString() }
    void this.audience
      .recipientsFor(workerId)
      .then((recipients) => this.realtime.emitToUsers(recipients, HELP_REQUEST_CHANGED_EVENT, payload))
      .catch((error: unknown) =>
        this.logger.warn(`Falha ao avisar o pedido de ajuda ${helpRequestId}: ${describeError(error)}`),
      )
  }

  private async openOrReuse(
    tx: Prisma.TransactionClient,
    workerId: string,
    now: Date,
  ): Promise<{ alertId: string; conditionId: string | null }> {
    // Dois toques ao mesmo tempo se enfileiram aqui, e o segundo encontra o
    // pedido que o primeiro abriu. $executeRaw porque a função devolve void.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`help:${workerId}`}))`
    const open = await tx.operationalAlert.findFirst({
      where: openHelpWhere(workerId),
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (open !== null) return { alertId: open.id, conditionId: null }

    const condition = await tx.telemetryCondition.create({
      data: {
        workerId,
        origin: 'REAL',
        kind: 'HELP_REQUESTED',
        status: 'RECOVERED',
        firstSeenAt: now,
        lastSeenAt: now,
        recoveredAt: now,
        thresholdProfile: HELP_REQUEST_PROFILE,
      },
      select: { id: true },
    })
    const alert = await tx.operationalAlert.create({
      data: { conditionId: condition.id, workerId, origin: 'REAL', status: 'OPEN', createdAt: now },
      select: { id: true },
    })
    return { alertId: alert.id, conditionId: condition.id }
  }

  /**
   * Depois do commit: o aviso de condição que o painel já escuta (fila de
   * urgentes, monitoramento, mapa), a notificação do sino para a equipe e o
   * aviso próprio do pedido.
   */
  private async announceOpened(workerId: string, alertId: string, conditionId: string, now: Date): Promise<void> {
    const change: ConditionChange = { workerId, conditionId, kind: 'HELP_REQUESTED', change: 'OPENED', at: now.toISOString() }
    try {
      const recipients = await this.audience.recipientsFor(workerId)
      this.realtime.emitToUsers(recipients, CONDITION_CHANGED_EVENT, change)
    } catch (error) {
      this.logger.warn(`Falha ao anunciar o pedido de ajuda ${alertId}: ${describeError(error)}`)
    }
    try {
      await this.healthNotifier.notifyOpened([change])
    } catch (error) {
      this.logger.warn(`Falha ao notificar o pedido de ajuda ${alertId}: ${describeError(error)}`)
    }
    this.announceChanged(workerId, alertId, 'OPEN', now)
  }

  private async viewOf(alertId: string): Promise<HelpRequestView | null> {
    const row = await this.prisma.operationalAlert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        updatedAt: true,
        rescues: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            arrivedAt: true,
            rescuer: { select: { position: { select: { lat: true, lng: true, recordedAt: true } } } },
          },
        },
      },
    })
    if (row === null) return null
    const status = helpStatusOf(row.status)
    const rescue = row.rescues[0] ?? null
    const position = rescue?.rescuer.position ?? null
    return {
      id: row.id,
      status,
      createdAt: row.createdAt.toISOString(),
      attendedAt: iso(row.acknowledgedAt),
      // DISMISSED não grava resolvedAt: aí vale a última mudança do alerta.
      closedAt: status === 'CLOSED' ? iso(row.resolvedAt ?? row.updatedAt) : null,
      rescue:
        rescue === null
          ? null
          : {
              id: rescue.id,
              status: rescue.status,
              dispatchedAt: rescue.startedAt.toISOString(),
              arrivedAt: iso(rescue.arrivedAt),
              rescuerPosition:
                rescue.status === 'ended' || position === null
                  ? null
                  : { lat: position.lat, lng: position.lng, recordedAt: position.recordedAt.toISOString() },
            },
    }
  }
}
