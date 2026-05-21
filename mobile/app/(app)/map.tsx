// Figma 385:28757 — map-view-general. Sprint 6 Wave 2 / B.1:
// migrates from a static basemap.png + 2 concentric SVG rings to real
// MapLibre satellite tiles (ESRI World Imagery) with 3 toggleable
// overlays (operators / heatmap / cameras). Port of the swi-admin
// canonical at swi-admin/src/pages/maps/MapsGeneral.tsx, trimmed to
// mobile scope:
//   - no admin SideMenu/Header/back-button (mobile relies on NavFABs)
//   - no useDemoToast (failures are silent console.log)
//
// Sprint 6 Wave 3: migrated off the legacy maplibre-gl imperative wrapper
// (createRoot + addSource/addLayer) onto the declarative MapView API.
// Works on both web (via MapView.web.tsx + maplibre-gl) and native
// iOS/Android (via MapView.native.tsx + @maplibre/maplibre-react-native).
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
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
  USER_AVATAR,
  USER_LOCATION,
  WORKER_LOCATIONS,
} from '@/lib/mapMockData';

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

// Productivity color ramp (cyan → green → yellow → orange → red → magenta) —
// verbatim port from swi-admin spec. Used by the heatmap layer when the
// heatmap toggle is on.
const PRODUCTIVITY_COLOR_STOPS: Array<[number, string]> = [
  [0, 'rgba(34,211,238,0)'],
  [0.08, 'rgb(34,211,238)'],
  [0.24, 'rgb(34,197,94)'],
  [0.44, 'rgb(250,204,21)'],
  [0.64, 'rgb(249,115,22)'],
  [0.84, 'rgb(220,38,38)'],
  [1.0, 'rgb(159,18,57)'],
];

export default function MapViewGeneral() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapViewGeneralScreen />;
}

function MapViewGeneralScreen() {
  const theme = useTheme();

  // Overlay toggles — 3 botões icon-only independentes (Figma 385:28853).
  // Cada botão é um simple toggle: tap liga, tap de novo desliga.
  // O botão heatmap controla AMBAS sub-layers (produtividade + zonas-alerta)
  // simultaneamente — não há expand-panel admin-style no mobile.
  const [showOperators, setShowOperators] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCameras, setShowCameras] = useState(false);

  // Two clusters fused: dense core (220 points / spread 0.006°) drives the
  // hot magenta peak; halo (280 points / spread 0.018°) widens the organic
  // blob so it spans roughly half the visible viewport at z=14. Computed
  // once on first mount — re-running on every render would shuffle the
  // distribution and make the heatmap "blink" when the user toggles other
  // overlays. Toggle off → memoized data is dropped from the shape passed
  // to <MapHeatmapSource> via the conditional render.
  const heatmapShape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={USER_LOCATION} zoom={14}>
        {/* Productivity heatmap layer — driven by `showHeatmap` toggle.
            Color ramp matches admin spec verbatim (Figma 385:28757). */}
        {/* Keys explícitos pra reconciliação estável: showHeatmap toggle
            muda composição do array de children, shifta as posições e sem
            keys o maplibre useFrozenId throws "id cannot be changed".
            Ver detalhes no comentário equivalente em evacuation.tsx. */}
        {showHeatmap && (
          <MapHeatmapSource
            key="productivity-heatmap"
            id="productivity-heatmap"
            shape={heatmapShape}
            paint={{
              colorStops: PRODUCTIVITY_COLOR_STOPS,
              intensity: 2.0,
              radius: 70,
              opacity: 0.82,
              weightProperty: 'weight',
            }}
          />
        )}

        {/* User pin (Figma 385:29023) — sempre visível em USER_LOCATION. */}
        <MapMarker key="user-pin" coordinate={USER_LOCATION} id="user-pin">
          <SwiThemeProvider>
            <LocationPin
              variant="avatar"
              avatarUri={USER_AVATAR}
              status="good"
              name="Você"
            />
          </SwiThemeProvider>
        </MapMarker>

        {/* Operator pins overlay — 7 WORKER_LOCATIONS quando toggle ligado. */}
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
