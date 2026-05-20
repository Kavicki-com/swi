// Shared types for MapLineSource (web + native variants). Pattern matches
// Smartwatch3D.types.ts. The unified `paint` prop uses neutral names
// (`color`, `width`, `opacity`, `cap`, `join`); each variant converts to
// the underlying lib's expected shape (camelCase native, kebab-case web).
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';

export type LineShape =
  | Feature<LineString | MultiLineString>
  | FeatureCollection<LineString | MultiLineString>
  | LineString
  | MultiLineString;

export interface MapLinePaint {
  color: string;
  width: number;
  opacity?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'bevel' | 'round' | 'miter';
}

export interface MapLineSourceProps {
  /** Unique id — also used to derive the layer id (`${id}-layer`). */
  id: string;
  shape: LineShape;
  paint: MapLinePaint;
  /** Optional `beforeId` to insert the layer beneath an existing one. */
  beforeId?: string;
}
