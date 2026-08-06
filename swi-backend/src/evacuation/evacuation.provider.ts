import { Injectable } from '@nestjs/common'
import { httpGetJson } from '../common/httpGet'
import { SITE_ROUTE } from './evacuation.types'
import type { Directions } from './evacuation.types'

type LngLat = [number, number]
const isLngLat = (p: unknown): p is LngLat =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])

const isNumero = (v: unknown): v is number => Number.isFinite(v)

// Recorte do payload de Directions que esta coerção lê. Valores `unknown`
// porque o contrato é de terceiro (Mapbox ou OSRM) e pode chegar incompleto;
// quem valida em runtime são `isLngLat` e `isNumero`.
type DirectionsRaw = {
  routes?: Array<{
    geometry?: { coordinates?: unknown }
    duration?: unknown
    distance?: unknown
  }>
}

// Coerção PURA de um payload Directions (Mapbox/OSRM, ambos com geometries=geojson)
// → nosso shape. Lança em payload incompleto (EvacuationService trata com canned).
export function coerceDirections(payload: unknown): Directions {
  // A assinatura pública é `unknown` porque é isso que chega de `res.json()`.
  // A asserção fica num ponto só e não promete nada: todo campo do recorte é
  // opcional, e a validação de verdade vem logo abaixo.
  const raw = payload as DirectionsRaw | null | undefined
  const r = raw?.routes?.[0]
  const coords = r?.geometry?.coordinates
  // `every` com type guard valida mas não estreita o array em si, então os
  // pontos são recolhidos num acumulador tipado enquanto se confere um a um.
  // Mesma condição de erro e mesma mensagem do teste em cadeia anterior.
  if (!Array.isArray(coords) || coords.length === 0)
    throw new Error('directions: geometria ausente/inválida')
  const waypoints: LngLat[] = []
  for (const p of coords) {
    if (!isLngLat(p)) throw new Error('directions: geometria ausente/inválida')
    waypoints.push(p)
  }
  // O `!r` é inalcançável (sem `r` não há coords e a geometria lança antes);
  // está aqui só para o estreitamento do TypeScript.
  if (!r || !isNumero(r.duration) || !isNumero(r.distance))
    throw new Error('directions: duration/distance ausente')
  return { waypoints, durationSec: r.duration, distanceM: r.distance }
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
