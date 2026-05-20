// TypeScript-only barrel. Metro's platform-suffix resolution picks
// MapView.web.tsx for web bundles and MapView.native.tsx for iOS/Android
// bundles; this file is never actually loaded at runtime. It exists so
// `tsc --noEmit` can resolve the bare import path used by the four map
// screens (TS does not honour platform suffixes when moduleResolution is
// "bundler").
//
// Native consumers get a declarative <Map> + <Camera> from
// @maplibre/maplibre-react-native; web consumers get the same legacy
// maplibre-gl + react-native-web wrapper. Both expose the same public
// `MapView` and `MapViewProps` surface so screen code is platform-agnostic.
export { MapView } from './MapView.native';
export type { MapViewProps } from './MapView.native';
