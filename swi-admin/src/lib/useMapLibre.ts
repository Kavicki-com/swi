// src/lib/useMapLibre.ts
// Lazy-loader for maplibre-gl. The library + its CSS together weigh ~700 KB
// (≈275 KB gzipped) and were previously imported statically by every page
// that shows a map. That forced them into the initial Vite bundle even for
// users who land on /login or routes without a map. This hook defers the
// load to the first time a map component mounts; subsequent mounts reuse
// the cached module so the dynamic import only runs once per page session.
//
// Usage:
//   const lib = useMapLibre()
//   useEffect(() => {
//     if (!lib) return
//     const map = new lib.Map({ ... })
//     // ...
//     return () => map.remove()
//   }, [lib /* + your other deps */])
import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'

type MapLibreModule = typeof maplibregl

let cached: MapLibreModule | null = null
let inFlight: Promise<MapLibreModule> | null = null

function load(): Promise<MapLibreModule> {
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight
  // Load JS + CSS in parallel. Vite serves each via a separate HTTP
  // request, but they resolve concurrently so we wait on both once.
  inFlight = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(
    ([mod]) => {
      cached = mod.default
      return cached
    },
  )
  return inFlight
}

export function useMapLibre(): MapLibreModule | null {
  const [lib, setLib] = useState<MapLibreModule | null>(cached)
  useEffect(() => {
    if (cached) return
    let cancelled = false
    load().then((m) => {
      if (!cancelled) setLib(m)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return lib
}
