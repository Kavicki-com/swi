// Shared types for MapMarker (web + native variants). Pattern matches
// Smartwatch3D.types.ts — both web and native import their `MapMarkerProps`
// from here so the barrel `MapMarker.tsx` can re-export without lying
// when the variants diverge.
//
// Today the web variant intentionally ignores `id` (the maplibre-gl marker
// has no event-matching surface that uses it). Including `id` in the
// shared type keeps the cross-platform call site identical and lets
// Phase 2 wire up event matching on web without breaking signatures.
import type { ReactElement } from 'react';

export interface MapMarkerProps {
  /** Pin position as [longitude, latitude]. */
  coordinate: [number, number];
  /** Optional id — used by the native marker for event matching. Web ignores. */
  id?: string;
  /** RN element to render as the marker visual (DS LocationPin, etc.). */
  children: ReactElement;
}
