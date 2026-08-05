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

/**
 * Expressão `heatmap-color` do MapLibre em forma de tupla.
 *
 * Deliberadamente descrita aqui em vez de importada como
 * `ExpressionSpecification`: web e native resolvem versões diferentes de
 * `@maplibre/maplibre-gl-style-spec` (a 20.x que vem com `maplibre-gl` e a
 * 24.x aninhada em `@maplibre/maplibre-react-native`), e as duas uniões não
 * são mutuamente atribuíveis. Uma tupla estreita satisfaz o membro
 * `interpolate` das duas, o que dispensa cast em qualquer um dos renderers.
 */
export type HeatmapColorExpression = [
  'interpolate',
  ['linear'],
  ['heatmap-density'],
  ...(number | string)[],
];

/**
 * Converte as paradas [densidade, cor] na expressão `heatmap-color`. Saída:
 *   ['interpolate', ['linear'], ['heatmap-density'], 0, 'cyan', 1, 'red']
 *
 * Vive aqui, e não em cada renderer, para que web e native não possam
 * divergir na conversão: um erro aqui apareceria nos dois mapas de uma vez.
 */
export function buildColorExpression(
  stops: readonly HeatmapColorStop[],
): HeatmapColorExpression {
  const flat: (number | string)[] = [];
  for (const [density, color] of stops) {
    flat.push(density, color);
  }
  return ['interpolate', ['linear'], ['heatmap-density'], ...flat];
}
