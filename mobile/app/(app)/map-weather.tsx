// mobile/app/(app)/map-weather.tsx
// Figma 385:21840 — map-metereologic-alerts. Sprint 6 Wave 2 / item B.2:
// migrates the screen from a static basemap.png + weather-radar.png overlay
// + hand-positioned LocationPins to a real MapLibre canvas with a
// heatmap layer ("tempestades") + an optional secondary heatmap
// ("inundacoes") + 11 geo-positioned alert pins + DS MapControls.
//
// Heatmap pattern is a verbatim port of swi-admin/src/pages/maps/
// MapsGeneral.tsx:67-87 (Box-Muller point generation) and lines 393-411
// (storm-intensity color curve: cyan→green→yellow→orange→red→magenta).
// The admin curve produces exactly the red/orange weather radar blob
// shown in Figma 385:21840 — keeping it identical here makes the mobile
// screen visually consistent with the admin Dashboard MapBanner.
//
// LocationPin bridging mirrors admin's `buildPin`: createRoot mounts the
// DS component into a detached div wrapped with SwiThemeProvider, then
// the div is passed to maplibregl.Marker. SwiThemeProvider is required
// because the detached React tree doesn't inherit the app theme context.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
// react-dom/client has no bundled .d.ts and @types/react-dom is not
// installed in the mobile workspace. We only consume the narrow
// `createRoot` API for the maplibre marker bridge, so we declare the
// minimal shape we need inline rather than pulling in a new devDep.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="react" />
// @ts-expect-error — local ambient declaration; the package ships JS only.
import { createRoot } from 'react-dom/client';
type Root = { render: (node: React.ReactNode) => void; unmount: () => void };
import { useRouter } from 'expo-router';
import type maplibregl from 'maplibre-gl';
import {
  Icon,
  LocationPin,
  SwiThemeProvider,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import {
  CAMERA_LOCATIONS,
  USER_LOCATION,
  WEATHER_ALERT_PINS,
  WORKER_LOCATIONS,
  type CameraMarker,
  type WeatherAlertPin,
  type WorkerMarker,
} from '@/lib/mapMockData';
import { NavFABs } from '@/components/NavFABs';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';

// Box-Muller transform for normally-distributed offsets — produces an
// organic cluster denser near `center`, fading at the edges. Verbatim port
// of swi-admin MapsGeneral.tsx:67-87.
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

// Pin bridge handle — keeps marker / React root / element together so we
// can dispose them cleanly when the useEffect re-runs.
type PinHandle = { marker: maplibregl.Marker; root: Root; el: HTMLDivElement };

function buildAlertPin(
  p: WeatherAlertPin,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  onClick: () => void,
): PinHandle {
  const el = document.createElement('div');
  el.style.cursor = 'pointer';
  el.addEventListener('click', onClick);
  const root = createRoot(el);
  root.render(
    <SwiThemeProvider>
      <LocationPin
        variant="badge"
        status={p.status}
        size={40}
        name={`Alerta ${p.status}`}
      />
    </SwiThemeProvider>,
  );
  const marker = new lib.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
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
  const marker = new lib.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
  return { marker, root, el };
}

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
  const marker = new lib.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map);
  return { marker, root, el };
}

export default function MapWeather() {
  // Band-aid pra R-9 (2026-05-17): mesmo motivo de map.tsx — caminho legacy
  // imperativo só compila/roda em web. Web-only até a migração declarativa.
  if (Platform.OS !== 'web' || !isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapWeatherScreen />;
}

function MapWeatherScreen() {
  const theme = useTheme();
  const router = useRouter();

  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof maplibregl | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // 3 icon-only toggle buttons (Figma 385:21840 → 165:21860). Cada botão
  // é simple toggle; tap liga, tap de novo desliga. `showHeatmap=true` por
  // default — screen carrega com storm radar visível (Figma default).
  // O heatmap button controla AMBAS sub-layers (tempestades + inundações)
  // simultaneamente; sem expand panel admin-style no mobile.
  const [showOperators, setShowOperators] = useState(false);
  const [showCameras, setShowCameras] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);

  // Heatmap (tempestades) — same color curve as swi-admin produtividade.
  // Storm intensity reads as a red/orange blob with a magenta core, exactly
  // matching the weather-radar artwork that previously lived in
  // weather-radar.png. Box-Muller cluster: 220 core points (spread 0.006)
  // + 280 halo points (spread 0.018) centered on USER_LOCATION.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !showHeatmap) return;

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
    if (map.getLayer('storm-heatmap-layer')) map.removeLayer('storm-heatmap-layer');
    if (map.getSource('storm-heatmap-points')) map.removeSource('storm-heatmap-points');

    map.addSource('storm-heatmap-points', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'storm-heatmap-layer',
      type: 'heatmap',
      source: 'storm-heatmap-points',
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': 2.0,
        'heatmap-radius': 70,
        'heatmap-opacity': 0.82,
        // Verbatim port of swi-admin MapsGeneral.tsx:393-411.
        // Cyan → green → yellow → orange → red → magenta. Storm intensity
        // reads with a hot magenta core when the density curve peaks.
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
      if (map.getLayer('storm-heatmap-layer')) map.removeLayer('storm-heatmap-layer');
      if (map.getSource('storm-heatmap-points')) map.removeSource('storm-heatmap-points');
    };
  }, [mapReady, showHeatmap]);

  // Heatmap (inundacoes) — secondary layer, narrower spread + orange→red
  // only curve so it reads as a more localized hot zone (flood risk vs
  // storm cloud). Off by default; toggled via MapControl checkbox. Offset
  // slightly south of USER_LOCATION so it doesn't perfectly overlap the
  // tempestades blob when both are on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !showHeatmap) return;

    const floodCenter: [number, number] = [USER_LOCATION[0] + 0.004, USER_LOCATION[1] - 0.008];
    const corePoints = buildHeatmapPoints(floodCenter, 140, 0.004);
    const haloPoints = buildHeatmapPoints(floodCenter, 160, 0.01);
    const points = [...corePoints, ...haloPoints];
    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
    };

    if (map.getLayer('flood-heatmap-layer')) map.removeLayer('flood-heatmap-layer');
    if (map.getSource('flood-heatmap-points')) map.removeSource('flood-heatmap-points');

    map.addSource('flood-heatmap-points', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'flood-heatmap-layer',
      type: 'heatmap',
      source: 'flood-heatmap-points',
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-intensity': 1.6,
        'heatmap-radius': 55,
        'heatmap-opacity': 0.78,
        // Orange → red only — narrower spectrum reads as flood risk.
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(249,115,22,0)',
          0.2,
          'rgb(249,115,22)',
          0.55,
          'rgb(234,88,12)',
          0.85,
          'rgb(220,38,38)',
          1.0,
          'rgb(159,18,57)',
        ],
      },
    });

    return () => {
      if (map.getLayer('flood-heatmap-layer')) map.removeLayer('flood-heatmap-layer');
      if (map.getSource('flood-heatmap-points')) map.removeSource('flood-heatmap-points');
    };
  }, [mapReady, showHeatmap]);

  // 11 geo-positioned alert pins — bridged via createRoot + SwiThemeProvider.
  // All pins open the existing /modals/weather-alert route on tap (no
  // status filter: Figma shows the modal opening from any alert pin).
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !mapReady) return;

    const handles = WEATHER_ALERT_PINS.map((p) =>
      buildAlertPin(p, map, lib, () => router.push('/modals/weather-alert')),
    );

    return () => {
      handles.forEach((h) => {
        h.marker.remove();
        h.root.unmount();
        h.el.remove();
      });
    };
  }, [mapReady, router]);

  // Cameras overlay — same bridge pattern. Mounted only when the user
  // expands the "cameras" MapControl.
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

  // Operators overlay — mesmo bridge pattern, mostra WORKER_LOCATIONS como
  // avatar pins quando o controle operators está expandido. Paridade com
  // o map-view-general / admin MapsGeneral.
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView
        center={USER_LOCATION}
        zoom={13}
        onReady={(map: maplibregl.Map, lib: typeof maplibregl) => {
          mapRef.current = map;
          libRef.current = lib;
          setMapReady(true);
        }}
      >
        {/* Map controls — right:20, vertically centered ~296px acima do
            centro (Figma 385:28587). Stack top-down: operators → heatmap
            → cameras. Cada controle alterna seu próprio overlay. */}
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

      {/* Home FAB only — sem Chat FAB nesta variant (Figma 385:29139) */}
      <NavFABs showChat={false} />
    </View>
  );
}

// MapToggleButton (Figma 165:21575) — icon-only botão quadrado 48×48.
// Background muda de `surface.high` (off) pra `activeColor` (on). Sem
// expand panel; só toggle simples. Mesma copy local em map.tsx.
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
        // @ts-expect-error: boxShadow é web-only (RN-web).
        boxShadow: '0px 4px 8px rgba(29, 29, 29, 0.16)',
      }}
    >
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={iconName} width={iconWidth} height={iconHeight} color={theme.content.dark} />
      </View>
    </Pressable>
  );
}
