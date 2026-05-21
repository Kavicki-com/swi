// TypeScript-only barrel. Metro's platform-suffix resolution picks
// MapMarker.web.tsx for web bundles and MapMarker.native.tsx for iOS/Android
// bundles; this file is never actually loaded at runtime. It exists so
// `tsc --noEmit` can resolve the bare import path used by the map screens.
//
// Types come from MapMarker.types.ts (not from a variant file) so future
// drift between web and native doesn't silently change the public shape.
// Pattern matches Smartwatch3D.types.ts.
export { MapMarker } from './MapMarker.native';
export type { MapMarkerProps } from './MapMarker.types';
