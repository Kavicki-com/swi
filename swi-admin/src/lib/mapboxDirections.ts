// Mapbox Directions API v5 wrapper. Faz UMA chamada GET e retorna o que
// importa: geometry GeoJSON, duration (segundos), distance (metros).
//
// Token em VITE_MAPBOX_TOKEN. Public token (pk.*) restrito por URL no
// dashboard da Mapbox — se restricao estiver configurada, ficar no bundle
// e seguro. Pra producao com auditoria estrita, considerar proxy backend.
//
// Profile fixo em "driving-traffic" — eh o ideal pro caso de uso de
// rescue (carro + traffic real-time). Se precisar de outros profiles no
// futuro (walking pra rescue dentro de planta), adicionar parametro.
//
// Cache TTL: 5min. Rescue eh one-shot (carro a caminho do ferido); a
// rota nao muda nessa janela. Reduz quota Mapbox em mounts repetidos
// (StrictMode dev, navegacao back/forward) sem pegar traffic stale.

export type LngLat = [number, number]

export type RouteResult = {
  geometry: GeoJSON.LineString
  duration: number // segundos
  distance: number // metros
}

const CACHE_TTL_MS = 5 * 60 * 1000

type CacheEntry = { fetchedAt: number; data: RouteResult | null }

const cache = new Map<string, CacheEntry>()

export function __resetRouteCache(): void {
  cache.clear()
}

function cacheKey(from: LngLat, to: LngLat): string {
  return `${from[0]},${from[1]}|${to[0]},${to[1]}`
}

export async function fetchRoute({
  from,
  to,
}: {
  from: LngLat
  to: LngLat
}): Promise<RouteResult | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return null

  const key = cacheKey(from, to)
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data
  }

  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?geometries=geojson&overview=full&access_token=${token}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      cache.set(key, { fetchedAt: now, data: null })
      return null
    }
    const data = await res.json()
    const route = data?.routes?.[0]
    if (
      !route?.geometry ||
      typeof route.duration !== 'number' ||
      typeof route.distance !== 'number'
    ) {
      cache.set(key, { fetchedAt: now, data: null })
      return null
    }
    const result: RouteResult = {
      geometry: route.geometry,
      duration: route.duration,
      distance: route.distance,
    }
    cache.set(key, { fetchedAt: now, data: result })
    return result
  } catch {
    cache.set(key, { fetchedAt: now, data: null })
    return null
  }
}
