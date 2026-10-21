// Espelha o shape do seam mobile services/evacuation/types.ts (siblings isolados).
export interface RouteSnapshot {
  waypoints: [number, number][]   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number
  distanceM: number
  fetchedAt: string               // ISO datetime
  origin: [number, number]        // de onde a rota saiu (GPS do app ou última posição real)
  destination: [number, number]   // ponto de encontro da evacuação ativa
  approximate: boolean            // true = roteador fora, linha reta
}

export interface Directions { waypoints: [number, number][]; durationSec: number; distanceM: number }
