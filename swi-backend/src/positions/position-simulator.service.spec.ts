import { PositionSimulatorService } from './position-simulator.service'
import { distanceMeters, MUSTER_POINT } from './sim-route'

const prisma = () => ({
  user: { findMany: jest.fn() },
  evacuation: { findMany: jest.fn().mockResolvedValue([]) },
}) as any
const positions = () => ({ heartbeat: jest.fn().mockResolvedValue(undefined) }) as any
const events = () => ({ ack: jest.fn().mockResolvedValue(undefined) }) as any

afterEach(() => {
  delete process.env.SIM_POSITIONS
  jest.useRealTimers()
})

describe('PositionSimulatorService', () => {
  it('sem SIM_POSITIONS=1 fica inerte: não consulta workers nem agenda timer', async () => {
    const db = prisma()
    const svc = new PositionSimulatorService(db, positions(), events())
    await svc.onModuleInit()
    expect(db.user.findMany).not.toHaveBeenCalled()
    svc.onModuleDestroy() // não explode sem timer
  })

  it('ligado: carrega workers ativos (com companyId) e cada tick posta heartbeat(lat, lng) DENTRO da área do site', async () => {
    process.env.SIM_POSITIONS = '1'
    jest.useFakeTimers() // impede o setInterval real de vazar entre testes
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      { id: 'w1', companyId: 'org1' },
      { id: 'w2', companyId: 'org1' },
    ])
    const pos = positions()
    const svc = new PositionSimulatorService(db, pos, events())
    await svc.onModuleInit()
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'WORKER', active: true },
      select: { id: true, companyId: true },
    })

    await svc.tick()
    expect(pos.heartbeat).toHaveBeenCalledTimes(2)
    // Ordem dos args é o bug clássico: heartbeat(workerId, LAT, LNG) — lat é
    // o ~-23.5 e lng o ~-46.6, nunca trocados.
    for (const [id, lat, lng] of pos.heartbeat.mock.calls) {
      expect(['w1', 'w2']).toContain(id)
      expect(lat).toBeGreaterThan(-23.6)
      expect(lat).toBeLessThan(-23.5)
      expect(lng).toBeGreaterThan(-46.7)
      expect(lng).toBeLessThan(-46.55)
    }
    svc.onModuleDestroy()
  })

  it('ticks sucessivos MOVEM o worker (posições diferentes) e erro de um não derruba os demais', async () => {
    process.env.SIM_POSITIONS = '1'
    jest.useFakeTimers()
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      { id: 'w1', companyId: 'org1' },
      { id: 'w2', companyId: 'org1' },
    ])
    const pos = positions()
    pos.heartbeat.mockRejectedValueOnce(new Error('worker removido')) // 1º call falha
    const svc = new PositionSimulatorService(db, pos, events())
    await svc.onModuleInit()

    await svc.tick()
    await svc.tick()
    expect(pos.heartbeat).toHaveBeenCalledTimes(4) // 2 workers × 2 ticks, apesar do erro
    const w1calls = pos.heartbeat.mock.calls.filter((c: unknown[]) => c[0] === 'w1')
    expect(w1calls[0]!.slice(1)).not.toEqual(w1calls[1]!.slice(1)) // andou
    svc.onModuleDestroy()
  })

  // Fase 2: evacuação ativa na org → workers convergem pro muster e ack'am.
  describe('evacuação ativa', () => {
    const setup = async (workers: any[], evacs: any[]) => {
      process.env.SIM_POSITIONS = '1'
      jest.useFakeTimers()
      const db = prisma()
      db.user.findMany.mockResolvedValue(workers)
      db.evacuation.findMany.mockResolvedValue(evacs)
      const pos = positions()
      const ev = events()
      const svc = new PositionSimulatorService(db, pos, ev)
      await svc.onModuleInit()
      return { db, pos, ev, svc }
    }

    it('workers da org em evacuação CONVERGEM pro muster (distância decresce a cada tick)', async () => {
      const { pos, svc } = await setup(
        [{ id: 'w1', companyId: 'org1' }],
        [{ id: 'ev1', companyId: 'org1' }],
      )
      await svc.tick()
      await svc.tick()
      await svc.tick()
      const dists = pos.heartbeat.mock.calls.map(([, lat, lng]: [string, number, number]) =>
        distanceMeters([lng, lat], MUSTER_POINT),
      )
      expect(dists.length).toBe(3)
      expect(dists[1]).toBeLessThan(dists[0])
      expect(dists[2]).toBeLessThan(dists[1])
      svc.onModuleDestroy()
    })

    it("na CHEGADA ao muster ack'a UMA vez (ticks seguintes não repetem)", async () => {
      const { pos, ev, svc } = await setup(
        [{ id: 'w1', companyId: 'org1' }],
        [{ id: 'ev1', companyId: 'org1' }],
      )
      // Loop até chegar: o stepToward clampa no muster; margem de guarda alta.
      for (let i = 0; i < 400 && ev.ack.mock.calls.length === 0; i++) await svc.tick()
      expect(ev.ack).toHaveBeenCalledTimes(1)
      expect(ev.ack).toHaveBeenCalledWith('w1', 'ev1')
      // Já chegou: mais ticks não re-ack'am (nem re-spammam o WS do admin).
      await svc.tick()
      await svc.tick()
      expect(ev.ack).toHaveBeenCalledTimes(1)
      // E o heartbeat na chegada é exatamente o muster (lat=Y, lng=X).
      const last = pos.heartbeat.mock.calls.at(-1)!
      expect(last[1]).toBeCloseTo(MUSTER_POINT[1], 10)
      expect(last[2]).toBeCloseTo(MUSTER_POINT[0], 10)
      svc.onModuleDestroy()
    })

    it("org SEM evacuação segue no loop normal e nunca ack'a", async () => {
      const { ev, svc } = await setup(
        [{ id: 'w1', companyId: 'org1' }, { id: 'w2', companyId: 'org2' }],
        [{ id: 'ev1', companyId: 'org1' }],
      )
      for (let i = 0; i < 400; i++) await svc.tick()
      // Só o w1 (org1) ack'a; o w2 (org2) patrulha e nunca confirma.
      expect(ev.ack).toHaveBeenCalledTimes(1)
      expect(ev.ack.mock.calls.every(([wid]: [string]) => wid === 'w1')).toBe(true)
      svc.onModuleDestroy()
    })

    it('erro do ack não derruba o tick (heartbeats continuam)', async () => {
      const { pos, ev, svc } = await setup(
        [{ id: 'w1', companyId: 'org1' }],
        [{ id: 'ev1', companyId: 'org1' }],
      )
      ev.ack.mockRejectedValue(new Error('evacuação encerrou no meio'))
      for (let i = 0; i < 400; i++) await svc.tick()
      expect(pos.heartbeat.mock.calls.length).toBeGreaterThan(0)
      svc.onModuleDestroy()
    })
  })
})
