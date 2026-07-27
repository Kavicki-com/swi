// Matemática PURA do WorkOrder — status derivado dos itens e rateio da
// estimativa do pai. Zero deps Nest/Prisma (espelha src/journey/time-anchors.ts).
export type ItemStatus = 'pending' | 'in_progress' | 'paused' | 'done'
export type OrderStatusValue = 'pending' | 'in_progress' | 'done'

export function orderStatus(items: ItemStatus[]): OrderStatusValue {
  if (items.length > 0 && items.every((s) => s === 'done')) return 'done'
  if (items.some((s) => s !== 'pending')) return 'in_progress'
  return 'pending'
}

export function orderProgressPct(items: ItemStatus[]): number {
  if (items.length === 0) return 0
  return Math.round((items.filter((s) => s === 'done').length / items.length) * 100)
}

/** Item com as âncoras de tempo que o app já mantém ao iniciar/pausar. */
export interface TimedItem {
  status: ItemStatus
  startedAt: Date | null
  accumulatedSeconds: number
  estimatedMinutes: number | null
}

/**
 * Progresso da tarefa POR TEMPO: tempo decorrido ÷ tempo estimado.
 *
 * O painel media progresso por itens concluídos do checklist, então uma tarefa
 * com um item só ficava em 0% durante a execução inteira e saltava pra 100% —
 * o oposto de "acompanhar o temporizador" (pedido do cliente, 2026-07-26). É a
 * mesma conta que o app faz por item; aqui agrega a ordem.
 *
 * Um item em andamento conta o tempo desde `startedAt` além do já bancado, e é
 * por isso que o valor anda sozinho entre dois requests — quem exibe precisa
 * re-render por segundo pra barra não parecer travada.
 */
export function orderTimeProgressPct(
  items: TimedItem[],
  orderEstimatedMinutes: number | null | undefined,
  nowMs: number,
): number {
  if (items.length === 0) return 0
  const elapsedSec = items.reduce((sum, it) => {
    const running = it.status === 'in_progress' && it.startedAt
      ? Math.max(0, (nowMs - it.startedAt.getTime()) / 1000)
      : 0
    return sum + it.accumulatedSeconds + running
  }, 0)
  // Estimativa do pai quando existe; senão soma a dos itens (o create rateia a
  // do pai entre eles, mas edições podem deixar só a dos filhos).
  const estimatedMin = orderEstimatedMinutes
    ?? items.reduce((sum, it) => sum + (it.estimatedMinutes ?? 0), 0)
  if (!estimatedMin || estimatedMin <= 0) return 0   // sem estimativa não há % honesto
  return Math.min(100, Math.round((elapsedSec / (estimatedMin * 60)) * 100))
}

export function distributeMinutes(total: number | null | undefined, n: number): (number | null)[] {
  if (n <= 0) return []
  if (total == null) return Array<number | null>(n).fill(null)
  const base = Math.floor(total / n)
  const rest = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0))
}
