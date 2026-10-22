import type { EvacuationBackend, RouteSnapshot } from './types';
import { EVACUATION_SCENARIO } from '../../lib/featureFlags';

// Backend demo in-memory pra fatia Evacuação. Rota canned (polyline curva crível
// entre origem e destino) batendo os ~6/17min do Figma. Determinística
// (sem rede). O cenário (flag EVACUATION_SCENARIO) exercita normal/loading/error.
const BASE = '2026-06-24T12:00:00.000Z';

// Rota de DEMONSTRAÇÃO, só deste arquivo (o caminho real sai do backend, da
// posição da pessoa até o ponto de encontro marcado pelo gestor). [lng, lat],
// com pontos intermediários que arqueiam (curva visível no grid urbano vs reta).
const DEMO_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
};

const DEMO_WAYPOINTS: [number, number][] = [
  DEMO_ROUTE.origin,
  [-46.6295, -23.5505],
  [-46.627, -23.549],
  [-46.6242, -23.5472],
  DEMO_ROUTE.destination,
];

// Com GPS a demo sai de onde a pessoa está: o primeiro waypoint troca de lugar
// e o resto da curva segue igual, pra tela ter o mesmo formato de sempre.
function snapshot(from: [number, number] | null): RouteSnapshot {
  const origin = from ?? DEMO_ROUTE.origin;
  return {
    waypoints: [origin, ...DEMO_WAYPOINTS.slice(1)],
    durationSec: 1380, // ~23 min (6 + 17 do Figma)
    distanceM: 1500,
    fetchedAt: BASE,
    origin,
    destination: DEMO_ROUTE.destination,
    approximate: false,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<RouteSnapshot>(() => {}); // 'loading' nunca resolve

export const mockEvacuationBackend: EvacuationBackend = {
  async getRoute(from: [number, number] | null) {
    if (EVACUATION_SCENARIO === 'loading') return never();
    await tick();
    if (EVACUATION_SCENARIO === 'error') throw new Error('mock evacuation error');
    return snapshot(from);
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
