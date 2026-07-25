import { PositionsService } from './positions.service'
import { NotFoundException } from '@nestjs/common'

// Fase 1 do realtime de localização (2026-07-24): pipeline REAL de última
// posição por worker — upsert + push WS pros admins da org. A fonte (GPS do
// app mobile ou simulador dev) é indiferente ao service.
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const media = () => ({ presignGet: jest.fn(async (k: string) => `signed:${k}`) }) as any
const prisma = () => ({
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  workerPosition: { upsert: jest.fn(), findMany: jest.fn() },
}) as any

const worker = (over: any = {}) => ({
  id: 'w1', name: 'Worker Um', role: 'WORKER', active: true, companyId: 'org1',
  profile: { sector: 'Setor Leste', avatarKey: null },
  ...over,
})
const posRow = (over: any = {}) => ({
  id: 'p1', workerId: 'w1', lat: -23.55, lng: -46.63,
  recordedAt: new Date('2026-07-24T12:00:00Z'), ...over,
})

describe('PositionsService.heartbeat', () => {
  it('upserta a última posição do worker (create e update com recordedAt fresco)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([])
    db.workerPosition.upsert.mockResolvedValue(posRow())
    await new PositionsService(db, realtime(), media()).heartbeat('w1', -23.55, -46.63)
    const arg = db.workerPosition.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ workerId: 'w1' })
    expect(arg.create).toMatchObject({ workerId: 'w1', lat: -23.55, lng: -46.63 })
    expect(arg.update).toMatchObject({ lat: -23.55, lng: -46.63 })
    // @updatedAt não cobre recordedAt — o update precisa renovar explícito.
    expect(arg.update.recordedAt).toBeInstanceOf(Date)
  })

  it('empurra o marker ao vivo SÓ pros admins da MESMA empresa', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    db.workerPosition.upsert.mockResolvedValue(posRow())
    const rt = realtime()
    await new PositionsService(db, rt, media()).heartbeat('w1', -23.55, -46.63)
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', companyId: 'org1' },
      select: { id: true },
    })
    const [ids, event, marker] = rt.emitToUsers.mock.calls[0]
    expect(ids).toEqual(['a1', 'a2'])
    expect(event).toBe('position')
    expect(marker).toMatchObject({ id: 'w1', name: 'Worker Um', lat: -23.55, lng: -46.63, sector: 'Setor Leste' })
    expect(marker.recordedAt).toBe('2026-07-24T12:00:00.000Z')
  })

  it('falha do emit não rejeita o heartbeat (posição já persistiu)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([{ id: 'a1' }])
    db.workerPosition.upsert.mockResolvedValue(posRow())
    const rt = { emitToUsers: jest.fn(() => { throw new Error('socket down') }) } as any
    await expect(new PositionsService(db, rt, media()).heartbeat('w1', -23.55, -46.63)).resolves.toBeUndefined()
  })

  it('usuário inexistente ou não-WORKER → NotFound sem upsert', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new PositionsService(db, realtime(), media()).heartbeat('ghost', 0, 0)).rejects.toBeInstanceOf(NotFoundException)
    const db2 = prisma()
    db2.user.findUnique.mockResolvedValue(worker({ role: 'ADMIN' }))
    await expect(new PositionsService(db2, realtime(), media()).heartbeat('a1', 0, 0)).rejects.toBeInstanceOf(NotFoundException)
    expect(db2.workerPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('PositionsService.listForCompany', () => {
  it('lista markers só de workers ATIVOS da empresa, com avatar presignado', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([
      { ...posRow(), worker: worker({ profile: { sector: 'Setor Leste', avatarKey: 'avatars/a.png' } }) },
    ])
    const out = await new PositionsService(db, realtime(), media()).listForCompany('org1')
    expect(db.workerPosition.findMany).toHaveBeenCalledWith({
      where: { worker: { role: 'WORKER', active: true, companyId: 'org1' } },
      include: { worker: { include: { profile: true } } },
    })
    expect(out).toEqual([{
      id: 'w1', name: 'Worker Um', lat: -23.55, lng: -46.63,
      sector: 'Setor Leste', avatar: 'signed:avatars/a.png',
      recordedAt: '2026-07-24T12:00:00.000Z',
    }])
  })

  it('companyId null (legado) escopa em null — não vaza outras orgs', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([])
    await new PositionsService(db, realtime(), media()).listForCompany(null)
    expect(db.workerPosition.findMany.mock.calls[0][0].where.worker.companyId).toBeNull()
  })

  it('worker sem profile → sector null e avatar vazio', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([{ ...posRow(), worker: worker({ profile: null }) }])
    const out = await new PositionsService(db, realtime(), media()).listForCompany('org1')
    expect(out[0]).toMatchObject({ sector: null, avatar: '' })
  })
})
