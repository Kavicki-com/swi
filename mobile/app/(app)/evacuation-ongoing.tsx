import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  LocationPin,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapChipBody } from '@/components/MapChipBody';
import { NavFABs } from '@/components/NavFABs';
import { SITE_ROUTE } from '@/services/evacuation/types';
import { useEvacuation } from '@/services/evacuation/EvacuationProvider';
import { chipAnchors, lineFeature, navArrow, straightLine } from '@/services/evacuation/routeFormat';
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

  const { route, loadStatus, load } = useEvacuation();

  useEffect(() => { load(); }, [load]);

  const waypoints = useMemo<[number, number][] | null>(() => {
    if (route) return route.waypoints;
    if (loadStatus === 'error') return straightLine(SITE_ROUTE.origin, SITE_ROUTE.destination);
    return null;
  }, [route, loadStatus]);

  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const arrow = useMemo(() => navArrow(waypoints ?? []), [waypoints]);
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView
        center={midpoint(SITE_ROUTE.origin, SITE_ROUTE.destination)}
        zoom={15}
      >
        {/* Keys explícitos: children condicionais (lineShape, navArrow,
            chipAnchors) mudam composição do array. Sem keys, React
            reconcilia por posição e maplibre useFrozenId throws quando o
            id "muda" (mas na real é uma instância sendo reusada com novo
            prop). Ver comentário equivalente em evacuation.tsx. */}
        {lineShape && (
          <MapLineSource
            key="evacuation-ongoing-route"
            id="evacuation-ongoing-route"
            shape={lineShape}
            paint={{ color: '#BC88FF', width: 4, opacity: 0.95 }}
          />
        )}
        <MapMarker key="evacuation-destination" coordinate={SITE_ROUTE.destination} id="evacuation-destination">
            <LocationPin variant="badge" status="alert" size={40} name="Destino" />
        </MapMarker>
        {arrow && (
          <MapMarker key="evacuation-nav-arrow" coordinate={arrow.at} id="evacuation-nav-arrow">
              <NavArrowBody rotationDeg={arrow.rotation} />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-ongoing-chip-1" coordinate={anchors.a} id="evacuation-ongoing-chip-1">
              <MapChipBody text="6 minutos" />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-ongoing-chip-2" coordinate={anchors.b} id="evacuation-ongoing-chip-2">
              <MapChipBody text="17 minutos" />
          </MapMarker>
        )}

        <NavFABs />
      </MapView>
    </View>
  );
}
