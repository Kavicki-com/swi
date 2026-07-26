import { useEffect, useRef } from 'react';
import { getPositionsBackend } from './getPositionsBackend';

// 10 s: rápido o bastante pro pino do admin andar "ao vivo", folgado contra o
// throttle global do backend (100 req/min) e o watch do expo-location (5 s).
const DEFAULT_INTERVAL_MS = 10_000;

// Posta a posição do worker no backend em cadência fixa. getCoords devolve
// [lng, lat] (convenção GeoJSON do LocationProvider); o heartbeat é (lat, lng).
// null (sem fix ainda / permissão negada) → pula o tick. Erros são engolidos:
// heartbeat é best-effort, a próxima batida corrige.
export function usePositionHeartbeat(
  getCoords: () => [number, number] | null,
  opts?: { intervalMs?: number },
): void {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  // Getter em ref: o efeito monta UMA vez e sempre lê o valor corrente.
  const getCoordsRef = useRef(getCoords);
  getCoordsRef.current = getCoords;

  useEffect(() => {
    const backend = getPositionsBackend();
    const tick = () => {
      const coords = getCoordsRef.current();
      if (!coords) return;
      void backend.heartbeat(coords[1], coords[0]).catch(() => {});
    };
    tick(); // primeira batida imediata — o admin não espera o 1º intervalo
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
