import { SATELLITE_STYLE } from './mapStyles'

describe('SATELLITE_STYLE', () => {
  it('uses Mapbox Satellite raster tiles', () => {
    const src = SATELLITE_STYLE.sources.satellite
    expect(src.type).toBe('raster')
    expect(src.tiles?.[0]).toContain('api.mapbox.com')
    expect(src.tiles?.[0]).toContain('mapbox.satellite')
  })

  it('embeds the VITE_MAPBOX_TOKEN in the tile URL', () => {
    const tileUrl = SATELLITE_STYLE.sources.satellite.tiles?.[0] ?? ''
    expect(tileUrl).toContain('access_token=')
  })

  it('caps maxzoom at 22', () => {
    expect(SATELLITE_STYLE.sources.satellite.maxzoom).toBe(22)
  })

  it('declares Mapbox and OpenStreetMap attribution', () => {
    const attr = SATELLITE_STYLE.sources.satellite.attribution
    expect(attr).toMatch(/Mapbox/)
    expect(attr).toMatch(/OpenStreetMap/)
  })
})
