import type { EvacuationBackend, RouteSnapshot } from './types';
import { SITE_ROUTE } from './types';
import { EVACUATION_SCENARIO } from '../../lib/featureFlags';

// Backend demo in-memory pra fatia Evacuação. Rota canned (polyline curva crível
// entre origem e destino do site) batendo os ~6/17min do Figma. Determinística
// (sem rede). O cenário (flag EVACUATION_SCENARIO) exercita normal/loading/error.
const BASE = '2026-06-24T12:00:00.000Z';

// [lng, lat]. Começa em SITE_ROUTE.origin, termina em SITE_ROUTE.destination, com
// pontos intermediários que arqueiam (curva visível no grid urbano vs reta).
const CANNED_WAYPOINTS: [number, number][] = [
  SITE_ROUTE.origin,
  [-46.6295, -23.5505],
  [-46.627, -23.549],
  [-46.6242, -23.5472],
  SITE_ROUTE.destination,
];

function snapshot(): RouteSnapshot {
  return {
    waypoints: CANNED_WAYPOINTS,
    durationSec: 1380, // ~23 min (6 + 17 do Figma)
    distanceM: 1500,
    fetchedAt: BASE,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<RouteSnapshot>(() => {}); // 'loading' nunca resolve

export const mockEvacuationBackend: EvacuationBackend = {
  async getRoute() {
    if (EVACUATION_SCENARIO === 'loading') return never();
    await tick();
    if (EVACUATION_SCENARIO === 'error') throw new Error('mock evacuation error');
    return snapshot();
  },

  // No mock não existe evacuação DISPARADA (o dispatch é do admin real): a tela
  // nunca mostra o CTA de confirmação — honesto com o caminho demo.
  async getActive() {
    await tick();
    return null;
  },

  async ack() {
    await tick();
  },
};
