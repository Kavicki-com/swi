import { QueueService } from './queue.service'

describe('QueueService (inline test-seam, NODE_ENV=test)', () => {
  it('enqueue roda o handler registrado inline (sem pg-boss)', async () => {
    const svc = new QueueService()
    const seen: any[] = []
    await svc.registerWorker('job.x', async (data) => { seen.push(data) })
    await svc.enqueue('job.x', { a: 1 })
    expect(seen).toEqual([{ a: 1 }])
  })
  it('enqueue sem handler registrado é no-op (não lança)', async () => {
    const svc = new QueueService()
    await expect(svc.enqueue('nada', { a: 1 })).resolves.toBeUndefined()
  })
})
