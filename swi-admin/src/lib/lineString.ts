// Helpers de geometria pra LineString. lngLatAlongLineString(coords, t)
// devolve o ponto fracional ao longo de uma polyline com N segmentos,
// pesando por comprimento de cada segmento (nao por indice). Substitui o
// lngLatAt antigo do AlertsRescueRoute que era hardcoded pra 3 pontos.
//
// Uso de distancia euclidiana plana (lng/lat como cartesiano) — pro
// caso de uso atual (anchorar 3 labels ao longo de uma rota urbana de
// poucos km) o erro vs. great-circle eh sub-pixel. Pra rotas
// continentais, trocar por haversine.

export type LngLat = [number, number]

function segmentLength(a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export function totalLineLength(coords: ReadonlyArray<LngLat>): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]
    const curr = coords[i]
    if (!prev || !curr) continue
    total += segmentLength(prev, curr)
  }
  return total
}

export function lngLatAlongLineString(coords: ReadonlyArray<LngLat>, t: number): LngLat {
  if (coords.length === 0) return [0, 0]
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (!first || !last) return [0, 0]
  if (coords.length === 1) return [first[0], first[1]]
  const clamped = Math.max(0, Math.min(1, t))
  if (clamped === 0) return [first[0], first[1]]
  if (clamped === 1) return [last[0], last[1]]

  const total = totalLineLength(coords)
  const target = clamped * total
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    if (!a || !b) continue
    const len = segmentLength(a, b)
    if (acc + len >= target) {
      const u = len === 0 ? 0 : (target - acc) / len
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    }
    acc += len
  }
  return [last[0], last[1]]
}
