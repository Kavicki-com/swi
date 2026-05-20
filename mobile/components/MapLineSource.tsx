// TypeScript-only barrel. Metro's platform-suffix resolution picks
// MapLineSource.web.tsx for web bundles and MapLineSource.native.tsx for
// iOS/Android bundles; this file is never actually loaded at runtime.
//
// Types come from MapLineSource.types.ts (not from a variant file) so
// future drift between web and native doesn't silently change the public
// shape. Pattern matches Smartwatch3D.types.ts.
export { MapLineSource } from './MapLineSource.native';
export type { LineShape, MapLinePaint, MapLineSourceProps } from './MapLineSource.types';
