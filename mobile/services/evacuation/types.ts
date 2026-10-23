// Local mirror do shape devolvido pelo endpoint de rota de evacuação do
// swi-backend. Siblings isolados → NÃO importamos os tipos do backend: este
// arquivo é a fronteira do contrato REST e precisa ser conferido à mão quando
// ele mudar. Mirrors services/<domínio>/types.ts. Datas ISO.

export interface RouteSnapshot {
  waypoints: [number, number][];   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number;
  distanceM: number;
  fetchedAt: string;               // ISO datetime
  origin: [number, number];        // de onde a rota saiu (GPS do app ou última posição real)
  destination: [number, number];   // ponto de encontro da evacuação ativa
  approximate: boolean;            // true = roteador fora, linha reta
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
  // `from` = posição atual do GPS, em [lng, lat]. null = sem GPS: o backend
  // usa a última posição real gravada da pessoa (e 409 se não houver nenhuma).
  // O destino é sempre o ponto de encontro da evacuação ativa, nunca um ponto
  // fixo: 404 sem evacuação ativa ou sem ponto marcado.
  getRoute(from: [number, number] | null): Promise<RouteSnapshot>;
  // null = nenhuma evacuação ativa na minha org (estado normal).
  getActive(): Promise<ActiveEvacuationView | null>;
  // Confirma presença no ponto de encontro (idempotente no backend).
  ack(evacuationId: string): Promise<void>;
  // Aviso ao vivo de que o gestor encerrou (socket 'evacuation-ended'), com o
  // id da evacuação. Devolve quem solta a escuta.
  subscribeEnded(onEnded: (evacuationId: string) => void): () => void;
}
