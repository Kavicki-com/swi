// TypeScript-only barrel for MapHeatmapSource. Same pattern as MapView.tsx
// and MapLineSource.tsx: Metro's platform-suffix resolution picks the
// `.web.tsx` or `.native.tsx` variant at bundle time, so this file is
// never actually loaded at runtime. It exists so `tsc --noEmit` can
// resolve the bare import path used by map.tsx / map-weather.tsx (TS
// does not honour platform suffixes when moduleResolution is "bundler").
export { MapHeatmapSource } from './MapHeatmapSource.native';
export type {
  HeatmapColorStop,
  HeatmapShape,
  MapHeatmapPaint,
  MapHeatmapSourceProps,
} from './MapHeatmapSource.native';
