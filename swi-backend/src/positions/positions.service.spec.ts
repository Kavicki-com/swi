import { COLLEAGUE_STALE_MS, PositionsService } from './positions.service'
import { BACKFILL_MAX_AGE_MS } from './position-history.service'
import { NotFoundException } from '@nestjs/common'

// Pipeline REAL de última posição por worker: upsert mais push por WS pros
// admins da org. A fonte, GPS do app mobile ou simulador de dev, é indiferente
// ao service.
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const media = () => ({ presignGet: jest.fn(async (k: string) => `signed:${k}`) }) as any
const history = () => ({ record: jest.fn(), recordBackfill: jest.fn(async () => 0) }) as any
const telemetry = (statuses: Record<string, string> = {}) =>
  ({ healthStatusOfWorkers: jest.fn(async () => new Map(Object.entries(statuses))) }) as any
const prisma = () => ({
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  workerPosition: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
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

describe('PositionsService.backfill: o que o app guardou sem rede', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z')
  const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
  const point = (ms: number, over: any = {}) => ({ lat: -23.55, lng: -46.63, recordedAt: iso(ms), ...over })
  const MINUTE = 60_000

  const setup = (stored: any = null) => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(worker())
    db.user.findMany.mockResolvedValue([{ id: 'a1' }])
    db.workerPosition.findUnique.mockResolvedValue(stored)
    db.workerPosition.upsert.mockImplementation(async ({ create }: any) => ({ id: 'p1', ...create }))
    db.workerPosition.updateMany.mockResolvedValue({ count: 1 })
    const h = history()
    const rt = realtime()
    return { db, h, rt, svc: new PositionsService(db, rt, media(), h, telemetry()) }
  }

  it('usuário inexistente ou não-WORKER → NotFound sem gravar nada', async () => {
    const { db, h, svc } = setup()
    db.user.findUnique.mockResolvedValue(worker({ role: 'ADMIN' }))
    await expect(svc.backfill('a1', [point(-MINUTE)], NOW)).rejects.toBeInstanceOf(NotFoundException)
    expect(h.recordBackfill).not.toHaveBeenCalled()
    expect(db.workerPosition.upsert).not.toHaveBeenCalled()
  })

  it('entrega à trilha os pontos em ordem de hora, com a empresa, e devolve quantos entraram', async () => {
    const { h, svc } = setup()
    h.recordBackfill.mockResolvedValue(2)
    const out = await svc.backfill('w1', [point(-5 * MINUTE), point(-20 * MINUTE)], NOW)
    expect(h.recordBackfill).toHaveBeenCalledWith({ id: 'w1', companyId: 'org1' }, [
      { lat: -23.55, lng: -46.63, recordedAt: new Date(iso(-20 * MINUTE)) },
      { lat: -23.55, lng: -46.63, recordedAt: new Date(iso(-5 * MINUTE)) },
    ])
    expect(out).toEqual({ recorded: 2, ignored: 0 })
  })

  it('ponto no futuro além da folga de relógio e ponto mais velho que a retenção são ignorados', async () => {
    const { h, svc } = setup()
    h.recordBackfill.mockResolvedValue(2)
    const out = await svc.backfill(
      'w1',
      [
        point(-BACKFILL_MAX_AGE_MS - 1),
        point(-MINUTE),
        // Dentro da folga: relógio do aparelho um pouco adiantado.
        point(MINUTE),
        point(10 * MINUTE),
      ],
      NOW,
    )
    expect(h.recordBackfill.mock.calls[0][1].map((p: any) => p.recordedAt.toISOString())).toEqual([
      iso(-MINUTE),
      iso(MINUTE),
    ])
    expect(out).toEqual({ recorded: 2, ignored: 2 })
  })

  it('lote só com pontos ignorados não toca a trilha nem a última posição', async () => {
    const { db, h, rt, svc } = setup()
    const out = await svc.backfill('w1', [point(10 * MINUTE)], NOW)
    expect(out).toEqual({ recorded: 0, ignored: 1 })
    expect(h.recordBackfill).not.toHaveBeenCalled()
    expect(db.workerPosition.findUnique).not.toHaveBeenCalled()
    expect(rt.emitToUsers).not.toHaveBeenCalled()
  })

  it('sem última posição, o ponto mais novo vira a última posição com a hora da medição e vai aos admins', async () => {
    const { db, rt, svc } = setup(null)
    await svc.backfill('w1', [point(-20 * MINUTE), point(-5 * MINUTE, { lat: -23.56 })], NOW)
    const arg = db.workerPosition.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ workerId: 'w1' })
    expect(arg.create).toEqual({
      workerId: 'w1', lat: -23.56, lng: -46.63, source: 'real', recordedAt: new Date(iso(-5 * MINUTE)),
    })
    // Um heartbeat que tenha criado a linha no meio do caminho não é sobrescrito.
    expect(arg.update).toEqual({})
    const [ids, event, marker] = rt.emitToUsers.mock.calls[0]
    expect(ids).toEqual(['a1'])
    expect(event).toBe('position')
    expect(marker).toMatchObject({ id: 'w1', lat: -23.56, lng: -46.63, recordedAt: iso(-5 * MINUTE) })
  })

  it('última posição mais velha que o lote avança, com a guarda de hora na escrita', async () => {
    const { db, rt, svc } = setup(posRow({ recordedAt: new Date(iso(-30 * MINUTE)) }))
    await svc.backfill('w1', [point(-5 * MINUTE)], NOW)
    expect(db.workerPosition.updateMany).toHaveBeenCalledWith({
      where: { workerId: 'w1', recordedAt: { lt: new Date(iso(-5 * MINUTE)) } },
      data: { lat: -23.55, lng: -46.63, source: 'real', recordedAt: new Date(iso(-5 * MINUTE)) },
    })
    expect(rt.emitToUsers.mock.calls[0][2]).toMatchObject({ id: 'w1', recordedAt: iso(-5 * MINUTE) })
  })

  // O pino do painel mostra onde a pessoa está agora: ponto atrasado entra na
  // trilha, mas não puxa o pino para trás nem avisa ninguém.
  it('última posição mais nova que o lote fica como está, sem aviso aos admins', async () => {
    const { db, h, rt, svc } = setup(posRow({ recordedAt: new Date(iso(-MINUTE)) }))
    h.recordBackfill.mockResolvedValue(1)
    const out = await svc.backfill('w1', [point(-5 * MINUTE)], NOW)
    expect(out).toEqual({ recorded: 1, ignored: 0 })
    expect(db.workerPosition.updateMany).not.toHaveBeenCalled()
    expect(db.workerPosition.upsert).not.toHaveBeenCalled()
    expect(rt.emitToUsers).not.toHaveBeenCalled()
  })

  it('heartbeat que chegou entre a leitura e a escrita vence: sem aviso aos admins', async () => {
    const { db, rt, svc } = setup(posRow({ recordedAt: new Date(iso(-30 * MINUTE)) }))
    db.workerPosition.updateMany.mockResolvedValue({ count: 0 })
    await svc.backfill('w1', [point(-5 * MINUTE)], NOW)
    expect(rt.emitToUsers).not.toHaveBeenCalled()
  })

  // Ao contrário do heartbeat, aqui a trilha é o motivo do pedido: a falha tem
  // de voltar ao app, que guarda os pontos e tenta de novo.
  it('falha ao gravar a trilha rejeita o lote e não mexe na última posição', async () => {
    const { db, h, svc } = setup()
    h.recordBackfill.mockRejectedValue(new Error('db down'))
    await expect(svc.backfill('w1', [point(-MINUTE)], NOW)).rejects.toThrow('db down')
    expect(db.workerPosition.upsert).not.toHaveBeenCalled()
  })

  it('falha do emit não rejeita o lote', async () => {
    const { rt, svc } = setup()
    rt.emitToUsers.mockImplementation(() => { throw new Error('socket down') })
    await expect(svc.backfill('w1', [point(-MINUTE)], NOW)).resolves.toEqual({ recorded: 0, ignored: 0 })
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
