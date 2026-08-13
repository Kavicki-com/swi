// mobile/components/MapHeatmapSource.web.tsx
// Web/react-native-web counterpart of MapHeatmapSource.native. maplibre-gl's
// API is imperative — sources and layers are attached via `map.addSource`
// and `map.addLayer` — so this component reads the map instance from
// `MapInstanceContext` (provided by MapView.web.tsx) and translates the
// unified `paint` prop into the kebab-case keys that maplibre-gl expects.
//
// Renders nothing; the heatmap lives in maplibre's own canvas above the tiles.
import { useContext, useEffect, useMemo } from 'react';
import { MapInstanceContext } from './MapView.web';
import { buildColorExpression } from './MapHeatmapSource.types';
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

export function MapHeatmapSource({
  id,
  shape,
  paint,
  beforeId,
}: MapHeatmapSourceProps): null {
  const instance = useContext(MapInstanceContext);
  const layerId = `${id}-layer`;

  // Stop list is the only deep value in paint — memoize the expression so
  // useEffect's dependency check sees a stable array between renders when
  // the caller passes the same color ramp.
  const colorExpression = useMemo(
    () => buildColorExpression(paint.colorStops),
    [paint.colorStops],
  );

  useEffect(() => {
    if (!instance) return;
    const { map } = instance;

    // Defensive: clear any stale layer/source from a prior strict-mode mount.
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(id)) map.removeSource(id);

    map.addSource(id, { type: 'geojson', data: shape as unknown as GeoJSON.GeoJSON });
    map.addLayer(
      {
        id: layerId,
        type: 'heatmap',
        source: id,
        paint: {
          'heatmap-weight': paint.weightProperty ? ['get', paint.weightProperty] : 1,
          'heatmap-intensity': paint.intensity ?? 1,
          'heatmap-radius': paint.radius ?? 30,
          'heatmap-opacity': paint.opacity ?? 1,
          'heatmap-color': colorExpression,
        },
      },
      beforeId,
    );

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(id)) map.removeSource(id);
    };
  }, [
    instance,
    id,
    layerId,
    shape,
    colorExpression,
    paint.intensity,
    paint.radius,
    paint.opacity,
    paint.weightProperty,
    beforeId,
  ]);

  return null;
}
