// Células do mapa de calor do backend (GET /positions/heat) viram os pontos
// que a camada de calor desenha. O peso sai normalizado pela célula mais
// quente, na faixa 0..1 que a rampa de cor entende: o mapa mostra onde houve
// mais presença dentro da janela, e não o número absoluto de minutos.
import type { FeatureCollection, Point } from 'geojson';
import type { HeatCell } from '@/services/positions/types';

export function heatShapeFromCells(cells: readonly HeatCell[]): FeatureCollection<Point> {
  const max = cells.reduce((m, c) => Math.max(m, c.weight), 0);
  return {
    type: 'FeatureCollection',
    features: cells
      .filter((c) => c.weight > 0)
      .map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: { weight: c.weight / max },
      })),
  };
}
