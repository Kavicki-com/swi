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
  Text,
  useTheme,
  type IconName,
  type LocationPinStatus,
} from '@kavicki/swi-design-system';
import { useLocation } from '@/services/location/LocationProvider';
import { useProfile } from '@/services/profile/ProfileProvider';
import { useVitals } from '@/services/vitals/VitalsProvider';
import type { WorkerStatus } from '@/services/vitals/types';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapHeatmapSource } from '@/components/MapHeatmapSource';
import { NavFABs } from '@/components/NavFABs';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { circleFeature, destinationPoint } from '@/lib/mapGeometry';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  CAMERA_LOCATIONS,
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
): { lng: number; lat: number; weight: number }[] {
  const pts: { lng: number; lat: number; weight: number }[] = [];
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
const PRODUCTIVITY_COLOR_STOPS: [number, string][] = [
  [0, 'rgba(34,211,238,0)'],
  [0.08, 'rgb(34,211,238)'],
  [0.24, 'rgb(34,197,94)'],
  [0.44, 'rgb(250,204,21)'],
  [0.64, 'rgb(249,115,22)'],
  [0.84, 'rgb(220,38,38)'],
  [1.0, 'rgb(159,18,57)'],
];

// Map the domain WorkerStatus to the DS LocationPin status. good/alert/low pass
// through; 'unknown' (empty/stale/error/loading) → 'offline' (DS-supported).
function toPinStatus(status: WorkerStatus): LocationPinStatus {
  return status === 'unknown' ? 'offline' : status;
}

// Anéis de distância em volta de quem está usando o app (Figma 385:29130).
// A distância é o dado, e o desenho é consequência: `meters` alimenta tanto a
// geometria quanto o rótulo, então os dois não têm como divergir. Antes o par
// era `width: 395`/`647` px com o texto "5KM"/"10KM" digitado à mão do lado —
// duas verdades separadas, e a do texto quebrava em todo zoom (QA Mobile #10).
const RADIUS_RINGS = [
  { meters: 5000, label: '5KM', opacity: 0.9 },
  { meters: 10000, label: '10KM', opacity: 0.75 },
] as const;

export default function MapViewGeneral() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapViewGeneralScreen />;
}

function MapViewGeneralScreen() {
  const theme = useTheme();
  // Real GPS coords (falls back to mock when permission denied / no fix yet)
  // + live worker status drive the user's own pin. Other pins stay mock.
  const { coords } = useLocation();
  const { profile } = useProfile();
  const { status } = useVitals();

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
  // Counts reduzidos pela metade (Fix 9 do cliente — preventivo, alinhado
  // com map-weather): 220+280=500 features × intensity 2.0 × radius 70 era
  // pesado pra GPUs mid-range Android. 110+140=250 mantém densidade visual.
  const heatmapShape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const corePoints = buildHeatmapPoints(USER_LOCATION, 110, 0.006);
    const haloPoints = buildHeatmapPoints(USER_LOCATION, 140, 0.018);
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

  // Anéis + âncora do rótulo, recalculados quando chega uma posição nova do
  // GPS. O centro é a posição REAL de quem está usando (a mesma do pino), não
  // o centro da tela: arrastar o mapa não pode mudar de onde a distância é
  // medida.
  const radiusRings = useMemo(
    () =>
      RADIUS_RINGS.map((r) => ({
        ...r,
        ring: circleFeature(coords, r.meters),
        // Rumo 180 = sul. O rótulo pousa na borda sul do anel, como no Figma,
        // e agora anda junto com ela em qualquer zoom.
        labelAt: destinationPoint(coords, 180, r.meters),
      })),
    [coords],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={coords} zoom={14}>
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

        {/* Anéis de 5 e 10 km (Figma 385:29130) — geometria de mapa, não
            overlay de tela: o MapLibre projeta o anel em cada frame, então
            ele acompanha zoom e arrasto e o rótulo continua verdadeiro.
            `width` fica em pixels de propósito (a espessura do traço não
            deve engordar com o zoom; só o raio é que é distância).
            Vêm ANTES dos pinos pra ficarem por baixo deles. */}
        {radiusRings.map((r) => (
          <MapLineSource
            key={`radius-${r.meters}`}
            id={`radius-${r.meters}`}
            shape={r.ring}
            paint={{ color: theme.content.dark, width: 2, opacity: r.opacity }}
          />
        ))}
        {radiusRings.map((r) => (
          <MapMarker
            key={`radius-${r.meters}-label`}
            id={`radius-${r.meters}-label`}
            coordinate={r.labelAt}
          >
            <RadiusPill label={r.label} theme={theme} />
          </MapMarker>
        ))}

        {/* User pin (Figma 385:29023) — real GPS coords + live worker status
            (unknown → 'offline'). Other pins stay mock. */}
        <MapMarker key="user-pin" coordinate={coords} id="user-pin">
            <LocationPin
              variant="avatar"
              // Foto real do perfil. As coordenadas sempre foram reais (GPS do
              // aparelho), mas o rosto era um PNG de estoque — o pino mostrava
              // outra pessoa na posição do usuário (QA 2026-07-26).
              avatarUri={profile?.avatarUrl ?? ''}
              status={toPinStatus(status)}
              name="Você"
            />
        </MapMarker>

        {/* Operator pins overlay — 7 WORKER_LOCATIONS quando toggle ligado. */}
        {showOperators &&
          WORKER_LOCATIONS.map((m) => (
            <MapMarker
              key={m.id}
              id={`worker-${m.id}`}
              coordinate={[m.lng, m.lat]}
            >
                <LocationPin
                  variant="avatar"
                  avatarUri={m.avatarUri}
                  status={m.status}
                  name={m.name}
                />
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
                <LocationPin variant="camera" name={c.name} />
            </MapMarker>
          ))}

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

// Pill verde (Figma 385:29133 / 385:29134) — chip estreito com o label
// "5KM"/"10KM". Ancorado pelo <MapMarker> no ponto geográfico da borda sul
// do anel, então não posiciona a si mesmo: some o `offsetY` que media a
// distância até o centro da tela.
//
// O translateX de -28 sobrevive porque é outra coisa: deslocamento de RÓTULO
// em espaço de tela, o mesmo que o Figma desenha (o pill fica um pouco a
// oeste da vertical do centro). Ficar constante em qualquer zoom é o
// comportamento certo pra um rótulo — quem tem que ser distância é o raio.
function RadiusPill({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View
      pointerEvents="none"
      style={{
        backgroundColor: theme.surface.primary,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        transform: [{ translateX: -28 }],
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
        // boxShadow só tem efeito no RN-web; no native a sombra vem de elevation.
        boxShadow: '0px 4px 8px rgba(29, 29, 29, 0.16)',
      }}
    >
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={iconName} width={iconWidth} height={iconHeight} color={theme.content.dark} />
      </View>
    </Pressable>
  );
}
