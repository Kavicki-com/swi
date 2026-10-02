// Helpers compartilhados entre MapsGeneral e AlertsList para o mapa de calor
// "Produtividade": a trilha real de posições, agregada em células pelo backend.
import type { HeatCell } from '@/services/api/positionHeat'

export type HeatPoint = { lng: number; lat: number; weight: number }

/**
 * Células do backend viram pontos com peso relativo à célula mais quente, que
 * vale 1: a escala de cor fica estável qualquer que seja a janela consultada.
 * Sem trilha não há ponto nenhum, nunca um borrão de preenchimento.
 */
export function heatPointsFromCells(cells: ReadonlyArray<HeatCell>): HeatPoint[] {
  const max = cells.reduce((m, c) => Math.max(m, c.weight), 0)
  if (max <= 0) return []
  return cells
    .filter((c) => c.weight > 0)
    .map((c) => ({ lat: c.lat, lng: c.lng, weight: c.weight / max }))
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
