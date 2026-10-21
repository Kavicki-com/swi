import type { PrismaClient } from '@prisma/client'
import { UNRESOLVED_STATUSES } from '../alerts/alert-queue.service'

// Aposentadoria da revisão de pressão (perfil swi-alert-calibrated-3). Com a
// calibração individual, a pressão REAL passa a abrir pela faixa de fadiga da
// pessoa e pela trava de 180/110; a revisão para de abrir e fica no enum só
// para o histórico. As que ficaram abertas no deploy fecham aqui, com motivo
// próprio, e não pela migration: valor novo de enum não pode ser usado na
// mesma transação em que nasce. A DEMO segue o perfil v2 e não é tocada.

export const RETIRED_PRESSURE_REVIEW_NOTE = 'Regra de pressão substituída pela calibração individual'

export interface RetireResult {
  conditions: number
  alerts: number
}

/** Fecha as revisões de pressão REAIS ativas e resolve o alerta da fila de cada uma. Idempotente. */
export async function retireBloodPressureReview(prisma: PrismaClient, now: Date): Promise<RetireResult> {
  return prisma.$transaction(async (tx) => {
    const active = await tx.telemetryCondition.findMany({
      where: { kind: 'BLOOD_PRESSURE_REVIEW', origin: 'REAL', status: 'ACTIVE' },
      select: { id: true },
    })
    const ids = active.map((row) => row.id)
    if (ids.length === 0) return { conditions: 0, alerts: 0 }

    // lastSeenAt fica como está: nenhuma avaliação cobriu a condição agora.
    const conditions = await tx.telemetryCondition.updateMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'PROFILE_RETIRED' },
    })
    // Alerta reconhecido também fecha: a regra que o abriu deixou de existir,
    // e ele ficaria pendurado na fila sem condição ativa por trás.
    const alerts = await tx.operationalAlert.updateMany({
      where: { conditionId: { in: ids }, status: { in: [...UNRESOLVED_STATUSES] } },
      data: { status: 'RESOLVED', resolvedAt: now, resolutionNote: RETIRED_PRESSURE_REVIEW_NOTE },
    })
    return { conditions: conditions.count, alerts: alerts.count }
  })
}
