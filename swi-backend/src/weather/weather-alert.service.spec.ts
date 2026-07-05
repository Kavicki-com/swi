import { WeatherAlertService } from './weather-alert.service'

const snap = { alerts: [{ id: 'wx-9', event: 'Tempestade severa', description: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', startsAt: '', endsAt: '' }] }

function mk(seen: boolean, createRejects = false) {
  const enqueueForMany = jest.fn().mockResolvedValue([])
  const create = createRejects
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue({})
  const prisma = {
    weatherAlertSeen: { findUnique: jest.fn().mockResolvedValue(seen ? { alertId: 'wx-9' } : null), create },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
  }
  const weather = { getSnapshot: jest.fn().mockResolvedValue(snap) }
  const svc = new WeatherAlertService(weather as any, prisma as any, { enqueueForMany } as any)
  return { svc, enqueueForMany, prisma }
}

describe('WeatherAlertService.pollAndNotify', () => {
  it('alerta novo → notifica todos os aprovados + grava seen', async () => {
    const { svc, enqueueForMany, prisma } = mk(false)
    await svc.pollAndNotify()
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { role: 'WORKER', approvalStatus: 'APPROVED' }, select: { id: true } })
    expect(enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ domain: 'weather', title: 'Alerta Meteorológico', body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', targetId: 'wx-9' }))
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({ data: { alertId: 'wx-9' } })
  })
  it('alerta já visto → dedup (não notifica, não grava)', async () => {
    const { svc, enqueueForMany, prisma } = mk(true)
    await svc.pollAndNotify()
    expect(enqueueForMany).not.toHaveBeenCalled()
    expect(prisma.weatherAlertSeen.create).not.toHaveBeenCalled()
  })
  it('erro no poll → swallow (best-effort, não relança)', async () => {
    const weather = { getSnapshot: jest.fn().mockRejectedValue(new Error('boom')) }
    const svc = new WeatherAlertService(weather as any, {} as any, {} as any)
    await expect(svc.pollAndNotify()).resolves.toBeUndefined()
  })
  it('falha ao gravar seen (após notificar) → swallow (best-effort, não relança)', async () => {
    const { svc, enqueueForMany, prisma } = mk(false, true)
    await expect(svc.pollAndNotify()).resolves.toBeUndefined()
    expect(enqueueForMany).toHaveBeenCalled()
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalled()
  })
})
