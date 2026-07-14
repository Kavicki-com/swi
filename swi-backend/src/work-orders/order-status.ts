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

export function distributeMinutes(total: number | null | undefined, n: number): (number | null)[] {
  if (n <= 0) return []
  if (total == null) return Array<number | null>(n).fill(null)
  const base = Math.floor(total / n)
  const rest = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0))
}
