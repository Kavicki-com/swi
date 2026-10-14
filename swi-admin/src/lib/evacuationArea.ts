// Geometria da área de evacuação demarcada no mapa. O vértice é [lng, lat]
// (convenção maplibre/GeoJSON), igual ao que o backend guarda e devolve.
export type AreaVertex = [number, number]

// Ponto dentro do polígono por ray casting. Aceita anel aberto ou fechado
// (primeiro vértice repetido no fim não muda o resultado). Menos de 3 vértices
// não forma área, então nunca contém ponto.
export function pointInPolygon(point: AreaVertex, ring: AreaVertex[]): boolean {
  if (ring.length < 3) return false
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) continue
    const [xi, yi] = a
    const [xj, yj] = b
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

// Quantos workers caem dentro da área. Sem área, zero.
export function countWorkersInArea(
  markers: ReadonlyArray<{ lng: number; lat: number }>,
  area: AreaVertex[] | null,
): number {
  if (!area || area.length < 3) return 0
  return markers.reduce((n, m) => (pointInPolygon([m.lng, m.lat], area) ? n + 1 : n), 0)
}
