import type { HelpRequestView } from './types';

// Tempo estimado do socorrista despachado até o funcionário que pediu ajuda.
//
// Mesma régua da lista de socorristas do painel, de onde a central escolhe
// quem despachar: distância equirretangular, exata o bastante na escala de um
// site industrial, e velocidade a pé. Assim o número do app bate com o que a
// central viu ao despachar.
const M_PER_DEG_LAT = 111_320;
const WALK_SPEED_MPS = 1.4;

/**
 * Minutos até o socorrista chegar, ou null quando não há o que estimar: sem
 * pedido, pedido encerrado, ninguém despachado, socorrista já no local, sem a
 * posição dele ou sem a do funcionário. Nunca um número inventado.
 *
 * `worker` em [lng, lat], a convenção do LocationProvider.
 */
export function rescuerEtaMinutes(
  help: HelpRequestView | null,
  worker: [number, number] | null,
): number | null {
  if (help === null || help.status === 'CLOSED') return null;
  const rescue = help.rescue;
  if (rescue === null || rescue.status !== 'dispatched') return null;
  const from = rescue.rescuerPosition;
  if (from === null || worker === null) return null;
  const [lng, lat] = worker;
  const midLat = ((from.lat + lat) / 2) * (Math.PI / 180);
  const dx = (lng - from.lng) * M_PER_DEG_LAT * Math.cos(midLat);
  const dy = (lat - from.lat) * M_PER_DEG_LAT;
  const meters = Math.hypot(dx, dy);
  // Piso de 1 minuto: "0 minutos" soaria como se ele já estivesse ali.
  return Math.max(1, Math.round(meters / WALK_SPEED_MPS / 60));
}

/** O rótulo do Figma ("Aprox. 7 minutos"), com o número da estimativa. */
export function etaLabel(minutes: number): string {
  return `Aprox. ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}
