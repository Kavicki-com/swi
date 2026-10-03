// Shared types for MapRasterSource (web + native variants). Pattern matches
// MapHeatmapSource.types.ts.

export interface MapRasterSourceProps {
  /** Unique id, also used to derive the layer id (`${id}-layer`). */
  id: string;
  /** Tile URL templates, e.g. "https://example.com/{z}/{x}/{y}.png". */
  tiles: string[];
  /** Tile edge in pixels. Default 256. */
  tileSize?: number;
  /** Deepest zoom the source has tiles for; beyond it the map overzooms. */
  maxzoom?: number;
  /** Layer opacity 0..1. Default 1. */
  opacity?: number;
  /** Optional `beforeId` to insert the layer beneath an existing one. */
  beforeId?: string;
}

export const DEFAULT_RASTER_TILE_SIZE = 256;
