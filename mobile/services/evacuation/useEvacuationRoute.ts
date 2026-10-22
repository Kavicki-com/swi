import { useEffect, useRef } from 'react';
import { useLocation } from '../location/LocationProvider';
import { useEvacuation, type RouteErrorKind } from './EvacuationProvider';
import { distanceToPolylineM } from '../../lib/mapGeometry';
import type { RouteSnapshot } from './types';

// Distância do traçado a partir da qual a rota é refeita. 50 m é mais que a
// imprecisão típica do GPS a céu aberto e menos que a largura de um quarteirão:
// abaixo disso a pessoa ainda está no caminho, acima ela pegou outro.
const OFF_ROUTE_M = 50;
// Freio de chamada: sem ele, caminhar em paralelo ao traçado dispararia uma
// busca por fix do GPS.
const MIN_REFETCH_MS = 15_000;

interface EvacuationRouteView {
  route: RouteSnapshot | null;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  errorKind: RouteErrorKind;
  coords: [number, number] | null;
}

/**
 * Rota de evacuação da posição de quem está com o telefone até o ponto de
 * encontro da evacuação ativa. Busca uma vez quando o GPS responde (ou com
 * `null`, se a localização foi negada, pro backend usar a última posição real)
 * e refaz o traçado quando a pessoa se afasta dele.
 */
export function useEvacuationRoute(): EvacuationRouteView {
  const { coords, permission } = useLocation();
  const { route, loadStatus, errorKind, load, reload, msSinceLastFetch } = useEvacuation();
  const asked = useRef(false);

  // Primeira busca: espera o GPS responder. Permissão negada não é espera
  // eterna, é resposta: pede a rota sem posição.
  useEffect(() => {
    if (asked.current) return;
    if (!coords && permission !== 'denied') return;
    asked.current = true;
    load(coords ?? null);
  }, [coords, permission, load]);

  // Recálculo: longe do traçado E com a última busca velha o bastante.
  useEffect(() => {
    if (!coords || !route) return;
    if (distanceToPolylineM(coords, route.waypoints) <= OFF_ROUTE_M) return;
    if (msSinceLastFetch() < MIN_REFETCH_MS) return;
    reload(coords);
  }, [coords, route, reload, msSinceLastFetch]);

  return { route, loadStatus, errorKind, coords };
}
