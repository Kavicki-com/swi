// Helpers compartilhados entre MapsGeneral e AlertsList para o heatmap
// "Produtividade". Em producao buildHeatmapPoints sera substituido pelos
// coords reais vindos da API de telemetria — ver design doc, P0.3.

export type HeatPoint = { lng: number; lat: number; weight: number }

export function buildHeatmapPoints(
  center: [number, number],
  count: number,
  spread: number,
): HeatPoint[] {
  const pts: HeatPoint[] = []
  for (let i = 0; i < count; i++) {
    const u = 1 - Math.random()
    const v = Math.random()
    const r = Math.sqrt(-2 * Math.log(u)) * spread
    const theta = 2 * Math.PI * v
    const dx = r * Math.cos(theta)
    const dy = r * Math.sin(theta)
    const distance = Math.sqrt(dx * dx + dy * dy)
    const weight = Math.max(0.2, 1 - distance / (spread * 2.4))
    pts.push({ lng: center[0] + dx, lat: center[1] + dy, weight })
  }
  return pts
}

export function buildHeatmapGeoJSON(
  points: ReadonlyArray<HeatPoint>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { weight: p.weight },
    })),
  }
}

export const HEATMAP_COLOR_RAMP = [
  0,
  'rgba(34,211,238,0)',
  0.08,
  'rgb(34,211,238)',
  0.24,
  'rgb(34,197,94)',
  0.44,
  'rgb(250,204,21)',
  0.64,
  'rgb(249,115,22)',
  0.84,
  'rgb(220,38,38)',
  1.0,
  'rgb(159,18,57)',
] as const
