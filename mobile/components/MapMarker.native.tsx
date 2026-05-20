// mobile/components/MapMarker.native.tsx
// Native marker renderer. Wraps @maplibre/maplibre-react-native's <Marker>
// (which expects exactly one ReactElement child and uses `lngLat` not
// `coordinate`) so callers can write `<MapMarker coordinate={[lng, lat]}>`
// and pass any RN element tree as children.
import { Marker } from '@maplibre/maplibre-react-native';
import { MAP_CHILD_FLAG, type MapChildComponent } from './MapView.native';
import type { MapMarkerProps } from './MapMarker.types';

export type { MapMarkerProps };

export function MapMarker({ coordinate, id, children }: MapMarkerProps) {
  return (
    <Marker id={id} lngLat={coordinate}>
      {children}
    </Marker>
  );
}

(MapMarker as MapChildComponent)[MAP_CHILD_FLAG] = true;
