// Endereço do mapa geral centrado numa pessoa. O mapa lê `?focus=<id>`, liga a
// camada de operadores, voa até o pino e o destaca; sem id, abre a visão geral.
export function fullMapPath(personId?: string | null): string {
  return personId ? `/maps/general?focus=${encodeURIComponent(personId)}` : '/maps/general'
}
