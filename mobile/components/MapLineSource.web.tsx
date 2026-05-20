// mobile/components/MapLineSource.web.tsx
// Web/react-native-web counterpart of MapLineSource.native. maplibre-gl's
// API is imperative — sources and layers are attached via `map.addSource`
// and `map.addLayer` — so this component reads the map instance from
// `MapInstanceContext` (provided by MapView.web.tsx) and translates the
// unified `paint` prop into the kebab-case keys that maplibre-gl expects.
//
// Renders nothing; the line lives in maplibre's own canvas above the tiles.
import { useContext, useEffect } from 'react';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import { MapInstanceContext } from './MapView.web';
import type { LineShape, MapLinePaint, MapLineSourceProps } from './MapLineSource.types';

export type { LineShape, MapLinePaint, MapLineSourceProps };

function normalizeShape(shape: LineShape): Feature | FeatureCollection {
  if ('type' in shape && (shape.type === 'Feature' || shape.type === 'FeatureCollection')) {
    return shape as Feature | FeatureCollection;
  }
  // Bare geometry — wrap as a Feature so maplibre-gl accepts it as source data.
  return {
    type: 'Feature',
    geometry: shape as LineString | MultiLineString,
    properties: {},
  };
}

export function MapLineSource({ id, shape, paint, beforeId }: MapLineSourceProps): null {
  const instance = useContext(MapInstanceContext);
  const layerId = `${id}-layer`;

  useEffect(() => {
    if (!instance) return;
    const { map } = instance;
    const data = normalizeShape(shape);

    // Defensive: clear any stale layer/source from a prior strict-mode mount.
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(id)) map.removeSource(id);

    map.addSource(id, { type: 'geojson', data });
    map.addLayer(
      {
        id: layerId,
        type: 'line',
        source: id,
        layout: {
          'line-cap': paint.cap ?? 'round',
          'line-join': paint.join ?? 'round',
        },
        paint: {
          'line-color': paint.color,
          'line-width': paint.width,
          'line-opacity': paint.opacity ?? 1,
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
    paint.color,
    paint.width,
    paint.opacity,
    paint.cap,
    paint.join,
    beforeId,
  ]);

  return null;
}
