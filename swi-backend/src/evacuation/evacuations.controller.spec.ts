import { EvacuationsController } from './evacuations.controller'
import type { JwtUser } from '../auth/current-user.decorator'

// O controller é fino: injeta o companyId do token e repassa a área desenhada
// para o service, que valida e fecha o anel.
describe('EvacuationsController.start', () => {
  const user: JwtUser = { userId: 'a1', companyId: 'org1', role: 'ADMIN' }

  it('repassa userId, companyId do token e a área do corpo para o service', async () => {
    const events = { start: jest.fn().mockResolvedValue({ id: 'ev1' }) } as any
    const controller = new EvacuationsController(events)
    const area: [number, number][] = [
      [-46.64, -23.53],
      [-46.6, -23.52],
      [-46.58, -23.55],
    ]
    await controller.start(user, { area })
    expect(events.start).toHaveBeenCalledWith('a1', 'org1', area)
  })

  it('sem corpo de área ainda dispara (area undefined)', async () => {
    const events = { start: jest.fn().mockResolvedValue({ id: 'ev1' }) } as any
    const controller = new EvacuationsController(events)
    await controller.start(user, {})
    expect(events.start).toHaveBeenCalledWith('a1', 'org1', undefined)
  })
})
