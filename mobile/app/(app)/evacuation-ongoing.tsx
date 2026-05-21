import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Feature, LineString } from 'geojson';
import {
  LocationPin,
  SwiThemeProvider,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapChipBody } from '@/components/MapChipBody';
import { NavFABs } from '@/components/NavFABs';
import {
  EVACUATION_DESTINATION,
  EVACUATION_ORIGIN,
} from '@/lib/mapMockData';
import { getEvacuationRoute } from '@/lib/evacuationRouteCache';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';

// Figma 385:30336 — evacuation-route-ongoing (in-progress / "navegando").
//
// Migrated off the legacy maplibre-gl imperative wrapper onto the
// declarative MapView API (matches evacuation.tsx). Works on both web
// (via MapView.web.tsx + maplibre-gl) and native iOS/Android (via
// MapView.native.tsx + @maplibre/maplibre-react-native).
//
// On-map geo-anchored children:
//   - Purple #BC88FF polyline (em-andamento color, vs cyan idle)
//   - Destination pin only (user IS the origin in this state)
//   - Navigation arrow marker (teal #50B3D2) at ~30% along the route,
//     rotated to match bearing toward next waypoint
//   - 2 time chips ("6 minutos" / "17 minutos") at 35% / 70%
//
// No instruction card — Figma shows the map fullscreen.

const NAV_ARROW_PATH_D =
  'M1.66667 31.6667L0 30L13.3333 0L26.6667 30L25 31.6667L13.3333 26.6667L1.66667 31.6667Z';
const NAV_ARROW_VIEW_W = 26.6667;
const NAV_ARROW_VIEW_H = 31.6667;
const NAV_ARROW_FILL = '#50B3D2';

// Navigation arrow ("you are here") rendered as an SVG triangle inside a
// rotated View. Container takes `rotationDeg` so the tip always points
// toward the next waypoint.
function NavArrowBody({ rotationDeg }: { rotationDeg: number }) {
  return (
    <View
      style={{
        width: 28,
        height: 32,
        transform: [{ rotate: `${rotationDeg}deg` }],
      }}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${NAV_ARROW_VIEW_W} ${NAV_ARROW_VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <Path d={NAV_ARROW_PATH_D} fill={NAV_ARROW_FILL} />
      </Svg>
    </View>
  );
}

// Compass bearing in degrees from `a` to `b`. Flat-earth approximation
// (negligible error at urban demo scale ~1.5km). SVG arrow points UP at
// rotation 0 (north); atan2 returns east-from-x in radians.
function bearingDeg(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angleEastFromX = (Math.atan2(dy, dx) * 180) / Math.PI;
  let deg = 90 - angleEastFromX;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

function midpoint(
  a: [number, number],
  b: [number, number],
): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export default function EvacuationOngoing() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <EvacuationOngoingScreen />;
}

function EvacuationOngoingScreen() {
  const theme = useTheme();

  const [waypoints, setWaypoints] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvacuationRoute().then((route) => {
      if (!cancelled) setWaypoints(route.waypoints);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const lineShape = useMemo<Feature<LineString> | null>(() => {
    if (!waypoints || waypoints.length === 0) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: waypoints },
    };
  }, [waypoints]);

  // Nav arrow at ~30% along the route, oriented toward the next waypoint.
  // Clamp lookahead index so we always have a valid "next" point for bearing.
  const navArrow = useMemo<{ at: [number, number]; rotation: number } | null>(() => {
    if (!waypoints || waypoints.length < 2) return null;
    const idx = Math.min(
      Math.max(Math.floor(waypoints.length * 0.3), 0),
      waypoints.length - 2,
    );
    const at = waypoints[idx];
    const next = waypoints[idx + 1] ?? waypoints[idx];
    return { at, rotation: bearingDeg(at, next) };
  }, [waypoints]);

  // Time chips at 35% / 70% — same anchors as evacuation.tsx idle state.
  const chipAnchors = useMemo<{ a: [number, number]; b: [number, number] } | null>(() => {
    if (!waypoints || waypoints.length === 0) return null;
    const i1 = Math.min(Math.max(Math.floor(waypoints.length * 0.35), 0), waypoints.length - 1);
    const i2 = Math.min(Math.max(Math.floor(waypoints.length * 0.7), 0), waypoints.length - 1);
    return { a: waypoints[i1], b: waypoints[i2] };
  }, [waypoints]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView
        center={midpoint(EVACUATION_ORIGIN, EVACUATION_DESTINATION)}
        zoom={15}
      >
        {lineShape && (
          <MapLineSource
            id="evacuation-ongoing-route"
            shape={lineShape}
            paint={{ color: '#BC88FF', width: 4, opacity: 0.95 }}
          />
        )}
        <MapMarker coordinate={EVACUATION_DESTINATION} id="evacuation-destination">
          <SwiThemeProvider>
            <LocationPin variant="badge" status="alert" size={40} name="Destino" />
          </SwiThemeProvider>
        </MapMarker>
        {navArrow && (
          <MapMarker coordinate={navArrow.at} id="evacuation-nav-arrow">
            <SwiThemeProvider>
              <NavArrowBody rotationDeg={navArrow.rotation} />
            </SwiThemeProvider>
          </MapMarker>
        )}
        {chipAnchors && (
          <MapMarker coordinate={chipAnchors.a} id="evacuation-ongoing-chip-1">
            <SwiThemeProvider>
              <MapChipBody text="6 minutos" />
            </SwiThemeProvider>
          </MapMarker>
        )}
        {chipAnchors && (
          <MapMarker coordinate={chipAnchors.b} id="evacuation-ongoing-chip-2">
            <SwiThemeProvider>
              <MapChipBody text="17 minutos" />
            </SwiThemeProvider>
          </MapMarker>
        )}

        <NavFABs />
      </MapView>
    </View>
  );
}
