// Posições realtime: o app é a FONTE do sinal em produção, posta a própria
// posição GPS no backend, que upserta e empurra pros admins via WS. Em dev, o
// simulador server-side alimenta o mesmo caminho.

export interface PositionsBackend {
  // (lat, lng) — mesma ordem do POST /positions/heartbeat do swi-backend.
  heartbeat(lat: number, lng: number): Promise<void>;
}
