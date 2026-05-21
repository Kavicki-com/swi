// mobile/components/MapView.web.tsx
// Web/react-native-web implementation of the shared MapView. Renders a raw
// <div> for the maplibre-gl canvas and a positioned RN overlay for caller-
// provided children. Exposes both:
//   1. legacy `onReady(map, lib)` callback — kept for the 3 screens that
//      have not been migrated to declarative children yet (map.tsx,
//      map-weather.tsx, evacuation-ongoing.tsx). Cleanup of markers/layers
//      attached via the handle is the caller's responsibility.
//   2. `MapInstanceContext` provider — exposes the map instance + lib once
//      load fires so declarative child components (MapMarker, MapLineSource,
//      ...) can attach themselves without needing to thread refs through.
//      The native counterpart in MapView.native.tsx uses
//      @maplibre/maplibre-react-native's declarative components directly,
//      so children authored against this API render natively too.
import { createContext, useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import type maplibregl from 'maplibre-gl';
import { useMapLibre } from '@/lib/useMapLibre';
import { ESRI_SATELLITE_STYLE } from '@/lib/mapStyle';

export interface MapInstanceContextValue {
  map: maplibregl.Map;
  lib: typeof maplibregl;
}

export const MapInstanceContext = createContext<MapInstanceContextValue | null>(null);

export interface MapViewProps {
  /** Initial center as [lng, lat]. */
  center: [number, number];
  /** Initial zoom. Defaults to 14. */
  zoom?: number;
  /**
   * Legacy escape hatch: fired once after `load`. Use only when porting old
   * imperative screens; new code should prefer declarative children.
   */
  onReady?: (map: maplibregl.Map, lib: typeof maplibregl) => void;
  /** Children render absolute-positioned above the map canvas (z-index 2). */
  children?: React.ReactNode;
  testID?: string;
}

export function MapView(props: MapViewProps): ReactElement {
  const { center, zoom = 14, onReady, children, testID } = props;
  const lib = useMapLibre();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [instance, setInstance] = useState<MapInstanceContextValue | null>(null);
  // Keep the latest onReady in a ref so changing the callback identity
  // between renders doesn't tear down + rebuild the map.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!lib || !containerRef.current) return;

    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center,
      zoom,
      attributionControl: false,
    });

    map.on('load', () => {
      onReadyRef.current?.(map, lib);
      setInstance({ map, lib });
    });

    return () => {
      setInstance(null);
      map.remove();
    };
    // We intentionally exclude `center` / `zoom` from deps: callers are
    // expected to update via map.flyTo / map.setCenter. Recreating the map
    // on every prop change would destroy caller-added markers and layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  return (
    <View testID={testID} style={{ flex: 1, position: 'relative' }}>
      {/* Map canvas — raw <div> because maplibre requires an HTMLElement. */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      {/* Children overlay — pointerEvents="box-none" lets map gestures pass
          through empty regions while letting children receive touches where
          they render. Children that consume MapInstanceContext (MapMarker,
          MapLineSource, ...) attach to the map imperatively via useEffect
          and render nothing here; UI children (buttons, controls) render
          normally above the canvas. */}
      <MapInstanceContext.Provider value={instance}>
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
          }}
        >
          {children}
        </View>
      </MapInstanceContext.Provider>
    </View>
  );
}
