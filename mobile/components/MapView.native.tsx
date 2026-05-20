// mobile/components/MapView.native.tsx
// Native (iOS/Android) implementation of the shared MapView. Wraps
// @maplibre/maplibre-react-native's declarative <Map> + <Camera> with the
// same prop shape the .web.tsx variant exposes so callers can author one
// JSX tree that works on both platforms.
//
// Children may be either:
//   - "map children" — DS-wrapped components (MapMarker, MapLineSource, …)
//     that carry the static `__isMapChild` flag. These nest inside the
//     native <Map> element so the lib's reconciler picks them up.
//   - "ui children" — anything else (View, Button, Title). They render in
//     an absolute-positioned RN overlay on top of the map canvas, matching
//     the web behaviour.
//
// The legacy `onReady(map, lib)` prop from the web wrapper is intentionally
// ignored here: native screens are expected to use the declarative API. A
// screen that has not yet been migrated will still mount but its imperative
// useEffects will no-op (mapRef stays null), which is the explicit signal
// to refactor it.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { ESRI_SATELLITE_STYLE } from '@/lib/mapStyle';

// Brand we attach to declarative map-child component types so the wrapper
// can partition them out of the UI overlay tree. Each Map* helper sets
// `MyComponent[MAP_CHILD_FLAG] = true` after definition.
//
// `unique symbol` (vs the previous '__isMapChild' string magic) is opaque:
// callers can only mark a component as a map child by importing this symbol,
// which makes the dependency visible AND prevents a third-party component
// from accidentally setting the same string-keyed property and ending up
// rendered inside the native <Map> reconciler. Audit fix 2026-05-17.
export const MAP_CHILD_FLAG: unique symbol = Symbol('MapChild');
export type MapChildComponent = React.FC<unknown> & { [MAP_CHILD_FLAG]?: true };

export interface MapViewProps {
  /** Initial center as [lng, lat]. */
  center: [number, number];
  /** Initial zoom. Defaults to 14. */
  zoom?: number;
  /**
   * Legacy escape hatch from the web variant. Ignored on native — declarative
   * children are the only supported path here.
   */
  onReady?: unknown;
  children?: ReactNode;
  testID?: string;
}

function partitionChildren(children: ReactNode): {
  mapChildren: ReactNode[];
  uiChildren: ReactNode[];
} {
  const mapChildren: ReactNode[] = [];
  const uiChildren: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (
      isValidElement(child) &&
      typeof child.type !== 'string' &&
      (child.type as MapChildComponent)[MAP_CHILD_FLAG]
    ) {
      mapChildren.push(child);
    } else {
      uiChildren.push(child);
    }
  });
  return { mapChildren, uiChildren };
}

// The shared `ESRI_SATELLITE_STYLE` is typed via maplibre-gl (web). The
// native lib accepts the same MapLibre Style Spec but its `StyleSpecification`
// type comes from a different @maplibre/maplibre-gl-style-spec install,
// which causes a structural mismatch on the `center` tuple type. Passing
// the style as a JSON string sidesteps the type incompatibility and works
// identically at runtime — both platforms parse the spec the same way.
const NATIVE_STYLE_JSON = JSON.stringify(ESRI_SATELLITE_STYLE);

export function MapView(props: MapViewProps): ReactElement {
  const { center, zoom = 14, children, testID } = props;
  const { mapChildren, uiChildren } = partitionChildren(children);

  return (
    <View testID={testID} style={{ flex: 1, position: 'relative' }}>
      <Map
        mapStyle={NATIVE_STYLE_JSON}
        style={StyleSheet.absoluteFillObject}
        attribution={false}
        logo={false}
      >
        <Camera center={center} zoom={zoom} />
        {mapChildren}
      </Map>
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]}>
        {uiChildren}
      </View>
    </View>
  );
}
