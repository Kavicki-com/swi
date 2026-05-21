// mobile/app/(app)/map-weather.tsx
// Figma 385:21840 — map-metereologic-alerts. Sprint 6 Wave 2 / item B.2.
//
// Sprint 6 Wave 3: migrated off the legacy maplibre-gl imperative wrapper
// (createRoot + addSource/addLayer) onto the declarative MapView API.
// Works on both web (via MapView.web.tsx + maplibre-gl) and native
// iOS/Android (via MapView.native.tsx + @maplibre/maplibre-react-native).
//
// Heatmap pattern is a verbatim port of swi-admin/src/pages/maps/
// MapsGeneral.tsx:67-87 (Box-Muller point generation) and lines 393-411
// (storm-intensity color curve: cyan→green→yellow→orange→red→magenta).
// The admin curve produces exactly the red/orange weather radar blob
// shown in Figma 385:21840 — keeping it identical here makes the mobile
// screen visually consistent with the admin Dashboard MapBanner.
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Icon,
  LocationPin,
  SwiThemeProvider,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapHeatmapSource } from '@/components/MapHeatmapSource';
import { NavFABs } from '@/components/NavFABs';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  CAMERA_LOCATIONS,
  USER_LOCATION,
  WEATHER_ALERT_PINS,
  WORKER_LOCATIONS,
} from '@/lib/mapMockData';

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

// Storm intensity color ramp — cyan → green → yellow → orange → red →
// magenta (verbatim port of admin MapsGeneral.tsx:393-411). Magenta core
// when the density curve peaks.
const STORM_COLOR_STOPS: Array<[number, string]> = [
  [0, 'rgba(34,211,238,0)'],
  [0.08, 'rgb(34,211,238)'],
  [0.24, 'rgb(34,197,94)'],
  [0.44, 'rgb(250,204,21)'],
  [0.64, 'rgb(249,115,22)'],
  [0.84, 'rgb(220,38,38)'],
  [1.0, 'rgb(159,18,57)'],
];

// Flood color ramp — narrower spectrum (orange → red → magenta). Reads as
// a more localized hot zone vs the broader storm cloud.
const FLOOD_COLOR_STOPS: Array<[number, string]> = [
  [0, 'rgba(249,115,22,0)'],
  [0.2, 'rgb(249,115,22)'],
  [0.55, 'rgb(234,88,12)'],
  [0.85, 'rgb(220,38,38)'],
  [1.0, 'rgb(159,18,57)'],
];

export default function MapWeather() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapWeatherScreen />;
}

function MapWeatherScreen() {
  const theme = useTheme();
  const router = useRouter();

  // 3 icon-only toggle buttons (Figma 385:21840 → 165:21860). Cada botão
  // é simple toggle; tap liga, tap de novo desliga. `showHeatmap=true` por
  // default — screen carrega com storm radar visível (Figma default).
  // O heatmap button controla AMBAS sub-layers (tempestades + inundações)
  // simultaneamente; sem expand panel admin-style no mobile.
  const [showOperators, setShowOperators] = useState(false);
  const [showCameras, setShowCameras] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);

  // Storm (tempestades) heatmap data — 220 core + 280 halo centered on
  // USER_LOCATION. Computed once on mount; toggling the heatmap off just
  // unmounts <MapHeatmapSource> without re-shuffling the distribution.
  const stormShape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const corePoints = buildHeatmapPoints(USER_LOCATION, 220, 0.006);
    const haloPoints = buildHeatmapPoints(USER_LOCATION, 280, 0.018);
    const points = [...corePoints, ...haloPoints];
    return {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
    };
  }, []);

  // Flood (inundações) heatmap data — secondary cluster offset slightly
  // south of USER_LOCATION so it doesn't perfectly overlap the storm blob
  // when both layers are on. Narrower spread (0.004 / 0.01) produces a
  // tighter hot zone.
  const floodShape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const floodCenter: [number, number] = [
      USER_LOCATION[0] + 0.004,
      USER_LOCATION[1] - 0.008,
    ];
    const corePoints = buildHeatmapPoints(floodCenter, 140, 0.004);
    const haloPoints = buildHeatmapPoints(floodCenter, 160, 0.01);
    const points = [...corePoints, ...haloPoints];
    return {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
    };
  }, []);

  const openAlertModal = () => router.push('/modals/weather-alert');

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={USER_LOCATION} zoom={13}>
        {/* Keys explícitos: toggles condicionais (showHeatmap, showOperators,
            showCameras) shiftam posições no array de children. Sem keys o
            maplibre useFrozenId throws "id cannot be changed". Ver evacuation.tsx. */}

        {/* Storm heatmap (tempestades) — driven by `showHeatmap` toggle. */}
        {showHeatmap && (
          <MapHeatmapSource
            key="storm-heatmap"
            id="storm-heatmap"
            shape={stormShape}
            paint={{
              colorStops: STORM_COLOR_STOPS,
              intensity: 2.0,
              radius: 70,
              opacity: 0.82,
              weightProperty: 'weight',
            }}
          />
        )}

        {/* Flood heatmap (inundações) — same toggle as storm; both layers
            light up together per mobile spec (sem expand panel). */}
        {showHeatmap && (
          <MapHeatmapSource
            key="flood-heatmap"
            id="flood-heatmap"
            shape={floodShape}
            paint={{
              colorStops: FLOOD_COLOR_STOPS,
              intensity: 1.6,
              radius: 55,
              opacity: 0.78,
              weightProperty: 'weight',
            }}
          />
        )}

        {/* 11 geo-positioned alert pins (always visible, no toggle).
            Pressable wrap dispara o /modals/weather-alert em qualquer tap. */}
        {WEATHER_ALERT_PINS.map((p) => (
          <MapMarker
            key={p.id}
            id={`alert-${p.id}`}
            coordinate={[p.lng, p.lat]}
          >
            <SwiThemeProvider>
              <Pressable
                onPress={openAlertModal}
                accessibilityRole="button"
                accessibilityLabel={`Alerta ${p.status}`}
              >
                <LocationPin
                  variant="badge"
                  status={p.status}
                  size={40}
                  name={`Alerta ${p.status}`}
                />
              </Pressable>
            </SwiThemeProvider>
          </MapMarker>
        ))}

        {/* Operators overlay — 7 WORKER_LOCATIONS quando toggle ligado. */}
        {showOperators &&
          WORKER_LOCATIONS.map((m) => (
            <MapMarker
              key={m.id}
              id={`worker-${m.id}`}
              coordinate={[m.lng, m.lat]}
            >
              <SwiThemeProvider>
                <LocationPin
                  variant="avatar"
                  avatarUri={m.avatarUri}
                  status={m.status}
                  name={m.name}
                />
              </SwiThemeProvider>
            </MapMarker>
          ))}

        {/* Camera pins overlay — 12 CAMERA_LOCATIONS quando toggle ligado. */}
        {showCameras &&
          CAMERA_LOCATIONS.map((c) => (
            <MapMarker
              key={c.id}
              id={`camera-${c.id}`}
              coordinate={[c.lng, c.lat]}
            >
              <SwiThemeProvider>
                <LocationPin variant="camera" name={c.name} />
              </SwiThemeProvider>
            </MapMarker>
          ))}

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
