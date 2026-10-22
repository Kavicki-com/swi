import { Injectable, NotFoundException } from '@nestjs/common'
import type { TelemetryConditionKind, TelemetryConditionStatus, TelemetryOrigin } from '@prisma/client'
import type { JwtUser } from '../../auth/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import type { ConditionRecoveryReason } from '../domain/telemetry.types'
import { alertCategory, visibleOrigins, type AlertCategory } from './alert-queue.service'

// Histórico de condições de um funcionário, para o perfil no painel. A fila de
// alertas não serve de histórico: ela só tem as condições que viraram item, e
// perda de sinal, bateria e o episódio que não gerou alerta ficariam de fora.
// Aqui entra toda condição, aberta ou fechada, com o motivo de cada fechamento,
// para o gestor não confundir pulseira que parou de medir com valor que voltou.

export const CONDITION_HISTORY_PAGE = 50

export interface ConditionHistoryItem {
  id: string
  /** DEMO só aparece com a flag de homologação ligada, como na fila. */
  origin: TelemetryOrigin
  kind: TelemetryConditionKind
  category: AlertCategory
  status: TelemetryConditionStatus
  /** Instante em que a condição abriu (o medido, quando a medição chega depois). */
  openedAt: string
  recoveredAt: string | null
  /** Por que fechou; nulo enquanto aberta. */
  recoveryReason: ConditionRecoveryReason | null
  observedValue: number | null
  thresholdValue: number | null
}

export interface ConditionHistoryPage {
  items: ConditionHistoryItem[]
  /** Id do último item; null quando não há próxima página. */
  nextCursor: string | null
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

@Injectable()
export class ConditionHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(caller: JwtUser, workerId: string, cursor?: string): Promise<ConditionHistoryPage> {
    await this.requireWorker(caller, workerId)
    // Um a mais que a página: diz se há próxima sem contar à parte.
    const rows = await this.prisma.telemetryCondition.findMany({
      where: { workerId, origin: { in: visibleOrigins() } },
      select: {
        id: true,
        origin: true,
        kind: true,
        status: true,
        firstSeenAt: true,
        recoveredAt: true,
        recoveryReason: true,
        observedValue: true,
        thresholdValue: true,
      },
      orderBy: [{ firstSeenAt: 'desc' }, { id: 'desc' }],
      take: CONDITION_HISTORY_PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, CONDITION_HISTORY_PAGE)
    return {
      items: page.map((row) => ({
        id: row.id,
        origin: row.origin,
        kind: row.kind,
        category: alertCategory(row.kind),
        status: row.status,
        openedAt: row.firstSeenAt.toISOString(),
        recoveredAt: iso(row.recoveredAt),
        // Sem cast: o enum do Prisma e a união do domínio são o mesmo
        // vocabulário, e se um dia divergirem é aqui que o compilador reclama.
        recoveryReason: row.recoveryReason,
        observedValue: row.observedValue,
        thresholdValue: row.thresholdValue,
      })),
      nextCursor: rows.length > CONDITION_HISTORY_PAGE ? page[page.length - 1].id : null,
    }
  }

  /**
   * Só funcionário da mesma empresa. Inexistente, de outra empresa, quem chama
   * sem empresa e id que não é de funcionário respondem o mesmo 404, para não
   * revelar quem existe.
   */
  private async requireWorker(caller: JwtUser, workerId: string): Promise<void> {
    const user =
      caller.companyId === null
        ? null
        : await this.prisma.user.findUnique({ where: { id: workerId }, select: { companyId: true, role: true } })
    if (user === null || user.companyId !== caller.companyId || user.role !== 'WORKER') {
      throw new NotFoundException('Funcionário não encontrado')
    }
  }
}
