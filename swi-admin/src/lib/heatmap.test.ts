import { heatPointsFromCells, HEATMAP_COLOR_RAMP, buildHeatmapGeoJSON } from './heatmap'

describe('heatPointsFromCells', () => {
  it('normaliza o peso pela célula mais quente, que vale 1', () => {
    const pts = heatPointsFromCells([
      { lat: -23.55, lng: -46.63, weight: 40 },
      { lat: -23.56, lng: -46.64, weight: 10 },
    ])
    expect(pts).toEqual([
      { lat: -23.55, lng: -46.63, weight: 1 },
      { lat: -23.56, lng: -46.64, weight: 0.25 },
    ])
  })

  // Sem trilha no período não há calor: nenhum ponto, nunca um borrão inventado.
  it('sem células devolve vazio', () => {
    expect(heatPointsFromCells([])).toEqual([])
  })

  it('células de peso zero não viram ponto', () => {
    expect(heatPointsFromCells([{ lat: 1, lng: 2, weight: 0 }])).toEqual([])
  })
})

describe('buildHeatmapGeoJSON', () => {
  it('wraps points in a FeatureCollection', () => {
    const fc = buildHeatmapGeoJSON([{ lng: 1, lat: 2, weight: 0.5 }])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { weight: 0.5 },
      },
    ])
  })
})

describe('HEATMAP_COLOR_RAMP', () => {
  it('has 7 stops cyan-to-magenta', () => {
    expect(HEATMAP_COLOR_RAMP).toHaveLength(14)
    expect(HEATMAP_COLOR_RAMP[1]).toMatch(/rgba?\(34,211,238/)
    expect(HEATMAP_COLOR_RAMP[13]).toMatch(/rgb\(159,18,57/)
  })
})
