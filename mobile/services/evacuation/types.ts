// Local mirror do shape devolvido pelo endpoint de rota de evacuação do
// swi-backend. Siblings isolados → NÃO importamos os tipos do backend: este
// arquivo é a fronteira do contrato REST e precisa ser conferido à mão quando
// ele mudar. Mirrors services/<domínio>/types.ts. Datas ISO.

export interface RouteSnapshot {
  waypoints: [number, number][];   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number;
  distanceM: number;
  fetchedAt: string;               // ISO datetime
}

// Evacuação ATIVA da org vista pelo worker: o suficiente pra tela decidir
// mostrar o CTA de confirmação e pro ack ter alvo.
export interface ActiveEvacuationView {
  id: string;
  total: number;
  ackedCount: number;
  myAck: boolean;          // eu já confirmei presença no ponto de encontro?
}

export interface EvacuationBackend {
  // sem args: usa as constantes SITE_ROUTE (rota fixa do site).
  getRoute(): Promise<RouteSnapshot>;
  // null = nenhuma evacuação ativa na minha org (estado normal).
  getActive(): Promise<ActiveEvacuationView | null>;
  // Confirma presença no ponto de encontro (idempotente no backend).
  ack(evacuationId: string): Promise<void>;
}

// Rota fixa do site (piloto SP) — origem (local da obra) + destino (ponto de
// encontro designado), ambos [lng, lat]. Movido de lib/mapMockData.ts (onde eram
// EVACUATION_ORIGIN / EVACUATION_DESTINATION). Fonte da verdade de "de onde até
// onde" pra evacuação.
export const SITE_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
};
