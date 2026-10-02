import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { OperationalAlertStatus, Prisma, TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import type { JwtUser } from '../../auth/current-user.decorator'
import { parseAlertsIncludeDemo } from '../../config/runtime-env'
import { PrismaService } from '../../prisma/prisma.service'
import { URGENT_CONDITION_KINDS } from '../domain/telemetry.types'

// Fila de alertas operacionais do painel: leitura e triagem.
//
// O motor de condições cria o alerta junto com a condição e nunca mexe nele de
// novo: a condição recuperar NÃO resolve o alerta. Quem fecha a fila é sempre
// uma pessoa, e enquanto o alerta não é resolvido o motor não abre outro do
// mesmo funcionário e tipo. Por isso a leitura traz `condition.recoveredAt`: o
// painel mostra que o valor já normalizou, e a decisão de encerrar continua
// sendo de quem triou.
//
// Por padrão só origem REAL entra: em produção alerta de demonstração nunca é
// triado, e mostrá-lo misturaria demonstração com real na mesma fila. A
// homologação liga TELEMETRY_ALERTS_INCLUDE_DEMO para o roteiro de aceite ver o
// alerta que o injetor abre; cada item diz a própria origem, para o painel
// marcar a demonstração.

export type AlertCategory = 'URGENT' | 'HEALTH' | 'DEVICE'

const isUrgent = (kind: TelemetryConditionKind): boolean =>
  (URGENT_CONDITION_KINDS as readonly TelemetryConditionKind[]).includes(kind)

/**
 * Exaustiva por construção: tipo novo de condição não compila sem categoria.
 * Urgência derivada do conjunto do domínio, para fila, leitura atual e resumo
 * do painel nunca divergirem sobre o que urge.
 */
const CATEGORY: Readonly<Record<TelemetryConditionKind, AlertCategory>> = {
  HEART_RATE_HIGH: isUrgent('HEART_RATE_HIGH') ? 'URGENT' : 'HEALTH',
  HEART_RATE_LOW: isUrgent('HEART_RATE_LOW') ? 'URGENT' : 'HEALTH',
  BLOOD_PRESSURE_REVIEW: 'HEALTH',
  WEAR_HIGH: 'HEALTH',
  DEVICE_BATTERY_LOW: 'DEVICE',
  DEVICE_SIGNAL_LOST: 'DEVICE',
}

export const alertCategory = (kind: TelemetryConditionKind): AlertCategory => CATEGORY[kind]

export const UNRESOLVED_STATUSES: readonly OperationalAlertStatus[] = ['OPEN', 'ACKNOWLEDGED']

export const ALERT_QUEUE_DEFAULT_LIMIT = 50
export const ALERT_QUEUE_MAX_LIMIT = 100

export interface AlertQueueItem {
  id: string
  /** DEMO só aparece com a flag de homologação ligada. */
  origin: TelemetryOrigin
  status: OperationalAlertStatus
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  /** Quem reconheceu ou resolveu por último; null enquanto ninguém triou. */
  triagedBy: { id: string; name: string } | null
  worker: { id: string; name: string; sector: string | null }
  condition: {
    kind: TelemetryConditionKind
    category: AlertCategory
    observedValue: number | null
    thresholdValue: number | null
    openedAt: string
    /** Preenchido quando o valor já normalizou; o alerta continua até ser triado. */
    recoveredAt: string | null
  }
}

export interface AlertQueuePage {
  items: AlertQueueItem[]
  /** Id do último item; null quando não há próxima página. */
  nextCursor: string | null
}

export interface AlertQueueQuery {
  status?: OperationalAlertStatus[]
  limit?: number
  cursor?: string
}

const ALERT_INCLUDE = {
  triagedBy: { select: { id: true, name: true } },
  worker: { select: { id: true, name: true, profile: { select: { sector: true } } } },
  condition: {
    select: { kind: true, observedValue: true, thresholdValue: true, firstSeenAt: true, recoveredAt: true },
  },
} satisfies Prisma.OperationalAlertInclude

type AlertRow = Prisma.OperationalAlertGetPayload<{ include: typeof ALERT_INCLUDE }>

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

/** Lida a cada pedido: ligar ou desligar na homologação não exige rebuild. */
const visibleOrigins = (): TelemetryOrigin[] =>
  parseAlertsIncludeDemo(process.env) ? ['REAL', 'DEMO'] : ['REAL']

function toItem(row: AlertRow): AlertQueueItem {
  return {
    id: row.id,
    origin: row.origin,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: iso(row.acknowledgedAt),
    resolvedAt: iso(row.resolvedAt),
    resolutionNote: row.resolutionNote,
    triagedBy: row.triagedBy,
    worker: { id: row.worker.id, name: row.worker.name, sector: row.worker.profile?.sector ?? null },
    condition: {
      kind: row.condition.kind,
      category: alertCategory(row.condition.kind),
      observedValue: row.condition.observedValue,
      thresholdValue: row.condition.thresholdValue,
      openedAt: row.condition.firstSeenAt.toISOString(),
      recoveredAt: iso(row.condition.recoveredAt),
    },
  }
}

@Injectable()
export class AlertQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(admin: JwtUser, query: AlertQueueQuery): Promise<AlertQueuePage> {
    const companyId = this.companyOf(admin)
    const limit = Math.min(query.limit ?? ALERT_QUEUE_DEFAULT_LIMIT, ALERT_QUEUE_MAX_LIMIT)
    // Um a mais que o pedido: é ele que diz se existe próxima página, sem
    // uma contagem à parte.
    const rows = await this.prisma.operationalAlert.findMany({
      where: {
        origin: { in: visibleOrigins() },
        status: { in: query.status?.length ? query.status : [...UNRESOLVED_STATUSES] },
        worker: { companyId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: ALERT_INCLUDE,
    })
    const page = rows.slice(0, limit)
    return {
      items: page.map(toItem),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    }
  }

  /** Reconhecer = alguém está cuidando. Repetir devolve o estado como está. */
  async acknowledge(admin: JwtUser, id: string, now = new Date()): Promise<AlertQueueItem> {
    const current = await this.find(admin, id)
    if (current.status === 'ACKNOWLEDGED') return toItem(current)
    if (current.status !== 'OPEN') {
      throw new ConflictException('Alerta já encerrado não pode ser reconhecido')
    }
    // Transição condicional ao estado lido: dois administradores no mesmo
    // alerta não se sobrescrevem, e quem chega depois recebe o estado que ficou.
    await this.prisma.operationalAlert.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, triagedById: admin.userId },
    })
    const after = await this.find(admin, id)
    if (after.status === 'ACKNOWLEDGED') return toItem(after)
    throw new ConflictException('Alerta já encerrado não pode ser reconhecido')
  }

  /** Resolver encerra o alerta, de aberto ou reconhecido. Repetir não troca a nota. */
  async resolve(admin: JwtUser, id: string, note: string | undefined, now = new Date()): Promise<AlertQueueItem> {
    const current = await this.find(admin, id)
    if (current.status === 'RESOLVED') return toItem(current)
    if (!UNRESOLVED_STATUSES.includes(current.status)) {
      throw new ConflictException('Alerta dispensado não pode ser resolvido')
    }
    await this.prisma.operationalAlert.updateMany({
      where: { id, status: { in: [...UNRESOLVED_STATUSES] } },
      data: { status: 'RESOLVED', resolvedAt: now, triagedById: admin.userId, resolutionNote: note ?? null },
    })
    const after = await this.find(admin, id)
    if (after.status === 'RESOLVED') return toItem(after)
    throw new ConflictException('Alerta dispensado não pode ser resolvido')
  }

  /**
   * Alerta dentro da empresa e das origens visíveis. Fora do escopo responde
   * igual a inexistente, como no resto do backend.
   */
  private async find(admin: JwtUser, id: string): Promise<AlertRow> {
    const companyId = this.companyOf(admin)
    const row = await this.prisma.operationalAlert.findFirst({
      where: { id, origin: { in: visibleOrigins() }, worker: { companyId } },
      include: ALERT_INCLUDE,
    })
    if (row === null) throw new NotFoundException('Alerta não encontrado')
    return row
  }

  private companyOf(admin: JwtUser): string {
    if (admin.companyId === null) {
      throw new ForbiddenException('Administrador sem empresa não tem fila de alertas')
    }
    return admin.companyId
  }
}
