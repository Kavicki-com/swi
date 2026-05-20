// TypeScript-only barrel. Metro's platform-suffix resolution picks
// Smartwatch3D.web.tsx for web bundles and Smartwatch3D.native.tsx for
// iOS/Android bundles; this file is never actually loaded at runtime.
// It exists so `tsc --noEmit` can resolve the bare import path used by
// the pairing/complete screens (TS does not honour platform suffixes
// when moduleResolution is "bundler").
export { Smartwatch3D } from './Smartwatch3D.native';
export type { Smartwatch3DProps } from './Smartwatch3D.types';
