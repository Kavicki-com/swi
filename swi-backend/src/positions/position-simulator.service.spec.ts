import { PositionSimulatorService } from './position-simulator.service'

const prisma = () => ({ user: { findMany: jest.fn() } }) as any
const positions = () => ({ heartbeat: jest.fn().mockResolvedValue(undefined) }) as any

afterEach(() => {
  delete process.env.SIM_POSITIONS
  jest.useRealTimers()
})

describe('PositionSimulatorService', () => {
  it('sem SIM_POSITIONS=1 fica inerte: não consulta workers nem agenda timer', async () => {
    const db = prisma()
    const svc = new PositionSimulatorService(db, positions())
    await svc.onModuleInit()
    expect(db.user.findMany).not.toHaveBeenCalled()
    svc.onModuleDestroy() // não explode sem timer
  })

  it('ligado: carrega workers ativos e cada tick posta heartbeat(lat, lng) DENTRO da área do site', async () => {
    process.env.SIM_POSITIONS = '1'
    jest.useFakeTimers() // impede o setInterval real de vazar entre testes
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
    const pos = positions()
    const svc = new PositionSimulatorService(db, pos)
    await svc.onModuleInit()
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'WORKER', active: true },
      select: { id: true },
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
    db.user.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
    const pos = positions()
    pos.heartbeat.mockRejectedValueOnce(new Error('worker removido')) // 1º call falha
    const svc = new PositionSimulatorService(db, pos)
    await svc.onModuleInit()

    await svc.tick()
    await svc.tick()
    expect(pos.heartbeat).toHaveBeenCalledTimes(4) // 2 workers × 2 ticks, apesar do erro
    const w1calls = pos.heartbeat.mock.calls.filter((c: unknown[]) => c[0] === 'w1')
    expect(w1calls[0]!.slice(1)).not.toEqual(w1calls[1]!.slice(1)) // andou
    svc.onModuleDestroy()
  })
})
