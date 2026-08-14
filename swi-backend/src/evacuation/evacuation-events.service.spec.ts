import { ConflictException, NotFoundException } from '@nestjs/common'
import { EvacuationEventsService } from './evacuation-events.service'

// Evacuação real: o admin dispara, os workers da org são notificados pela fila
// e confirmam presença, e o progresso X/N flui por WS. Uma ativa por org, com
// ack idempotente (unique evacuationId+workerId).
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const notifications = () => ({ enqueueForMany: jest.fn().mockResolvedValue(undefined) }) as any
const prisma = () => ({
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  evacuation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  evacuationAck: { upsert: jest.fn(), findMany: jest.fn() },
}) as any

const evacRow = (over: any = {}) => ({
  id: 'ev1', companyId: 'org1', startedById: 'a1', status: 'ACTIVE',
  createdAt: new Date('2026-07-25T18:00:00Z'), endedAt: null, ...over,
})
const workerRows = [
  { id: 'w1', name: 'Worker Um' },
  { id: 'w2', name: 'Worker Dois' },
]

describe('EvacuationEventsService.start', () => {
  it('cria a evacuação da org, notifica os workers via fila e emite WS pra org inteira', async () => {
    const db = prisma()
    db.evacuation.findFirst.mockResolvedValue(null)
    db.evacuation.create.mockResolvedValue(evacRow())
    // 1ª findMany = workers ativos da org; 2ª = admins da org (pro emit).
    db.user.findMany
      .mockResolvedValueOnce(workerRows)
      .mockResolvedValueOnce([{ id: 'a1' }])
    const rt = realtime()
    const notif = notifications()
    const svc = new EvacuationEventsService(db, rt, notif)

    const dto = await svc.start('a1', 'org1')

    expect(db.evacuation.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'org1', status: 'ACTIVE' },
    })
    expect(db.evacuation.create.mock.calls[0][0].data).toMatchObject({
      companyId: 'org1', startedById: 'a1',
    })
    expect(db.user.findMany.mock.calls[0][0]).toEqual({
      where: { role: 'WORKER', active: true, companyId: 'org1' },
      select: { id: true, name: true },
    })
    // Notificação real (domain evacuation) pra TODOS os workers da org.
    const [ids, payload] = notif.enqueueForMany.mock.calls[0]
    expect(ids).toEqual(['w1', 'w2'])
    expect(payload).toMatchObject({ domain: 'evacuation', targetId: 'ev1' })
    // WS: workers + admins da org recebem o evento de início.
    const [emitIds, event, emitted] = rt.emitToUsers.mock.calls[0]
    expect(event).toBe('evacuation')
    expect([...emitIds].sort()).toEqual(['a1', 'w1', 'w2'])
    expect(emitted).toMatchObject({ id: 'ev1', status: 'ACTIVE', total: 2, acked: 0 })
    expect(dto.startedAt).toBe('2026-07-25T18:00:00.000Z')
    expect(dto.workers).toEqual([
      { id: 'w1', name: 'Worker Um', acked: false, ackAt: null },
      { id: 'w2', name: 'Worker Dois', acked: false, ackAt: null },
    ])
  })

  it('já existe ativa na org → 409 e NÃO cria nem notifica', async () => {
    const db = prisma()
    db.evacuation.findFirst.mockResolvedValue(evacRow())
    const notif = notifications()
    const svc = new EvacuationEventsService(db, realtime(), notif)
    await expect(svc.start('a1', 'org1')).rejects.toBeInstanceOf(ConflictException)
    expect(db.evacuation.create).not.toHaveBeenCalled()
    expect(notif.enqueueForMany).not.toHaveBeenCalled()
  })

  it('falha do emit WS não rejeita o start (evacuação já persistiu)', async () => {
    const db = prisma()
    db.evacuation.findFirst.mockResolvedValue(null)
    db.evacuation.create.mockResolvedValue(evacRow())
    db.user.findMany.mockResolvedValueOnce(workerRows).mockResolvedValueOnce([])
    const rt = realtime()
    rt.emitToUsers.mockImplementation(() => { throw new Error('socket down') })
    const dto = await new EvacuationEventsService(db, rt, notifications()).start('a1', 'org1')
    expect(dto.id).toBe('ev1')
  })
})

describe('EvacuationEventsService.ack', () => {
  const ackSetup = () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'w1', role: 'WORKER', companyId: 'org1' })
    db.evacuation.findUnique.mockResolvedValue(evacRow())
    db.evacuationAck.upsert.mockResolvedValue({})
    db.evacuationAck.findMany.mockResolvedValue([{ workerId: 'w1', ackAt: new Date('2026-07-25T18:05:00Z') }])
    db.user.findMany
      .mockResolvedValueOnce(workerRows) // workers da org (total)
      .mockResolvedValueOnce([{ id: 'a1' }]) // admins da org (emit)
    return db
  }

  it('upsert idempotente + emite progresso pros admins da org', async () => {
    const db = ackSetup()
    const rt = realtime()
    await new EvacuationEventsService(db, rt, notifications()).ack('w1', 'ev1')
    const up = db.evacuationAck.upsert.mock.calls[0][0]
    expect(up.where).toEqual({ evacuationId_workerId: { evacuationId: 'ev1', workerId: 'w1' } })
    expect(up.create).toMatchObject({ evacuationId: 'ev1', workerId: 'w1' })
    expect(up.update).toEqual({})
    const [ids, event, payload] = rt.emitToUsers.mock.calls[0]
    expect(ids).toEqual(['a1'])
    expect(event).toBe('evacuation-ack')
    expect(payload).toMatchObject({ evacuationId: 'ev1', workerId: 'w1', acked: 1, total: 2 })
  })

  it('worker de OUTRA org → NotFound, sem upsert', async () => {
    const db = ackSetup()
    db.user.findUnique.mockResolvedValue({ id: 'w9', role: 'WORKER', companyId: 'org2' })
    await expect(
      new EvacuationEventsService(db, realtime(), notifications()).ack('w9', 'ev1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.evacuationAck.upsert).not.toHaveBeenCalled()
  })

  it('evacuação já ENDED → 409 (a confirmação chegou tarde)', async () => {
    const db = ackSetup()
    db.evacuation.findUnique.mockResolvedValue(evacRow({ status: 'ENDED' }))
    await expect(
      new EvacuationEventsService(db, realtime(), notifications()).ack('w1', 'ev1'),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(db.evacuationAck.upsert).not.toHaveBeenCalled()
  })
})

describe('EvacuationEventsService.active', () => {
  it('devolve o progresso X/N da ativa da org com a lista de workers', async () => {
    const db = prisma()
    db.evacuation.findFirst.mockResolvedValue(evacRow())
    db.evacuationAck.findMany.mockResolvedValue([
      { workerId: 'w2', ackAt: new Date('2026-07-25T18:05:00Z') },
    ])
    db.user.findMany.mockResolvedValueOnce(workerRows)
    const dto = await new EvacuationEventsService(db, realtime(), notifications()).active('org1')
    expect(dto).toMatchObject({ id: 'ev1', total: 2, acked: 1 })
    expect(dto!.workers).toEqual([
      { id: 'w1', name: 'Worker Um', acked: false, ackAt: null },
      { id: 'w2', name: 'Worker Dois', acked: true, ackAt: '2026-07-25T18:05:00.000Z' },
    ])
  })

  it('sem ativa → null', async () => {
    const db = prisma()
    db.evacuation.findFirst.mockResolvedValue(null)
    const dto = await new EvacuationEventsService(db, realtime(), notifications()).active('org1')
    expect(dto).toBeNull()
  })
})

describe('EvacuationEventsService.end', () => {
  it('encerra a ativa da org e emite evacuation-ended pra org inteira', async () => {
    const db = prisma()
    db.evacuation.findUnique.mockResolvedValue(evacRow())
    db.evacuation.update.mockResolvedValue(evacRow({ status: 'ENDED', endedAt: new Date('2026-07-25T18:30:00Z') }))
    db.user.findMany
      .mockResolvedValueOnce(workerRows)
      .mockResolvedValueOnce([{ id: 'a1' }])
    const rt = realtime()
    await new EvacuationEventsService(db, rt, notifications()).end('org1', 'ev1')
    const upd = db.evacuation.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'ev1' })
    expect(upd.data.status).toBe('ENDED')
    expect(upd.data.endedAt).toBeInstanceOf(Date)
    const [ids, event, payload] = rt.emitToUsers.mock.calls[0]
    expect(event).toBe('evacuation-ended')
    expect([...ids].sort()).toEqual(['a1', 'w1', 'w2'])
    expect(payload).toMatchObject({ id: 'ev1' })
  })

  it('evacuação de OUTRA org → NotFound, sem update', async () => {
    const db = prisma()
    db.evacuation.findUnique.mockResolvedValue(evacRow({ companyId: 'org2' }))
    await expect(
      new EvacuationEventsService(db, realtime(), notifications()).end('org1', 'ev1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.evacuation.update).not.toHaveBeenCalled()
  })
})
