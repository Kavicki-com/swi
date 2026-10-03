import { COLLEAGUE_STALE_MS, PositionsService } from './positions.service'
import { NotFoundException } from '@nestjs/common'

// Pipeline REAL de última posição por worker: upsert mais push por WS pros
// admins da org. A fonte, GPS do app mobile ou simulador de dev, é indiferente
// ao service.
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const media = () => ({ presignGet: jest.fn(async (k: string) => `signed:${k}`) }) as any
const history = () => ({ record: jest.fn() }) as any
const telemetry = (statuses: Record<string, string> = {}) =>
  ({ healthStatusOfWorkers: jest.fn(async () => new Map(Object.entries(statuses))) }) as any
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
    await new PositionsService(db, realtime(), media(), history(), telemetry()).heartbeat('w1', -23.55, -46.63)
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
    await new PositionsService(db, rt, media(), history(), telemetry()).heartbeat('w1', -23.55, -46.63)
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
    await expect(new PositionsService(db, rt, media(), history(), telemetry()).heartbeat('w1', -23.55, -46.63)).resolves.toBeUndefined()
  })

  it('usuário inexistente ou não-WORKER → NotFound sem upsert', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new PositionsService(db, realtime(), media(), history(), telemetry()).heartbeat('ghost', 0, 0)).rejects.toBeInstanceOf(NotFoundException)
    const db2 = prisma()
    db2.user.findUnique.mockResolvedValue(worker({ role: 'ADMIN' }))
    await expect(new PositionsService(db2, realtime(), media(), history(), telemetry()).heartbeat('a1', 0, 0)).rejects.toBeInstanceOf(NotFoundException)
    expect(db2.workerPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('PositionsService.listForCompany', () => {
  it('lista markers só de workers ATIVOS da empresa, com avatar presignado', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([
      { ...posRow(), worker: worker({ profile: { sector: 'Setor Leste', avatarKey: 'avatars/a.png' } }) },
    ])
    const out = await new PositionsService(db, realtime(), media(), history(), telemetry()).listForCompany('org1')
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
    await new PositionsService(db, realtime(), media(), history(), telemetry()).listForCompany(null)
    expect(db.workerPosition.findMany.mock.calls[0][0].where.worker.companyId).toBeNull()
  })

  it('worker sem profile → sector null e avatar vazio', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([{ ...posRow(), worker: worker({ profile: null }) }])
    const out = await new PositionsService(db, realtime(), media(), history(), telemetry()).listForCompany('org1')
    expect(out[0]).toMatchObject({ sector: null, avatar: '' })
  })
})

describe('PositionsService.heartbeat: trilha do mapa de calor', () => {
  it('entrega a posição à trilha com a empresa, a origem e o instante gravado', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([])
    db.workerPosition.upsert.mockResolvedValue(posRow())
    const h = history()
    await new PositionsService(db, realtime(), media(), h, telemetry()).heartbeat('w1', -23.55, -46.63, 'sim')
    expect(h.record).toHaveBeenCalledWith(
      { id: 'w1', companyId: 'org1' },
      -23.55,
      -46.63,
      'sim',
      new Date('2026-07-24T12:00:00Z'),
    )
  })

  // A posição ao vivo é o que o mapa mostra agora; a trilha é secundária e não
  // pode derrubar o heartbeat.
  it('falha ao gravar a trilha não rejeita o heartbeat', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([])
    db.workerPosition.upsert.mockResolvedValue(posRow())
    const h = { record: jest.fn().mockRejectedValue(new Error('db down')) } as any
    await expect(
      new PositionsService(db, realtime(), media(), h, telemetry()).heartbeat('w1', -23.55, -46.63),
    ).resolves.toBeUndefined()
  })
})

describe('PositionsService.listColleagues', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z')

  it('sem empresa não há colega, e nada é consultado', async () => {
    const db = prisma()
    const out = await new PositionsService(db, realtime(), media(), history(), telemetry()).listColleagues(
      { userId: 'w1', companyId: null },
      NOW,
    )
    expect(out).toEqual([])
    expect(db.workerPosition.findMany).not.toHaveBeenCalled()
  })

  it('outros funcionários ativos da mesma empresa, sem a própria pessoa, só posições recentes', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([
      { ...posRow({ workerId: 'w2' }), worker: worker({ id: 'w2', name: 'Colega' }) },
    ])
    const out = await new PositionsService(db, realtime(), media(), history(), telemetry()).listColleagues(
      { userId: 'w1', companyId: 'org1' },
      NOW,
    )
    expect(db.workerPosition.findMany).toHaveBeenCalledWith({
      where: {
        workerId: { not: 'w1' },
        recordedAt: { gte: new Date(NOW.getTime() - COLLEAGUE_STALE_MS) },
        worker: { role: 'WORKER', active: true, companyId: 'org1' },
      },
      include: { worker: { include: { profile: true } } },
    })
    expect(out).toEqual([
      expect.objectContaining({ id: 'w2', name: 'Colega', lat: -23.55, lng: -46.63, sector: 'Setor Leste' }),
    ])
    expect(COLLEAGUE_STALE_MS).toBe(30 * 60 * 1000)
  })

  it('cada colega vem com o estado de saúde, e só o estado', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([
      { ...posRow({ workerId: 'w2' }), worker: worker({ id: 'w2', name: 'Colega' }) },
      { ...posRow({ workerId: 'w3' }), worker: worker({ id: 'w3', name: 'Outro' }) },
    ])
    const tel = telemetry({ w2: 'alert' })
    const out = await new PositionsService(db, realtime(), media(), history(), tel).listColleagues(
      { userId: 'w1', companyId: 'org1' },
      NOW,
    )
    expect(tel.healthStatusOfWorkers).toHaveBeenCalledWith(['w2', 'w3'], NOW)
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['w2', 'alert'],
      // Sem leitura para a pessoa: sem estado.
      ['w3', 'unknown'],
    ])
    // Nenhum número de saúde do colega sai do servidor.
    expect(Object.keys(out[0]).sort()).toEqual(
      ['avatar', 'id', 'lat', 'lng', 'name', 'recordedAt', 'sector', 'status'],
    )
  })

  it('falha ao ler o estado não derruba o mapa: os colegas saem sem estado', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([
      { ...posRow({ workerId: 'w2' }), worker: worker({ id: 'w2', name: 'Colega' }) },
    ])
    const tel = { healthStatusOfWorkers: jest.fn().mockRejectedValue(new Error('db down')) } as any
    const out = await new PositionsService(db, realtime(), media(), history(), tel).listColleagues(
      { userId: 'w1', companyId: 'org1' },
      NOW,
    )
    expect(out).toEqual([expect.objectContaining({ id: 'w2', status: 'unknown' })])
  })

  it('a lista do painel segue sem o campo de estado', async () => {
    const db = prisma()
    db.workerPosition.findMany.mockResolvedValue([{ ...posRow(), worker: worker() }])
    const out = await new PositionsService(db, realtime(), media(), history(), telemetry()).listForCompany('org1')
    expect(out[0]).not.toHaveProperty('status')
  })
})
