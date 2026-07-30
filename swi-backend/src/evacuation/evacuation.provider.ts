import { Injectable } from '@nestjs/common'
import { httpGetJson } from '../common/httpGet'
import { SITE_ROUTE } from './evacuation.types'
import type { Directions } from './evacuation.types'

type LngLat = [number, number]
const isLngLat = (p: any): p is LngLat =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])

// Coerção PURA de um payload Directions (Mapbox/OSRM, ambos com geometries=geojson)
// → nosso shape. Lança em payload incompleto (EvacuationService trata com canned).
export function coerceDirections(raw: any): Directions {
  const r = raw?.routes?.[0]
  const coords = r?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length === 0 || !coords.every(isLngLat))
    throw new Error('directions: geometria ausente/inválida')
  if (!Number.isFinite(r.duration) || !Number.isFinite(r.distance))
    throw new Error('directions: duration/distance ausente')
  return { waypoints: coords, durationSec: r.duration, distanceM: r.distance }
}

@Injectable()
export class RouteProvider {
  // Com MAPBOX_TOKEN → Mapbox Directions (walking, premium). Sem token → OSRM
  // público keyless (perfil driving; foot não está no server demo). Mesma coerção.
  async fetch(route = SITE_ROUTE): Promise<Directions> {
    const o = route.origin, d = route.destination
    const coords = `${o[0]},${o[1]};${d[0]},${d[1]}`
    const token = process.env.MAPBOX_TOKEN
    const url = token
      ? `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${token}`
      : `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`
    // httpGetJson, nao fetch: o undici/Wasm derrubava o processo no host de 1 GB.
    const res = await httpGetJson(url, 5000)
    if (!res.ok) throw new Error(`directions: HTTP ${res.status}`)
    return coerceDirections(await res.json())
  }
}
