import { JourneyService } from './journey.service'

const media = () => ({
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
}) as any

const prisma = () => {
  const db: any = {
    journey: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    task: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  }
  db.$transaction = jest.fn(async (cb: any) => cb(db))
  return db
}

const taskRow = (over = {}) => ({
  id: 't1', assignedTo: 'u1', title: 'Inspeção', description: 'd', objective: 'o',
  estimatedMinutes: 120, status: 'pending', startedAt: null, accumulatedSeconds: 0,
  progressPct: 0, scheduledDate: new Date('2026-07-02'), imageKeys: ['task/a.jpg'],
  interestedCount: 18, interestedAvatarKeys: ['interested/worker-1.png'], ...over,
})
const journeyRow = (over = {}) => ({
  id: 'j1', workerId: 'u1', date: new Date('2026-07-02'), state: 'idle',
  activeTaskId: null, startedAt: null, accumulatedSeconds: 0, ...over,
})

describe('JourneyService', () => {
  it('getJourney faz get-or-create do turno de hoje e devolve o shape mobile', async () => {
    const db = prisma(); db.journey.upsert.mockResolvedValue(journeyRow())
    const out = await new JourneyService(db, media()).getJourney('u1')
    expect(db.journey.upsert).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 })
  })

  it('listTasks escopa em assignedTo + hoje e presigna imagens/avatares', async () => {
    const db = prisma(); db.task.findMany.mockResolvedValue([taskRow()])
    const out = await new JourneyService(db, media()).listTasks('u1')
    const where = db.task.findMany.mock.calls[0][0].where
    expect(where.assignedTo).toBe('u1')
    expect(where.scheduledDate).toBeInstanceOf(Date)
    expect(out[0].images).toEqual(['signed:task/a.jpg'])
    expect(out[0].interestedAvatars).toEqual(['signed:interested/worker-1.png'])
    expect(out[0].scheduledDate).toBe('2026-07-02')
    expect(out[0].description).toBe('d')
  })

  it('getTask de outro worker (findFirst null) → null', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    expect(await new JourneyService(db, media()).getTask('u1', 'alheia')).toBeNull()
  })

  it('startTask liga a task + o turno e devolve os dois', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).startTask('u1', 't1')
    expect(out.task.status).toBe('in_progress')
    expect(typeof out.task.startedAt).toBe('string')     // ISO
    expect(out.journey.state).toBe('ongoing')
    expect(out.journey.activeTaskId).toBe('t1')
  })

  it('startTask de task inexistente → NotFound', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    await expect(new JourneyService(db, media()).startTask('u1', 'nope')).rejects.toThrow(/não encontrada/i)
  })

  it('startTask roda os 2 writes dentro de uma única transação', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).startTask('u1', 't1')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('startTask: falha no 2º write (journey.update) propaga — não engole', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockRejectedValue(new Error('db down no 2º write'))
    await expect(new JourneyService(db, media()).startTask('u1', 't1')).rejects.toThrow(/db down/)
  })

  it('endJourney zera o turno (idle, 0s) e marca a task done', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 100 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).endJourney('u1')
    expect(out.state).toBe('idle')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(out.activeTaskId).toBeNull()
    expect(out.accumulatedSeconds).toBe(0)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('done')
  })

  it('pauseJourney banca o tempo da task ativa e grava o snapshot de progresso', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 30 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 10 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).pauseJourney('u1')
    expect(out.state).toBe('paused')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('paused')
    expect(db.task.update.mock.calls[0][0].data.progressPct).toBeGreaterThanOrEqual(0)
  })

  it('resumeJourney retoma a task ativa (in_progress) e o turno (ongoing)', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'paused', activeTaskId: 't1', startedAt: null, accumulatedSeconds: 40 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'paused', startedAt: null, accumulatedSeconds: 40 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).resumeJourney('u1')
    expect(out.state).toBe('ongoing')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('in_progress')
  })

  it('pauseJourney sem task ativa é no-op seguro (só o turno pausa)', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: null }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).pauseJourney('u1')
    expect(out.state).toBe('paused')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update).not.toHaveBeenCalled()
  })

  it('addTaskPhoto faz append da key e presigna na volta', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ imageKeys: ['task/a.jpg'] }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    const out = await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')
    expect(db.task.update.mock.calls[0][0].data.imageKeys).toEqual(['task/a.jpg', 'task/b.jpg'])
    expect(out.images).toEqual(['signed:task/a.jpg', 'signed:task/b.jpg'])
  })
})
