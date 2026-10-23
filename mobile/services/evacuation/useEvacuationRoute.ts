import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
  /** A evacuação vista ativa acabou: a tela sai do modo evacuação. */
  ended: boolean;
}

/**
 * Rota de evacuação da posição de quem está com o telefone até o ponto de
 * encontro da evacuação ativa. Busca cada vez que a tela ganha foco, assim que
 * o GPS responde (ou com `null`, se a localização foi negada, pro backend usar
 * a última posição real), e refaz o traçado quando a pessoa se afasta dele.
 */
export function useEvacuationRoute(): EvacuationRouteView {
  const { coords, permission } = useLocation();
  const { route, loadStatus, errorKind, reload, msSinceLastFetch, ended } = useEvacuation();

  // Busca a cada foco, não uma vez por sessão do app: entre uma visita e outra
  // a evacuação pode ter acabado ou o ponto pode ter mudado, e rota velha na
  // tela de segurança leva pro lugar errado. Só a tela em foco recebe o evento,
  // então as duas telas empilhadas não buscam juntas.
  const [focusKey, setFocusKey] = useState(0);
  useFocusEffect(useCallback(() => { setFocusKey((k) => k + 1); }, []));
  const askedFor = useRef(0);

  // Espera o GPS responder. Permissão negada não é espera eterna, é resposta:
  // pede a rota sem posição.
  useEffect(() => {
    if (focusKey === 0 || askedFor.current === focusKey) return;
    if (!coords && permission !== 'denied') return;
    askedFor.current = focusKey;
    reload(coords ?? null);
  }, [focusKey, coords, permission, reload]);

  // Recálculo: longe do traçado E com a última busca velha o bastante.
  useEffect(() => {
    if (!coords || !route) return;
    if (distanceToPolylineM(coords, route.waypoints) <= OFF_ROUTE_M) return;
    if (msSinceLastFetch() < MIN_REFETCH_MS) return;
    reload(coords);
  }, [coords, route, reload, msSinceLastFetch]);

  return { route, loadStatus, errorKind, coords, ended };
}
