// mobile/components/MapRasterSource.native.tsx
// Native raster-tile renderer. Wraps @maplibre/maplibre-react-native's
// <RasterSource> + <Layer type="raster"> for the "drape an image tile set
// over the basemap" case used by map-weather.tsx (rain radar).
import { Layer, RasterSource } from '@maplibre/maplibre-react-native';
import { MAP_CHILD_FLAG, type MapChildComponent } from './MapView.native';
import { DEFAULT_RASTER_TILE_SIZE, type MapRasterSourceProps } from './MapRasterSource.types';

export type { MapRasterSourceProps };

export function MapRasterSource({
  id,
  tiles,
  tileSize,
  maxzoom,
  opacity,
  beforeId,
}: MapRasterSourceProps) {
  return (
    <RasterSource
      id={id}
      tiles={tiles}
      tileSize={tileSize ?? DEFAULT_RASTER_TILE_SIZE}
      maxzoom={maxzoom}
    >
      <Layer
        type="raster"
        id={`${id}-layer`}
        beforeId={beforeId}
        source={id}
        paint={{ 'raster-opacity': opacity ?? 1 }}
      />
    </RasterSource>
  );
}

(MapRasterSource as MapChildComponent)[MAP_CHILD_FLAG] = true;
