import { Prisma } from '@prisma/client'
import { orderStatus } from './order-status'

// Trava + recompute do WorkOrder pai — ÚNICA fonte da verdade, compartilhada
// pela jornada do worker (journey.service) e pelo update do admin
// (work-orders.service). Ambos precisam serializar transições concorrentes de
// itens e reprojetar o status derivado no pai.

// Trava pessimista na linha do pai — serializa transições concorrentes de itens
// (dois workers finalizando os 2 últimos itens não deixam o pai preso). Um pai
// inexistente casa 0 linhas (sem erro): quem chama valida a existência depois.
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${orderId} FOR UPDATE`
}

// Recomputa o status derivado do pai a partir dos status dos itens (função pura
// orderStatus). Roda DEPOIS de qualquer mutação nos itens, sob a trava.
export async function recomputeOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.task.findMany({ where: { orderId }, select: { status: true } })
  await tx.workOrder.update({ where: { id: orderId }, data: { status: orderStatus(items.map((i) => i.status)) } })
}
