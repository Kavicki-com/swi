// mobile/lib/evacuationRouteCache.ts
// Module-level cache around `fetchEvacuationRoute()`. Both evacuation
// screens (idle + ongoing) consume the SAME route geometry — without
// this helper, navigating from idle → ongoing would re-hit OSRM and
// (a) waste a round-trip, (b) potentially render a slightly different
// polyline if the OSRM response changed (rare, but possible) or if the
// fallback path runs on one screen and the live path on the other.
//
// The cache lives at module scope so it survives Expo Router navigation
// (the JS bundle is shared across routes). `inFlight` deduplicates
// concurrent calls from the same screen (StrictMode re-mounts) and from
// the second screen mounting before the first finishes.
//
// Wave 2 B.3 + B.4 (Sprint 6).
import { fetchEvacuationRoute } from './api/osrm';

type Route = Awaited<ReturnType<typeof fetchEvacuationRoute>>;

let cached: Route | null = null;
let inFlight: Promise<Route> | null = null;

/**
 * Returns the evacuation route, fetching from OSRM (with linear-interp
 * fallback) on first call and serving the cached value thereafter.
 * Subsequent callers reuse the same promise while a request is in flight.
 */
export async function getEvacuationRoute(): Promise<Route> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = fetchEvacuationRoute().then((r) => {
    cached = r;
    inFlight = null;
    return r;
  });
  return inFlight;
}
