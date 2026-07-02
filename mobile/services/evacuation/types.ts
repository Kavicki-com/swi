// Local mirror do shape devolvido pela custom query getEvacuationRoute do swi-backend.
// Siblings isolados → NÃO importamos o Schema; após deploy, `ampx generate` pode
// substituir. Mirrors services/<domínio>/types.ts. Datas ISO.

export interface RouteSnapshot {
  waypoints: [number, number][];   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number;
  distanceM: number;
  fetchedAt: string;               // ISO datetime
}

export interface EvacuationBackend {
  // sem args: usa as constantes SITE_ROUTE (rota fixa do site).
  getRoute(): Promise<RouteSnapshot>;
}

// Rota fixa do site (piloto SP) — origem (local da obra) + destino (ponto de
// encontro designado), ambos [lng, lat]. Movido de lib/mapMockData.ts (onde eram
// EVACUATION_ORIGIN / EVACUATION_DESTINATION). Fonte da verdade de "de onde até
// onde" pra evacuação.
export const SITE_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
};
