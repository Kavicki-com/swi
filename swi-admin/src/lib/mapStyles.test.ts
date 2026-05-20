import { ESRI_SATELLITE_STYLE } from './mapStyles'

describe('ESRI_SATELLITE_STYLE', () => {
  it('uses ESRI World Imagery raster tiles', () => {
    const src = ESRI_SATELLITE_STYLE.sources['esri-imagery']
    expect(src.type).toBe('raster')
    expect(src.tiles?.[0]).toContain('server.arcgisonline.com')
    expect(src.tiles?.[0]).toContain('World_Imagery')
  })

  it('caps maxzoom at 19', () => {
    expect(ESRI_SATELLITE_STYLE.sources['esri-imagery'].maxzoom).toBe(19)
  })

  it('declares mandatory ESRI attribution', () => {
    expect(ESRI_SATELLITE_STYLE.sources['esri-imagery'].attribution).toMatch(/Esri/)
  })
})
