// mobile/components/MapMarker.web.tsx
// Web/react-native-web counterpart of MapMarker.native. The maplibre-gl
// library is imperative — markers are created with `new lib.Marker({ element })`
// and attached to the map instance — so this component reads the map handle
// from `MapInstanceContext` (provided by MapView.web.tsx) and bridges the
// RN children tree into a detached <div> via React's createRoot.
//
// Render output is `null`; the marker lives in maplibre's own DOM layer above
// the canvas. The detached subtree does not inherit the app theme, so the
// caller's children should already be wrapped (or use components that
// resolve theme via context the way DS LocationPin does — most callers
// already wrap with <SwiThemeProvider> inside the children prop).
import { useContext, useEffect, useRef } from 'react';
// @ts-expect-error — react-dom/client has no bundled .d.ts; we only consume
// the narrow createRoot API.
import { createRoot } from 'react-dom/client';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { MapInstanceContext } from './MapView.web';
import type { MapMarkerProps } from './MapMarker.types';

export type { MapMarkerProps };

type Root = { render: (node: React.ReactNode) => void; unmount: () => void };

export function MapMarker({ coordinate, children }: MapMarkerProps): null {
  const instance = useContext(MapInstanceContext);
  const [lng, lat] = coordinate;
  const rootRef = useRef<Root | null>(null);

  // Effect 1: create + tear down the marker. Reuses the root across child
  // updates by capturing it in `rootRef`. Re-runs only when the map instance
  // or the coordinate changes — re-creating the marker on every children
  // mutation would thrash. Pre-R-3 (2026-05-17) this effect also called
  // `root.render(children)` once on mount, so visual updates of children
  // (e.g., a status change from `good` → `alert`) were silently lost on web
  // while still working on native. Split out below to fix that asymmetry.
  useEffect(() => {
    if (!instance) return;
    const { map, lib } = instance;
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    const root: Root = createRoot(el);
    rootRef.current = root;
    const marker = new lib.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
      root.unmount();
      el.remove();
      rootRef.current = null;
    };
  }, [instance, lng, lat]);

  // Effect 2: re-render children into the existing root whenever they
  // change. createRoot's render() reconciles like normal React — no thrash
  // because the marker / DOM element are stable across child updates.
  // T4.5: wrap children em SwiThemeProvider AQUI (uma vez por marker no web)
  // em vez de obrigar cada consumer a colocar manualmente. Centraliza a
  // necessidade de re-prover o theme dentro do root detached do maplibre-gl.
  useEffect(() => {
    rootRef.current?.render(<SwiThemeProvider>{children}</SwiThemeProvider>);
  }, [children]);

  return null;
}

// Web variant does not need the MAP_CHILD_FLAG: MapView.web.tsx renders all
// children inside its overlay <View>, and this component returns null, so
// the partitioning step is unnecessary on web.
