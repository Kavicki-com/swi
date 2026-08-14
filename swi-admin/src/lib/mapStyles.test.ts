// Sem VITE_MAPBOX_TOKEN os tiles do Mapbox falham e /alerts e /maps/general
// viram um vazio preto com pins flutuando. O Mapbox
// segue sendo o provider preferido (decisão documentada: cobertura z17+ no
// interior do BR), mas a AUSÊNCIA do token cai no Esri World Imagery (sem
// chave) — mapa funcional em vez de tela quebrada.
// describe/it/expect via globals: true; vi importado pro stub de env.
import { vi } from 'vitest'

describe('SATELLITE_STYLE', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('com VITE_MAPBOX_TOKEN usa Mapbox Satellite com o token embutido', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-token')
    const { SATELLITE_STYLE } = await import('./mapStyles')
    const src = SATELLITE_STYLE.sources.satellite
    expect(src.type).toBe('raster')
    expect(src.tiles?.[0]).toContain('api.mapbox.com')
    expect(src.tiles?.[0]).toContain('mapbox.satellite')
    expect(src.tiles?.[0]).toContain('access_token=pk.test-token')
    expect(src.maxzoom).toBe(22)
    expect(src.attribution).toMatch(/Mapbox/)
    expect(src.attribution).toMatch(/OpenStreetMap/)
  })

  it('sem token cai no Esri World Imagery (sem chave) — nunca tile quebrado', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MAPBOX_TOKEN', '')
    const { SATELLITE_STYLE } = await import('./mapStyles')
    const src = SATELLITE_STYLE.sources.satellite
    expect(src.type).toBe('raster')
    expect(src.tiles?.[0]).toContain('server.arcgisonline.com')
    expect(src.tiles?.[0]).not.toContain('access_token')
    expect(src.attribution).toMatch(/Esri/)
  })

  // O overlay MapAttribution renderiza este label — hardcoded ele mentiria o
  // provider quando o fallback Esri está ativo.
  it('SATELLITE_ATTRIBUTION_LABEL acompanha o provider escolhido', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-token')
    const withToken = await import('./mapStyles')
    expect(withToken.SATELLITE_ATTRIBUTION_LABEL).toBe('© Mapbox © OpenStreetMap')

    vi.resetModules()
    vi.stubEnv('VITE_MAPBOX_TOKEN', '')
    const withoutToken = await import('./mapStyles')
    expect(withoutToken.SATELLITE_ATTRIBUTION_LABEL).toBe('© Esri — World Imagery')
  })
})
