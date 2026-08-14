import { NotificationService } from './notification.service'
import { NotFoundException } from '@nestjs/common'

const realtime = () => ({ emitToUsers: jest.fn() }) as any
const queue = () => ({ enqueue: jest.fn(), registerWorker: jest.fn() }) as any
const prisma = () => ({
  notification: {
    findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  },
  user: { findUnique: jest.fn() },
}) as any

const W = 'worker-1'
const row = (over: any = {}) => ({
  id: 'n1', workerId: W, title: 'T', body: 'B', domain: 'chat',
  targetId: null, read: false, createdAt: new Date('2026-06-23T15:00:00Z'), ...over,
})

// O "Solicitar Pausa" do detalhe do funcionário vira notificação REAL pro
// worker, no domínio journey, com escopo por empresa.
describe('NotificationService.requestPause', () => {
  it('worker da mesma empresa → enfileira notificação de pausa', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: W, role: 'WORKER', companyId: 'org1' })
    const q = queue()
    const svc = new NotificationService(db, realtime(), q)
    const spy = jest.spyOn(svc, 'enqueueForMany').mockResolvedValue(undefined)
    await svc.requestPause(W, 'org1')
    expect(spy).toHaveBeenCalledWith([W], expect.objectContaining({
      domain: 'journey',
      title: 'Pausa solicitada',
      targetId: W,
    }))
  })

  it('worker de OUTRA empresa → NotFound sem enfileirar', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: W, role: 'WORKER', companyId: 'org2' })
    const svc = new NotificationService(db, realtime(), queue())
    const spy = jest.spyOn(svc, 'enqueueForMany')
    await expect(svc.requestPause(W, 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(spy).not.toHaveBeenCalled()
  })

  it('alvo inexistente ou não-worker → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new NotificationService(db, realtime(), queue()).requestPause('ghost', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    const db2 = prisma()
    db2.user.findUnique.mockResolvedValue({ id: 'a1', role: 'ADMIN', companyId: 'org1' })
    await expect(new NotificationService(db2, realtime(), queue()).requestPause('a1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('NotificationService', () => {
  it('list escopa no worker, ordena createdAt desc e mapeia dto', async () => {
    const db = prisma(); db.notification.findMany.mockResolvedValue([row()])
    const out = await new NotificationService(db, realtime(), queue()).list(W)
    expect(db.notification.findMany).toHaveBeenCalledWith({ where: { workerId: W }, orderBy: { createdAt: 'desc' }, take: 200 })
    expect(out[0]).toEqual({ id: 'n1', title: 'T', body: 'B', domain: 'chat', targetId: null, read: false, createdAt: '2026-06-23T15:00:00.000Z' })
  })

  it('list mapeia body null → ""', async () => {
    const db = prisma(); db.notification.findMany.mockResolvedValue([row({ body: null })])
    expect((await new NotificationService(db, realtime(), queue()).list(W))[0].body).toBe('')
  })

  it('markRead de outro worker → 404 sem update', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(row({ workerId: 'outro' }))
    await expect(new NotificationService(db, realtime(), queue()).markRead(W, 'n1')).rejects.toThrow(NotFoundException)
    expect(db.notification.update).not.toHaveBeenCalled()
  })

  it('markRead inexistente → 404', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(null)
    await expect(new NotificationService(db, realtime(), queue()).markRead(W, 'n1')).rejects.toThrow(NotFoundException)
  })

  it('markRead do dono seta read=true', async () => {
    const db = prisma(); db.notification.findUnique.mockResolvedValue(row())
    await new NotificationService(db, realtime(), queue()).markRead(W, 'n1')
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { read: true } })
  })

  it('markAllRead atualiza só as não-lidas do worker', async () => {
    const db = prisma(); db.notification.updateMany.mockResolvedValue({ count: 3 })
    await new NotificationService(db, realtime(), queue()).markAllRead(W)
    expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { workerId: W, read: false }, data: { read: true } })
  })

  it('createFor persiste e empurra ao vivo pro destinatário', async () => {
    const db = prisma(); db.notification.create.mockResolvedValue(row({ domain: 'reports', title: 'Novo relatório' }))
    const rt = realtime()
    const dto = await new NotificationService(db, rt, queue()).createFor(W, { domain: 'reports', title: 'Novo relatório', body: 'R1', targetId: 'r1' })
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ workerId: W, domain: 'reports', title: 'Novo relatório', body: 'R1', targetId: 'r1' })
    expect(rt.emitToUsers).toHaveBeenCalledWith([W], 'notification', dto)
  })

  it('createForMany faz broadcast pra cada worker', async () => {
    const db = prisma(); db.notification.create.mockResolvedValue(row())
    const rt = realtime()
    await new NotificationService(db, rt, queue()).createForMany(['a', 'b'], { domain: 'reports', title: 'X' })
    expect(db.notification.create).toHaveBeenCalledTimes(2)
    expect(rt.emitToUsers).toHaveBeenCalledTimes(2)
  })

  it('createForMany escopa cada notificação e emit ao seu worker', async () => {
    const db = prisma()
    db.notification.create
      .mockResolvedValueOnce(row({ id: 'na', workerId: 'a' }))
      .mockResolvedValueOnce(row({ id: 'nb', workerId: 'b' }))
    const rt = realtime()
    await new NotificationService(db, rt, queue()).createForMany(['a', 'b'], { domain: 'reports', title: 'X' })
    expect(db.notification.create.mock.calls[0][0].data.workerId).toBe('a')
    expect(db.notification.create.mock.calls[1][0].data.workerId).toBe('b')
    expect(rt.emitToUsers.mock.calls[0][0]).toEqual(['a'])
    expect(rt.emitToUsers.mock.calls[1][0]).toEqual(['b'])
  })

  it('createForMany([]) não cria nem emite', async () => {
    const db = prisma(); const rt = realtime()
    const out = await new NotificationService(db, rt, queue()).createForMany([], { domain: 'reports', title: 'X' })
    expect(out).toEqual([])
    expect(db.notification.create).not.toHaveBeenCalled()
    expect(rt.emitToUsers).not.toHaveBeenCalled()
  })

  it('createFor não rejeita se o emit falhar (persist já commitou)', async () => {
    const db = prisma(); db.notification.create.mockResolvedValue(row())
    const rt = { emitToUsers: jest.fn(() => { throw new Error('socket down') }) } as any
    await expect(new NotificationService(db, rt, queue()).createFor(W, { domain: 'chat', title: 'T' })).resolves.toMatchObject({ id: 'n1' })
  })

  it('enqueueForMany enfileira o job notifications.fanout', async () => {
    const db = prisma(); const rt = realtime()
    const q = { enqueue: jest.fn(), registerWorker: jest.fn() } as any
    const svc = new NotificationService(db, rt, q)
    const payload = { domain: 'reports', title: 'X' } as any
    await svc.enqueueForMany(['a', 'b'], payload)
    expect(q.enqueue).toHaveBeenCalledWith('notifications.fanout', { workerIds: ['a', 'b'], payload })
  })

  it('enqueueForMany([]) não enfileira job', async () => {
    const q = { enqueue: jest.fn(), registerWorker: jest.fn() } as any
    await new NotificationService(prisma(), realtime(), q).enqueueForMany([], { domain: 'reports', title: 'X' } as any)
    expect(q.enqueue).not.toHaveBeenCalled()
  })

  it('onModuleInit registra o worker fanout que chama createForMany', async () => {
    const q = { enqueue: jest.fn(), registerWorker: jest.fn() } as any
    const svc = new NotificationService(prisma(), realtime(), q)
    await svc.onModuleInit()
    const [name, handler] = q.registerWorker.mock.calls[0]
    expect(name).toBe('notifications.fanout')
    const spy = jest.spyOn(svc, 'createForMany').mockResolvedValue([])
    await handler({ workerIds: ['a', 'b'], payload: { domain: 'reports', title: 'X' } })
    expect(spy).toHaveBeenCalledWith(['a', 'b'], { domain: 'reports', title: 'X' })
  })
})
