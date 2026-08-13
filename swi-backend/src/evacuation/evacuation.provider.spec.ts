import * as httpGet from '../common/httpGet'
import { coerceDirections, RouteProvider } from './evacuation.provider'

const geojson = (coords: [number, number][], duration = 1234, distance = 1600) => ({
  routes: [{ geometry: { coordinates: coords }, duration, distance }],
})

describe('coerceDirections', () => {
  it('mapeia routes[0] → waypoints/duration/distance', () => {
    expect(coerceDirections(geojson([[-46.6, -23.5], [-46.5, -23.4]]))).toEqual({
      waypoints: [[-46.6, -23.5], [-46.5, -23.4]], durationSec: 1234, distanceM: 1600,
    })
  })
  it('lança se routes vazio / geometria ausente', () => {
    expect(() => coerceDirections({ routes: [] })).toThrow()
    expect(() => coerceDirections({ routes: [{ duration: 1, distance: 1 }] })).toThrow()
  })
  it('lança se duration/distance ausentes (não-numéricos)', () =>
    expect(() => coerceDirections({ routes: [{ geometry: { coordinates: [[-46.6, -23.5]] } }] })).toThrow())
  it('lança se coordenada malformada (não [num,num])', () =>
    expect(() => coerceDirections({ routes: [{ geometry: { coordinates: [[1]] }, duration: 1, distance: 1 }] })).toThrow())
  it('lança se duration não-finito (NaN)', () =>
    expect(() => coerceDirections({ routes: [{ geometry: { coordinates: [[-46.6, -23.5]] }, duration: NaN, distance: 1 }] })).toThrow())
})

describe('RouteProvider.fetch (seleção de URL + fetch mockado)', () => {
  const origToken = process.env.MAPBOX_TOKEN
  afterEach(() => { jest.restoreAllMocks(); if (origToken === undefined) delete process.env.MAPBOX_TOKEN; else process.env.MAPBOX_TOKEN = origToken })

  it('sem MAPBOX_TOKEN → OSRM keyless + coerce', async () => {
    delete process.env.MAPBOX_TOKEN
    const spy = jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({ ok: true, json: async () => geojson([[-46.632, -23.552], [-46.62, -23.544]]) } as any)
    const out = await new RouteProvider().fetch()
    expect(out.waypoints.length).toBe(2)
    const url = spy.mock.calls[0][0]
    expect(url).toContain('router.project-osrm.org')
    expect(url).toContain('-46.632,-23.552;-46.62,-23.544')
    expect(url).toContain('geometries=geojson')
  })
  it('com MAPBOX_TOKEN → URL Mapbox walking com token', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test'
    const spy = jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({ ok: true, json: async () => geojson([[-46.632, -23.552], [-46.62, -23.544]]) } as any)
    await new RouteProvider().fetch()
    const url = spy.mock.calls[0][0]
    expect(url).toContain('api.mapbox.com/directions/v5/mapbox/walking')
    expect(url).toContain('access_token=pk.test')
  })
  it('HTTP !ok → lança (caller faz fallback)', async () => {
    jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({ ok: false, status: 503 } as any)
    await expect(new RouteProvider().fetch()).rejects.toThrow()
  })
})
