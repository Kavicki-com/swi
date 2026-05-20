// Figma 385:28757 — map-view-general. Sprint 6 Wave 2 / B.1:
// migrates from a static basemap.png + 2 concentric SVG rings to real
// MapLibre satellite tiles (ESRI World Imagery) with 3 toggleable
// overlays (operators / heatmap / cameras). Port of the swi-admin
// canonical at swi-admin/src/pages/maps/MapsGeneral.tsx, trimmed to
// mobile scope:
//   - no admin SideMenu/Header/back-button (mobile relies on NavFABs)
//   - no useDemoToast (mobile has no toast system yet — failures are
//     silent console.log so the demo never blocks on a missing alert UI)
//   - uses the Wave 1 MapView wrapper instead of instantiating maplibre
//     directly; markers/layers are attached via the onReady callback
//     ref pattern so cleanup runs deterministically per overlay toggle.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
// react-dom/client has no bundled .d.ts and @types/react-dom is not
// installed in the mobile workspace. We only consume the narrow
// `createRoot` API for the maplibre marker bridge, so we declare the
// minimal shape we need inline rather than pulling in a new devDep.
// (Same approach as the sibling map-weather.tsx in this folder.)
// @ts-expect-error — local ambient declaration; the package ships JS only.
import { createRoot } from 'react-dom/client';
type Root = { render: (node: React.ReactNode) => void; unmount: () => void };
import type maplibregl from 'maplibre-gl';
import {
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { MapView } from '../../components/MapView';
import { NavFABs } from '../../components/NavFABs';
import { ProdOnlyPlaceholder } from '../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../lib/featureFlags';
import {
  CAMERA_LOCATIONS,
  USER_AVATAR,
  USER_LOCATION,
  WORKER_LOCATIONS,
  type CameraMarker,
  type WorkerMarker,
} from '../../lib/mapMockData';

// ---------------------------------------------------------------------------
// Heatmap data generation — Box-Muller transform produces normally-distributed
// offsets so the cluster fades organically toward its edges. Verbatim port of
// swi-admin MapsGeneral.tsx:67-87.
// ---------------------------------------------------------------------------
function buildHeatmapPoints(
  center: [number, number],
  count: number,
  spread: number,
): Array<{ lng: number; lat: number; weight: number }> {
  const pts: Array<{ lng: number; lat: number; weight: number }> = [];
  for (let i = 0; i < count; i++) {
    const u = 1 - Math.random();
    const v = Math.random();
    const r = Math.sqrt(-2 * Math.log(u)) * spread;
    const theta = 2 * Math.PI * v;
    const dx = r * Math.cos(theta);
    const dy = r * Math.sin(theta);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const weight = Math.max(0.2, 1 - distance / (spread * 2.4));
    pts.push({ lng: center[0] + dx, lat: center[1] + dy, weight });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Pin bridge — maplibre Marker requires an HTMLElement, so we render the DS
// LocationPin into a detached <div> via React 19's createRoot. The detached
// subtree doesn't inherit the app SwiThemeProvider, so we wrap it inline
// (verbatim port of admin lines 89-111 / 133-150).
// ---------------------------------------------------------------------------
type PinHandle = {
  marker: maplibregl.Marker;
  root: Root;
  el: HTMLDivElement;
};

function buildWorkerPin(
  m: WorkerMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
): PinHandle {
  const el = document.createElement('div');
  el.style.cursor = 'pointer';
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <LocationPin
        variant="avatar"
        avatarUri={m.avatarUri}
        status={m.status}
        name={m.name}
      />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el })
    .setLngLat([m.lng, m.lat])
    .addTo(map);
  return { marker, root, el };
}

function buildCameraPin(
  c: CameraMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
): PinHandle {
  const el = document.createElement('div');
  el.style.cursor = 'pointer';
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <LocationPin variant="camera" name={c.name} />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el })
    .setLngLat([c.lng, c.lat])
    .addTo(map);
  return { marker, root, el };
}

// User avatar pin permanente em USER_LOCATION (Figma 385:29023). Sempre
// renderizado, sem toggle — é a "minha posição" visível pra o usuário.
function buildUserPin(
  map: maplibregl.Map,
  lib: typeof maplibregl,
): PinHandle {
  const el = document.createElement('div');
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <LocationPin
        variant="avatar"
        avatarUri={USER_AVATAR}
        status="good"
        name="Você"
      />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el }).setLngLat(USER_LOCATION).addTo(map);
  return { marker, root, el };
}

export default function MapViewGeneral() {
  // Band-aid pra R-9 (2026-05-17): este screen ainda usa o caminho imperativo
  // legacy (createRoot + addSource/addLayer + <div>/linear-gradient inline)
  // que só compila/roda em web. Até a migração pro contrato declarativo
  // <MapView>+<MapMarker>+<MapLineSource>, restringimos a renderização real
  // a web. Em native prod build (onde featureFlags.maps = true) o usuário vê
  // ProdOnlyPlaceholder em vez de crash de react-dom inexistente.
  if (Platform.OS !== 'web' || !isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapViewGeneralScreen />;
}

function MapViewGeneralScreen() {
  const theme = useTheme();

  // Refs captured by MapView's onReady so overlay useEffects can attach
  // markers/layers post-load. Mirrors the admin mapRef/lib pattern but
  // we also keep the library handle (foundation MapView passes both).
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof maplibregl | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Overlay toggles — 3 botões icon-only independentes (Figma 385:28853).
  // Cada botão é um simple toggle: tap liga, tap de novo desliga.
  // O botão heatmap controla AMBAS sub-layers (produtividade + zonas-alerta)
  // simultaneamente — não há expand-panel admin-style no mobile.
  const [showOperators, setShowOperators] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCameras, setShowCameras] = useState(false);

  // User pin (Figma 385:29023) — sempre visível em USER_LOCATION.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !mapReady) return;
    const handle = buildUserPin(map, lib);
    return () => {
      handle.marker.remove();
      handle.root.unmount();
      handle.el.remove();
    };
  }, [mapReady]);

  // -------------------------------------------------------------------------
  // Operator pins overlay — renders 7 WORKER_LOCATIONS as avatar pins when
  // the operators MapControl is expanded. Cleanup unmounts each detached
  // React root + removes the marker; running these in order prevents
  // "marker.remove on a removed node" warnings under React StrictMode.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !mapReady || !showOperators) return;

    const handles = WORKER_LOCATIONS.map((m) => buildWorkerPin(m, map, lib));

    return () => {
      handles.forEach((h) => {
        h.marker.remove();
        h.root.unmount();
        h.el.remove();
      });
    };
  }, [mapReady, showOperators]);

  // -------------------------------------------------------------------------
  // Camera pins overlay — same pattern as operators, drives the green
  // LocationPin variant='camera' over CAMERA_LOCATIONS (12 entries).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !mapReady || !showCameras) return;

    const handles = CAMERA_LOCATIONS.map((c) => buildCameraPin(c, map, lib));

    return () => {
      handles.forEach((h) => {
        h.marker.remove();
        h.root.unmount();
        h.el.remove();
      });
    };
  }, [mapReady, showCameras]);

  // -------------------------------------------------------------------------
  // Productivity heatmap layer — ~500 GeoJSON points clustered around
  // USER_LOCATION drive maplibre's native heatmap interpolation. Color
  // ramp is the admin spec verbatim (cyan → green → yellow → orange →
  // red → magenta) so the legend gradient on the right matches the map
  // density curve exactly.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !showHeatmap) {
      return;
    }

    // Two clusters fused: dense core (220 points / spread 0.006°) drives
    // the hot magenta peak, halo (280 points / spread 0.018°) widens the
    // organic blob so it spans roughly half the visible viewport at z=14.
    const corePoints = buildHeatmapPoints(USER_LOCATION, 220, 0.006);
    const haloPoints = buildHeatmapPoints(USER_LOCATION, 280, 0.018);
    const points = [...corePoints, ...haloPoints];
    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
    };

    // Defensive: clear any stale layer/source from a prior strict-mode mount.
    if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer');
    if (map.getSource('heatmap-points')) map.removeSource('heatmap-points');

    map.addSource('heatmap-points', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'heatmap-layer',
      type: 'heatmap',
      source: 'heatmap-points',
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': 2.0,
        'heatmap-radius': 70,
        'heatmap-opacity': 0.82,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(34,211,238,0)',
          0.08,
          'rgb(34,211,238)',
          0.24,
          'rgb(34,197,94)',
          0.44,
          'rgb(250,204,21)',
          0.64,
          'rgb(249,115,22)',
          0.84,
          'rgb(220,38,38)',
          1.0,
          'rgb(159,18,57)',
        ],
      },
    });

    return () => {
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer');
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points');
    };
  }, [mapReady, showHeatmap]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView
        center={USER_LOCATION}
        zoom={14}
        onReady={(map: maplibregl.Map, lib: typeof maplibregl) => {
          mapRef.current = map;
          libRef.current = lib;
          setMapReady(true);
        }}
      >
        {/* Anéis de raio 5KM e 10KM (Figma 385:29130) — overlays estáticos
            em viewport space, centrados na tela. Cada anel tem um pill
            label verde (surface.primary) posicionado próximo da margem
            sul (bottom-edge) do círculo. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          {/* Anel interno (5KM) — Elipse 102 — 395×395px no Figma. */}
          <View
            style={{
              position: 'absolute',
              width: 395,
              height: 395,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: theme.content.dark,
              opacity: 0.9,
            }}
          />
          <RadiusPill label="5KM" offsetY={183} theme={theme} />
          {/* Anel externo (10KM) — Elipse 103 — 647×647px no Figma. */}
          <View
            style={{
              position: 'absolute',
              width: 647,
              height: 647,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: theme.content.dark,
              opacity: 0.75,
            }}
          />
          <RadiusPill label="10KM" offsetY={308} theme={theme} />
        </View>

        {/* Right-side stack de 3 toggle buttons (Figma 385:28853) —
            right:20, vert-centered ~296px acima do centro. Cada botão é
            icon-only: default bg `surface.high`; ON muda pra cor de
            destaque (verde pros pins, laranja pro heat). */}
        <View
          style={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: [{ translateY: -296 - 80 }],
            gap: theme.gap.s,
            alignItems: 'flex-end',
            zIndex: 2,
          }}
        >
          <MapToggleButton
            iconName="person_apron"
            iconWidth={16}
            iconHeight={16}
            active={showOperators}
            activeColor={theme.surface.primary}
            accessibilityLabel="Operadores"
            onPress={() => setShowOperators((v) => !v)}
            theme={theme}
          />
          <MapToggleButton
            iconName="mode_heat"
            iconWidth={16}
            iconHeight={18}
            active={showHeatmap}
            activeColor={theme.surface.warning}
            accessibilityLabel="Heatmap"
            onPress={() => setShowHeatmap((v) => !v)}
            theme={theme}
          />
          <MapToggleButton
            iconName="video_camera_back"
            iconWidth={20}
            iconHeight={16}
            active={showCameras}
            activeColor={theme.surface.primary}
            accessibilityLabel="Câmeras"
            onPress={() => setShowCameras((v) => !v)}
            theme={theme}
          />
        </View>

      </MapView>

      {/* Chat (right) + Home (center) FABs — shared component. Default
          targets are /(app)/chat/inbox and /(app)/dashboard. Rendered
          OUTSIDE MapView so they sit above the map overlay layer. */}
      <NavFABs />
    </View>
  );
}

// Pill verde (Figma 385:29133 / 385:29134) — chip estreito com label
// "5KM"/"10KM" posicionado na margem sul de cada anel, ligeiramente a
// oeste do centro. `offsetY` é a distância do centro da viewport até o
// centro do pill (positivo = abaixo).
function RadiusPill({
  label,
  offsetY,
  theme,
}: {
  label: string;
  offsetY: number;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        backgroundColor: theme.surface.primary,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        transform: [{ translateY: offsetY }, { translateX: -28 }],
      }}
    >
      <Text variant="body.m" color={theme.content.light}>
        {label}
      </Text>
    </View>
  );
}

// MapToggleButton (Figma 385:28854/28855/28856 + 165:21575) — icon-only
// button quadrado 48×48. Background muda de `surface.high` (off) pra cor
// de destaque (`activeColor`) quando ligado. Drop-shadow `elevation-lg`
// igual ao Figma. Sem expand panel admin-style; só toggle simples.
function MapToggleButton({
  iconName,
  iconWidth,
  iconHeight,
  active,
  activeColor,
  accessibilityLabel,
  onPress,
  theme,
}: {
  iconName: IconName;
  iconWidth: number;
  iconHeight: number;
  active: boolean;
  activeColor: string;
  accessibilityLabel: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        backgroundColor: active ? activeColor : theme.surface.high,
        padding: theme.padding.sm,
        borderRadius: theme.border.radius.m,
        // @ts-expect-error: boxShadow é web-only (RN-web). Mobile usa elevation.
        boxShadow: '0px 4px 8px rgba(29, 29, 29, 0.16)',
      }}
    >
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={iconName} width={iconWidth} height={iconHeight} color={theme.content.dark} />
      </View>
    </Pressable>
  );
}
