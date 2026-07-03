import { EvacuationService } from './evacuation.service'
import type { RouteProvider } from './evacuation.provider'
import { CANNED_ROUTE } from './evacuation.types'

const provider = (fetch: RouteProvider['fetch']) => ({ fetch } as RouteProvider)

describe('EvacuationService.getRoute', () => {
  it('provider ok → usa rota real + fetchedAt ISO', async () => {
    const real = { waypoints: [[-46.6, -23.5], [-46.5, -23.4]] as [number, number][], durationSec: 900, distanceM: 1200 }
    const s = await new EvacuationService(provider(async () => real)).getRoute()
    expect(s.waypoints).toEqual(real.waypoints)
    expect(s.durationSec).toBe(900)
    expect(s.distanceM).toBe(1200)
    expect(typeof s.fetchedAt).toBe('string')
    expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false)
  })
  it('provider falha → fallback canned (nunca quebra)', async () => {
    const s = await new EvacuationService(provider(async () => { throw new Error('down') })).getRoute()
    expect(s.waypoints).toEqual(CANNED_ROUTE.waypoints)
    expect(s.durationSec).toBe(CANNED_ROUTE.durationSec)
    expect(s.distanceM).toBe(CANNED_ROUTE.distanceM)
    expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false)
  })
})
