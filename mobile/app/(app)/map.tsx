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
} from '@kavicki/swi-design-system';
import { useLocation } from '@/services/location/LocationProvider';
import { getPositionsBackend } from '@/services/positions/getPositionsBackend';
import { usePolledRead } from '@/services/positions/usePolledRead';
import { useProfile } from '@/services/profile/ProfileProvider';
import { workerStatusOf } from '@/services/vitals/dashboardVitalsView';
import { useMyTelemetry } from '@/services/vitals/MyTelemetryProvider';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapHeatmapSource } from '@/components/MapHeatmapSource';
import { NavFABs } from '@/components/NavFABs';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { circleFeature, destinationPoint } from '@/lib/mapGeometry';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { useCameraPoints } from '@/services/cameras/useCameraPoints';
import { toPinStatus } from '@/lib/mapPins';
import { heatShapeFromCells } from '@/lib/positionHeat';
import { useMapViewport } from '@/lib/useMapViewport';

// O calor é agregado de 24 horas: reler a cada poucos minutos já acompanha.
// Depois de uma falha, a nova tentativa não espera esses minutos todos.
const HEAT_REFRESH_MS = 5 * 60_000;
const HEAT_RETRY_MS = 30_000;

const readHeat = () => getPositionsBackend().heat();

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

// A distância é o dado, e o desenho é consequência: `meters` alimenta tanto a
// geometria quanto o rótulo, então os dois não têm como divergir. Antes o par
// era `width: 395`/`647` px com o texto "5KM"/"10KM" digitado à mão do lado —
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
  // Posição do GPS (null sem permissão ou sem leitura) e estado de saúde lido
  // de me/current desenham o pino de quem usa. Sem posição não há pino próprio nem anéis.
  const { coords } = useLocation();
  const { profile } = useProfile();
  const status = workerStatusOf(useMyTelemetry().telemetry);

  // Cada botão é um simple toggle: tap liga, tap de novo desliga.
  // O botão heatmap controla AMBAS sub-layers (produtividade + zonas-alerta)
  // simultaneamente — não há expand-panel admin-style no mobile.
  const [showOperators, setShowOperators] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCameras, setShowCameras] = useState(false);

  // Colegas da mesma empresa, com a última posição recente e só o estado de
  // saúde. Sem posição própria são eles que o mapa enquadra.
  const { viewport, colleagues } = useMapViewport(coords, showOperators);
  // Presença agregada da empresa nas últimas 24 horas, em células.
  const heat = usePolledRead(showHeatmap, readHeat, HEAT_REFRESH_MS, HEAT_RETRY_MS);
  // Pontos de câmera cadastrados no painel, lidos quando a camada liga.
  const cameras = useCameraPoints(showCameras);

  // A forma só muda quando chega leitura nova: religar outro overlay não
  // refaz a camada de calor.
  const heatmapShape = useMemo(
    () => (heat.data ? heatShapeFromCells(heat.data.cells) : null),
    [heat.data],
  );

  // Anéis + âncora do rótulo, recalculados quando chega uma posição nova do
  // GPS. O centro é a posição REAL de quem está usando (a mesma do pino), não
  // o centro da tela: arrastar o mapa não pode mudar de onde a distância é
  // medida. Sem posição não há de onde medir, então não há anel.
  const radiusRings = useMemo(
    () =>
      coords
        ? RADIUS_RINGS.map((r) => ({
            ...r,
            ring: circleFeature(coords, r.meters),
            // e agora anda junto com ela em qualquer zoom.
            labelAt: destinationPoint(coords, 180, r.meters),
          }))
        : [],
    [coords],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView {...viewport} zoom={14}>
        {/* Keys explícitos pra reconciliação estável: showHeatmap toggle
            muda composição do array de children, shifta as posições e sem
            keys o maplibre useFrozenId throws "id cannot be changed".
            Ver detalhes no comentário equivalente em evacuation.tsx. */}
        {heatmapShape && heatmapShape.features.length > 0 && (
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

        {coords && (
          <MapMarker key="user-pin" coordinate={coords} id="user-pin">
              <LocationPin
                variant="avatar"
                avatarUri={profile?.avatarUrl ?? ''}
                status={toPinStatus(status)}
                name="Você"
              />
          </MapMarker>
        )}

        {/* Operator pins overlay: os colegas lidos do backend, quando ligado. */}
        {showOperators &&
          colleagues?.map((c) => (
            <MapMarker
              key={`worker-${c.id}`}
              id={`worker-${c.id}`}
              coordinate={[c.lng, c.lat]}
            >
                <LocationPin
                  variant="avatar"
                  avatarUri={c.avatar}
                  status={toPinStatus(c.status)}
                  name={c.name}
                />
            </MapMarker>
          ))}

        {/* Camera pins overlay: as câmeras cadastradas da empresa, quando ligado. */}
        {showCameras &&
          cameras.data?.map((c) => (
            <MapMarker
              key={c.id}
              id={`camera-${c.id}`}
              coordinate={[c.lng, c.lat]}
            >
                <LocationPin variant="camera" name={c.name} />
            </MapMarker>
          ))}

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

// "5KM"/"10KM". Ancorado pelo <MapMarker> no ponto geográfico da borda sul
// do anel, então não posiciona a si mesmo: some o `offsetY` que media a
// distância até o centro da tela.
//
// O translateX de -28 sobrevive porque é outra coisa: deslocamento de RÓTULO
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

// button quadrado 48×48. Background muda de `surface.high` (off) pra cor
// de destaque (`activeColor`) quando ligado. Drop-shadow `elevation-lg`
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
        // boxShadow vale no web e, desde a new arch (RN 0.76+), também no native.
        boxShadow: '0px 4px 8px rgba(29, 29, 29, 0.16)',
      }}
    >
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={iconName} width={iconWidth} height={iconHeight} color={theme.content.dark} />
      </View>
    </Pressable>
  );
}
