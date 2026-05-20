// mobile/components/MapLineSource.native.tsx
// Native line-shape renderer. Wraps @maplibre/maplibre-react-native's
// <GeoJSONSource> + <LineLayer> for the common "render a polyline on the
// map" case used by evacuation routes.
//
// The unified `paint` prop uses neutral names (`color`, `width`, `opacity`,
// `cap`, `join`) so callers don't have to know whether the underlying lib
// expects camelCase (native) or kebab-case (maplibre-gl web). Conversion
// lives entirely inside this file and its .web sibling.
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { MAP_CHILD_FLAG, type MapChildComponent } from './MapView.native';
import type { LineShape, MapLinePaint, MapLineSourceProps } from './MapLineSource.types';

export type { LineShape, MapLinePaint, MapLineSourceProps };

export function MapLineSource({ id, shape, paint, beforeId }: MapLineSourceProps) {
  return (
    <GeoJSONSource id={id} data={shape as unknown as GeoJSON.GeoJSON}>
      <Layer
        type="line"
        id={`${id}-layer`}
        beforeId={beforeId}
        source={id}
        layout={{
          'line-cap': paint.cap ?? 'round',
          'line-join': paint.join ?? 'round',
        }}
        paint={{
          'line-color': paint.color,
          'line-width': paint.width,
          'line-opacity': paint.opacity ?? 1,
        }}
      />
    </GeoJSONSource>
  );
}

(MapLineSource as MapChildComponent)[MAP_CHILD_FLAG] = true;
