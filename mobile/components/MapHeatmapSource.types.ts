// Shared types for MapHeatmapSource (web + native variants). Pattern
// matches MapLineSource.types.ts. The `paint.colorStops` prop accepts a
// list of [density, color] pairs which both variants convert into the
// `heatmap-color` interpolation expression — keeping callers from having
// to compose the underlying maplibre style expression manually.
import type { Feature, FeatureCollection, Point } from 'geojson';

export type HeatmapShape =
  | FeatureCollection<Point>
  | Feature<Point>;

/** Single color stop: [density 0..1, color string]. */
export type HeatmapColorStop = [number, string];

export interface MapHeatmapPaint {
  /**
   * Ordered [density, color] pairs. Density values 0..1 (the maplibre
   * `heatmap-density` expression output). Colors any CSS string accepted
   * by maplibre (rgba/rgb/hex/named).
   */
  colorStops: HeatmapColorStop[];
  /** Heatmap intensity multiplier. Default 1. */
  intensity?: number;
  /** Heatmap radius in pixels. Default 30. */
  radius?: number;
  /** Heatmap opacity 0..1. Default 1. */
  opacity?: number;
  /**
   * Name of the per-point property to use as `heatmap-weight`. When
   * omitted the layer uses a constant weight of 1. Points should carry
   * `properties.weight` (or whichever name is passed) as a number 0..1.
   */
  weightProperty?: string;
}

export interface MapHeatmapSourceProps {
  /** Unique id — also used to derive the layer id (`${id}-layer`). */
  id: string;
  shape: HeatmapShape;
  paint: MapHeatmapPaint;
  /** Optional `beforeId` to insert the layer beneath an existing one. */
  beforeId?: string;
}
