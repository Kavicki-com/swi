// OSRM public demo server client. Previously lived in `lib/mapMockData.ts`
// even though it makes a real HTTP call — separating it here makes the
// network dependency explicit (per the audit cleanup item in
// 2026-05-17-mobile-routes-audit.md).
//
// Phase 2 / production: replace `OSRM_URL` with a licensed routing service
// (Mapbox, ArcGIS, self-hosted OSRM) — the public demo server has no SLA
// and prohibits high-volume use.
import { EVACUATION_DESTINATION, EVACUATION_ORIGIN } from '../mapMockData';

export interface EvacuationRoute {
  waypoints: [number, number][];
  durationSec: number;
  distanceM: number;
}

/**
 * Fetches the evacuation route via OSRM public demo server.
 * Returns waypoints as [lng, lat] pairs. Falls back to a 5-point
 * synthetic geometry if OSRM is unreachable (offline-resilient demo).
 */
export async function fetchEvacuationRoute(): Promise<EvacuationRoute> {
  const [oLng, oLat] = EVACUATION_ORIGIN;
  const [dLng, dLat] = EVACUATION_DESTINATION;

  // 5-point linear interpolation between origin and destination — used
  // whenever OSRM is unavailable so the demo never renders a broken route.
  const fallback = (): EvacuationRoute => {
    const waypoints: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      waypoints.push([oLng + (dLng - oLng) * t, oLat + (dLat - oLat) * t]);
    }
    return { waypoints, durationSec: 360, distanceM: 1500 };
  };

  const url =
    'https://router.project-osrm.org/route/v1/foot/' +
    `${oLng},${oLat};${dLng},${dLat}` +
    '?overview=full&geometries=geojson';

  // 5s timeout — keeps the demo snappy when OSRM is slow / down.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return fallback();
    const data = (await res.json()) as {
      routes?: Array<{
        geometry?: { coordinates?: [number, number][] };
        duration?: number;
        distance?: number;
      }>;
    };
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return fallback();
    return {
      waypoints: coords,
      durationSec: typeof route?.duration === 'number' ? route.duration : 360,
      distanceM: typeof route?.distance === 'number' ? route.distance : 1500,
    };
  } catch {
    clearTimeout(timer);
    return fallback();
  }
}
