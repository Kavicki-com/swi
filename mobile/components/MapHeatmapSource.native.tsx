// mobile/components/MapHeatmapSource.native.tsx
// Native heatmap renderer. Wraps @maplibre/maplibre-react-native's
// <GeoJSONSource> + <Layer type="heatmap"> for the "render a heatmap blob
// over a cluster of weighted points" case used by map.tsx (productivity)
// and map-weather.tsx (storm/flood radar).
//
// The unified `paint` prop uses neutral names (`colorStops`, `intensity`,
// `radius`, `opacity`, `weightProperty`) so callers don't have to compose
// the underlying maplibre style expressions manually. Conversion lives
// entirely inside this file and its .web sibling.
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { MAP_CHILD_FLAG, type MapChildComponent } from './MapView.native';
import type {
  HeatmapColorStop,
  HeatmapShape,
  MapHeatmapPaint,
  MapHeatmapSourceProps,
} from './MapHeatmapSource.types';

export type {
  HeatmapColorStop,
  HeatmapShape,
  MapHeatmapPaint,
  MapHeatmapSourceProps,
};

// Build the maplibre `heatmap-color` interpolation expression from a list
// of [density, color] tuples. Output shape:
//   ['interpolate', ['linear'], ['heatmap-density'], 0, 'cyan', 1, 'red']
function buildColorExpression(stops: HeatmapColorStop[]): unknown[] {
  const flat: unknown[] = [];
  for (const [density, color] of stops) {
    flat.push(density, color);
  }
  return ['interpolate', ['linear'], ['heatmap-density'], ...flat];
}

export function MapHeatmapSource({ id, shape, paint, beforeId }: MapHeatmapSourceProps) {
  const heatmapColor = buildColorExpression(paint.colorStops);
  return (
    <GeoJSONSource id={id} data={shape as unknown as GeoJSON.GeoJSON}>
      <Layer
        type="heatmap"
        id={`${id}-layer`}
        beforeId={beforeId}
        source={id}
        paint={{
          'heatmap-weight': paint.weightProperty
            ? ['get', paint.weightProperty]
            : 1,
          'heatmap-intensity': paint.intensity ?? 1,
          'heatmap-radius': paint.radius ?? 30,
          'heatmap-opacity': paint.opacity ?? 1,
          'heatmap-color': heatmapColor,
        }}
      />
    </GeoJSONSource>
  );
}

(MapHeatmapSource as MapChildComponent)[MAP_CHILD_FLAG] = true;
