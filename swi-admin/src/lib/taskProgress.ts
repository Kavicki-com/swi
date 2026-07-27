// Progresso da tarefa POR TEMPO — espelho client-side de orderTimeProgressPct
// (swi-backend/src/work-orders/order-status.ts).
//
// O backend já manda o valor calculado, mas ele é um SNAPSHOT do instante do
// request: com um item em andamento o tempo continua correndo, e a barra ficaria
// parada até o próximo fetch. A tela recalcula em cima das mesmas âncoras a cada
// segundo, então as duas contas precisam bater exatamente.

export interface TimedItem {
  status: string
  startedAt: string | null
  accumulatedSeconds: number
  estimatedMinutes: number | null
}

/** Tempo total já gasto na tarefa, em segundos (bancado + item em curso). */
export function taskElapsedSeconds(items: TimedItem[], nowMs: number): number {
  return items.reduce((sum, it) => {
    const startedMs = it.startedAt ? Date.parse(it.startedAt) : NaN
    const running =
      it.status === 'in_progress' && !Number.isNaN(startedMs)
        ? Math.max(0, (nowMs - startedMs) / 1000)
        : 0
    return sum + it.accumulatedSeconds + running
  }, 0)
}

export function taskTimeProgressPct(
  items: TimedItem[],
  orderEstimatedMinutes: number | null | undefined,
  nowMs: number,
): number {
  if (items.length === 0) return 0
  const elapsedSec = taskElapsedSeconds(items, nowMs)
  const estimatedMin =
    orderEstimatedMinutes ?? items.reduce((sum, it) => sum + (it.estimatedMinutes ?? 0), 0)
  if (!estimatedMin || estimatedMin <= 0) return 0
  return Math.min(100, Math.round((elapsedSec / (estimatedMin * 60)) * 100))
}

/**
 * Duração em h:mm:ss — mesmo formato do cronômetro da jornada no app, pra quem
 * olha as duas telas ler o mesmo número do mesmo jeito. Os segundos existem de
 * propósito: são eles que tornam visível que o tempo está correndo.
 */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Há item correndo? Decide se a tela precisa do tick de 1s. */
export function hasRunningItem(items: TimedItem[]): boolean {
  return items.some((it) => it.status === 'in_progress' && Boolean(it.startedAt))
}
