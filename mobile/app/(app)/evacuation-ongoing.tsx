import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
// react-dom/client has no bundled .d.ts and @types/react-dom is not
// installed in the mobile workspace. We only consume the narrow
// `createRoot` API for the maplibre marker bridge, so we declare the
// minimal shape we need inline rather than pulling in a new devDep.
// (Same approach as the sibling map.tsx / map-weather.tsx in this folder.)
// @ts-expect-error — local ambient declaration; the package ships JS only.
import { createRoot } from 'react-dom/client';
type Root = { render: (node: React.ReactNode) => void; unmount: () => void };
import Svg, { Path } from 'react-native-svg';
import type maplibregl from 'maplibre-gl';
import {
  LocationPin,
  SwiThemeProvider,
  Text,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
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
// Sprint 6 Wave 2 B.4: real MapLibre satellite tiles + cached OSRM route
// polyline (purple #BC88FF, distinguishing "em andamento" from the cyan
// idle state) + geo-anchored markers + navigation arrow indicating
// current position along the route.
//
// On-map elements (created in onReady after route resolves):
//   - Purple #BC88FF polyline (same waypoints as idle, color shifted)
//   - Destination pin only (user IS the origin in this state)
//   - Navigation arrow marker (teal #50B3D2) at ~30% along the route,
//     rotated to match the bearing toward the next waypoint
//   - 2 time chips (6 / 17 minutos) at 35% / 70%
// No instruction card — Figma 385:30336 shows the map fullscreen.
//
// Route data is shared with the idle screen via `getEvacuationRoute()`
// module-level cache so OSRM is hit at most once per session.

const NAV_ARROW_PATH_D =
  'M1.66667 31.6667L0 30L13.3333 0L26.6667 30L25 31.6667L13.3333 26.6667L1.66667 31.6667Z';
const NAV_ARROW_VIEW_W = 26.6667;
const NAV_ARROW_VIEW_H = 31.6667;
const NAV_ARROW_FILL = '#50B3D2';

type MarkerHandle = { marker: maplibregl.Marker; root: Root; el: HTMLDivElement };

function buildBadgePin(
  map: maplibregl.Map,
  lib: typeof maplibregl,
  lngLat: [number, number],
  status: 'good' | 'alert',
  name: string,
): MarkerHandle {
  const el = document.createElement('div');
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <LocationPin variant="badge" status={status} size={40} name={name} />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  return { marker, root, el };
}

function buildTextChipMarker(
  map: maplibregl.Map,
  lib: typeof maplibregl,
  lngLat: [number, number],
  text: string,
): MarkerHandle {
  const el = document.createElement('div');
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <MapChipBody text={text} />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  return { marker, root, el };
}

// ChipBody extracted to components/MapChipBody.tsx (audit cleanup
// 2026-05-17) — shared with evacuation.tsx.

// Navigation arrow ("you are here") rendered as an SVG triangle inside a
// rotated View. The container takes `rotationDeg` so the arrow tip always
// points toward the next waypoint.
function NavArrowBody({ rotationDeg }: { rotationDeg: number }) {
  return (
    <View
      style={{
        width: 28,
        height: 32,
        // CSS transform — RN-Web converts this to a transform on the
        // underlying <div>. Rotation origin defaults to the center, which
        // is what we want so the tip swings around the position fix.
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

function buildNavArrowMarker(
  map: maplibregl.Map,
  lib: typeof maplibregl,
  lngLat: [number, number],
  rotationDeg: number,
): MarkerHandle {
  const el = document.createElement('div');
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <NavArrowBody rotationDeg={rotationDeg} />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  return { marker, root, el };
}

// Compute compass bearing in degrees from `a` to `b`. We use the
// flat-earth atan2(dy, dx) approximation: at the urban scale of this
// demo (~1.5 km) the curvature error is negligible (<0.1°), and the
// result feeds an SVG rotation that only needs to look right visually.
// The SVG arrow points UP at rotation 0 (north); atan2 returns east-from-x
// in radians, so we convert to "clockwise from north" via:
//   bearing = 90° - atan2(dy, dx) * 180 / π
function bearingDeg(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angleEastFromX = (Math.atan2(dy, dx) * 180) / Math.PI;
  // 90 - angle so 0° = north (positive lat), 90° = east. Then we negate
  // because a positive rotation in CSS turns clockwise but a "bearing
  // east-from-north" is also clockwise — both match without flipping.
  let deg = 90 - angleEastFromX;
  // Normalize to [0, 360).
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

// Midpoint between two [lng, lat] tuples — used as the initial camera
// target so both endpoints are roughly visible at zoom 15.
function midpoint(
  a: [number, number],
  b: [number, number],
): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export default function EvacuationOngoing() {
  // Band-aid pra R-9 (2026-05-17): caminho legacy imperativo (createRoot +
  // addSource/addLayer) só compila/roda em web. Web-only até migração.
  if (Platform.OS !== 'web' || !isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <EvacuationOngoingScreen />;
}

function EvacuationOngoingScreen() {
  const theme = useTheme();
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof maplibregl | null>(null);
  const [ready, setReady] = useState(false);

  const handleReady = (map: maplibregl.Map, lib: typeof maplibregl) => {
    mapRef.current = map;
    libRef.current = lib;
    setReady(true);
  };

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;

    let cancelled = false;
    const markerHandles: MarkerHandle[] = [];
    let sourceAdded = false;

    getEvacuationRoute().then((route) => {
      if (cancelled) return;
      const waypoints = route.waypoints;
      if (waypoints.length === 0) return;

      // Purple #BC88FF polyline — "rota em andamento" per Figma 385:30461.
      map.addSource('evacuation-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: waypoints },
        },
      });
      map.addLayer({
        id: 'evacuation-line',
        type: 'line',
        source: 'evacuation-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#BC88FF',
          'line-width': 4,
          'line-opacity': 0.95,
        },
      });
      sourceAdded = true;

      // Destination pin only — user IS the origin in the ongoing state.
      markerHandles.push(
        buildBadgePin(map, lib, EVACUATION_DESTINATION, 'alert', 'Destino'),
      );

      // Nav arrow at ~30% along the route, oriented toward the next
      // waypoint. Clamp the lookahead index so we always have a valid
      // "next" point to compute the bearing against.
      const arrowIdx = Math.min(
        Math.max(Math.floor(waypoints.length * 0.3), 0),
        waypoints.length - 2,
      );
      const arrowAt = waypoints[arrowIdx];
      const nextAt = waypoints[arrowIdx + 1] ?? waypoints[arrowIdx];
      const rotation = bearingDeg(arrowAt, nextAt);
      markerHandles.push(buildNavArrowMarker(map, lib, arrowAt, rotation));

      // Time chips — same 35% / 70% anchors as the idle screen so the
      // copy lands on the same visual region of the polyline.
      const i1 = Math.min(
        Math.max(Math.floor(waypoints.length * 0.35), 0),
        waypoints.length - 1,
      );
      const i2 = Math.min(
        Math.max(Math.floor(waypoints.length * 0.7), 0),
        waypoints.length - 1,
      );
      markerHandles.push(
        buildTextChipMarker(map, lib, waypoints[i1], '6 minutos'),
        buildTextChipMarker(map, lib, waypoints[i2], '17 minutos'),
      );

      // Phase 2: animate progress via map.flyTo through waypoints, sliding
      // the nav arrow forward along the line as the simulated user moves.
    });

    return () => {
      cancelled = true;
      markerHandles.forEach((h) => {
        h.marker.remove();
        h.root.unmount();
        h.el.remove();
      });
      if (sourceAdded && map.getLayer && map.getLayer('evacuation-line')) {
        map.removeLayer('evacuation-line');
      }
      if (sourceAdded && map.getSource && map.getSource('evacuation-route')) {
        map.removeSource('evacuation-route');
      }
    };
  }, [ready]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView
        center={midpoint(EVACUATION_ORIGIN, EVACUATION_DESTINATION)}
        zoom={15}
        onReady={handleReady}
      >
        <NavFABs />
      </MapView>
    </View>
  );
}
