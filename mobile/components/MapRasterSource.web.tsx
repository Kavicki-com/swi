// mobile/components/MapRasterSource.web.tsx
// Web/react-native-web counterpart of MapRasterSource.native. Reads the map
// instance from `MapInstanceContext` (provided by MapView.web.tsx) and
// attaches the source and layer imperatively, same as MapHeatmapSource.web.
//
// Renders nothing; the tiles live in maplibre's own canvas above the basemap.
import { useContext, useEffect } from 'react';
import { MapInstanceContext } from './MapView.web';
import { DEFAULT_RASTER_TILE_SIZE, type MapRasterSourceProps } from './MapRasterSource.types';

export type { MapRasterSourceProps };

export function MapRasterSource({
  id,
  tiles,
  tileSize,
  maxzoom,
  opacity,
  beforeId,
}: MapRasterSourceProps): null {
  const instance = useContext(MapInstanceContext);
  const layerId = `${id}-layer`;
  // The array identity changes on every caller render; the joined templates
  // are what actually identifies the tile set.
  const tilesKey = tiles.join('|');

  useEffect(() => {
    if (!instance) return;
    const { map } = instance;

    // Defensive: clear any stale layer/source from a prior strict-mode mount.
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(id)) map.removeSource(id);

    map.addSource(id, {
      type: 'raster',
      tiles: tilesKey.split('|'),
      tileSize: tileSize ?? DEFAULT_RASTER_TILE_SIZE,
      ...(maxzoom === undefined ? {} : { maxzoom }),
    });
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: id,
        paint: { 'raster-opacity': opacity ?? 1 },
      },
      beforeId,
    );

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(id)) map.removeSource(id);
    };
  }, [instance, id, layerId, tilesKey, tileSize, maxzoom, opacity, beforeId]);

  return null;
}
