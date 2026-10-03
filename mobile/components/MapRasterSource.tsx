// TypeScript-only barrel for MapRasterSource. Same pattern as MapView.tsx
// and MapHeatmapSource.tsx: Metro's platform-suffix resolution picks the
// `.web.tsx` or `.native.tsx` variant at bundle time, so this file is
// never actually loaded at runtime.
export { MapRasterSource } from './MapRasterSource.native';
export type { MapRasterSourceProps } from './MapRasterSource.native';
