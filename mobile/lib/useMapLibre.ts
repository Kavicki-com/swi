// mobile/lib/useMapLibre.ts
// Lazy-loader for maplibre-gl. The library + its CSS together weigh ~700 KB
// (≈275 KB gzipped) and were previously imported statically by every page
// that shows a map. That forced them into the initial bundle even for
// users who land on /login or routes without a map. This hook defers the
// load to the first time a map component mounts; subsequent mounts reuse
// the cached module so the dynamic import only runs once per page session.
//
// Verbatim port of swi-admin/src/lib/useMapLibre.ts — mobile bundler also
// supports dynamic import() (Metro for native, web for react-native-web),
// so the same lazy-load + module-level cache pattern applies.
//
// Usage:
//   const lib = useMapLibre()
//   useEffect(() => {
//     if (!lib) return
//     const map = new lib.Map({ ... })
//     // ...
//     return () => map.remove()
//   }, [lib /* + your other deps */])
import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';

type MapLibreModule = typeof maplibregl;

let cached: MapLibreModule | null = null;
let inFlight: Promise<MapLibreModule> | null = null;

function load(): Promise<MapLibreModule> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  // Load JS + CSS in parallel. Each resolves via a separate HTTP request on
  // web, but they resolve concurrently so we wait on both once.
  //
  // Release `inFlight` once resolved (success or failure) so the Promise
  // object can be garbage-collected. Pre-2026-05-17 this leaked: the
  // resolved Promise was retained for the lifetime of the page session
  // (callers early-return via the `cached` check before reading inFlight,
  // so the leak was functionally harmless but still a footgun). Pattern
  // now mirrors evacuationRouteCache.ts.
  inFlight = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(
    ([mod]) => {
      cached = mod.default;
      inFlight = null;
      return cached;
    },
    (err) => {
      inFlight = null;
      throw err;
    },
  );
  return inFlight;
}

export function useMapLibre(): MapLibreModule | null {
  const [lib, setLib] = useState<MapLibreModule | null>(cached);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    load().then((m) => {
      if (!cancelled) setLib(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return lib;
}
