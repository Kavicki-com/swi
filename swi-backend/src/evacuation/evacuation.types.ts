// Espelha o shape do seam mobile services/evacuation/types.ts (siblings isolados).
export interface RouteSnapshot {
  waypoints: [number, number][]   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number
  distanceM: number
  fetchedAt: string               // ISO datetime
}

export interface Directions { waypoints: [number, number][]; durationSec: number; distanceM: number }

// Rota fixa do site (piloto SP) — mesma SITE_ROUTE do seam mobile. [lng, lat].
export const SITE_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
}

// Rota canned de fallback — paridade EXATA com o mockEvacuationBackend do mobile
// (curva crível, ~23 min / 1500 m do Figma). Servida quando o roteador falha.
export const CANNED_ROUTE: Directions = {
  waypoints: [
    SITE_ROUTE.origin,
    [-46.6295, -23.5505],
    [-46.627, -23.549],
    [-46.6242, -23.5472],
    SITE_ROUTE.destination,
  ],
  durationSec: 1380,
  distanceM: 1500,
}
