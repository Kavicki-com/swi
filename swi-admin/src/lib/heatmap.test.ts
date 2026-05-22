import { buildHeatmapPoints, HEATMAP_COLOR_RAMP, buildHeatmapGeoJSON } from './heatmap'

describe('buildHeatmapPoints', () => {
  it('returns the requested number of points', () => {
    const pts = buildHeatmapPoints([-46.63, -23.55], 100, 0.01)
    expect(pts).toHaveLength(100)
  })

  it('clamps weight to [0.2, 1]', () => {
    const pts = buildHeatmapPoints([-46.63, -23.55], 200, 0.01)
    pts.forEach((p) => {
      expect(p.weight).toBeGreaterThanOrEqual(0.2)
      expect(p.weight).toBeLessThanOrEqual(1)
    })
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
