import { lockOrder, recomputeOrder } from './order-lock'

const tx = () =>
  ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    task: { findMany: jest.fn().mockResolvedValue([]) },
    workOrder: { update: jest.fn().mockResolvedValue({}) },
  }) as any

describe('order-lock (fonte única lock+recompute)', () => {
  it('lockOrder emite um SELECT ... FOR UPDATE no pai', async () => {
    const t = tx()
    await lockOrder(t, 'o1')
    expect(t.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('recomputeOrder grava o status derivado (todos os itens done → done)', async () => {
    const t = tx()
    t.task.findMany.mockResolvedValue([{ status: 'done' }, { status: 'done' }])
    await recomputeOrder(t, 'o1')
    expect(t.task.findMany).toHaveBeenCalledWith({ where: { orderId: 'o1' }, select: { status: true } })
    expect(t.workOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'done' } })
  })

  it('recomputeOrder: algum item não-pending → in_progress', async () => {
    const t = tx()
    t.task.findMany.mockResolvedValue([{ status: 'pending' }, { status: 'in_progress' }])
    await recomputeOrder(t, 'o1')
    expect(t.workOrder.update.mock.calls[0][0].data.status).toBe('in_progress')
  })

  it('recomputeOrder: sem itens → pending', async () => {
    const t = tx()
    t.task.findMany.mockResolvedValue([])
    await recomputeOrder(t, 'o1')
    expect(t.workOrder.update.mock.calls[0][0].data.status).toBe('pending')
  })
})
