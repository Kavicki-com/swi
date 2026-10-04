// mobile/app/(app)/map-weather.tsx
//
// Mapa de clima: o radar de chuva real (IMERG, via NASA GIBS) sobre o mapa de
// satélite, com os colegas e as câmeras como camadas opcionais. Nada aqui é
// sorteado: sem leitura do radar a camada não aparece.
//
// Works on both web (via MapView.web.tsx + maplibre-gl) and native
// iOS/Android (via MapView.native.tsx + @maplibre/maplibre-react-native).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Icon,
  LocationPin,
  Surface,
  Text,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { useLocation } from '@/services/location/LocationProvider';
import { usePolledRead } from '@/services/positions/usePolledRead';
import {
  RAIN_RADAR_MAX_ZOOM,
  RAIN_RADAR_TILE_SIZE,
  latestRainRadarTime,
  rainRadarLabel,
  rainRadarTiles,
} from '@/services/weather/rainRadar';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapRasterSource } from '@/components/MapRasterSource';
import { NavFABs } from '@/components/NavFABs';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { BRAZIL_BOUNDS, boundsCenter } from '@/lib/mapGeometry';
import { useCameraPoints } from '@/services/cameras/useCameraPoints';
import { toPinStatus } from '@/lib/mapPins';
import { useMapViewport } from '@/lib/useMapViewport';

// O radar tem cerca de 10 km por quadrado. No zoom de rua a tela inteira cabe
// dentro de um quadrado só; no 7 aparecem uns 400 km em volta e dá para ver a
// chuva chegando.
const WEATHER_ZOOM = 7;

// O GIBS publica um horário novo a cada 30 minutos. Depois de uma falha, a
// nova tentativa vem em um minuto, sem esperar a meia hora.
const RADAR_REFRESH_MS = 30 * 60_000;
const RADAR_RETRY_MS = 60_000;
const RADAR_OPACITY = 0.7;

const readRadarTime = () => latestRainRadarTime();

export default function MapWeather() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <MapWeatherScreen />;
}

function MapWeatherScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { coords } = useLocation();

  // é simple toggle; tap liga, tap de novo desliga. `showRadar=true` por
  // useEffect (defer pattern). Montar camada no mesmo frame do MapView GL
  // init crashava o libmaplibre.so em GPUs Android mid-range (POCO/rodin
  // observado em produção). Fix 9 do cliente.
  const [showOperators, setShowOperators] = useState(false);
  const [showCameras, setShowCameras] = useState(false);
  const [showRadar, setShowRadar] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowRadar(true), 300);
    return () => clearTimeout(t);
  }, []);

  // Horário da observação mais recente do radar. Relido a cada meia hora; se a
  // releitura falha, a última observação lida segue na tela com a hora dela.
  const radar = usePolledRead(showRadar, readRadarTime, RADAR_REFRESH_MS, RADAR_RETRY_MS);
  const radarTiles = useMemo(() => (radar.data ? [rainRadarTiles(radar.data)] : null), [radar.data]);

  // Pontos de câmera cadastrados no painel, lidos quando a camada liga.
  const cameras = useCameraPoints(showCameras);

  // Mesma regra do mapa geral: sem GPS, são os colegas que dão o enquadramento.
  const { viewport: frame, colleagues } = useMapViewport(coords, showOperators);
  // Aqui o enquadramento dos colegas vira só o centro: fechar o mapa em volta
  // deles deixaria o radar sem leitura, pelo mesmo motivo do WEATHER_ZOOM.
  const viewport =
    'center' in frame || frame.bounds === BRAZIL_BOUNDS
      ? frame
      : { center: boundsCenter(frame.bounds) };

  const radarNote = radar.data
    ? rainRadarLabel(radar.data)
    : radar.failed
      ? 'Radar de chuva indisponível'
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView {...viewport} zoom={WEATHER_ZOOM}>
        {/* Keys explícitos: toggles condicionais (showRadar, showOperators,
            showCameras) shiftam posições no array de children. Sem keys o
            maplibre useFrozenId throws "id cannot be changed". Ver evacuation.tsx.
            A key e o id do radar levam o horário: observação nova é uma fonte
            nova, que nunca disputa o id com a que está saindo. */}
        {radar.data && radarTiles && (
          <MapRasterSource
            key={`rain-radar-${radar.data}`}
            id={`rain-radar-${radar.data}`}
            tiles={radarTiles}
            tileSize={RAIN_RADAR_TILE_SIZE}
            maxzoom={RAIN_RADAR_MAX_ZOOM}
            opacity={RADAR_OPACITY}
          />
        )}

        {/* Operators overlay: os colegas lidos do backend, quando ligado. */}
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

        {/* De quando é a chuva desenhada. O dado chega com horas de atraso,
            então a camada nunca aparece sem a hora dela. */}
        {radarNote && (
          <Surface
            variant="high"
            padding="s"
            radius="m"
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: insets.top + theme.padding.sm,
              left: theme.padding.m,
            }}
          >
            <Text variant="body.m" color={theme.content.dark}>
              {radarNote}
            </Text>
          </Surface>
        )}

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
            active={showRadar}
            activeColor={theme.surface.warning}
            accessibilityLabel="Radar de chuva"
            onPress={() => setShowRadar((v) => !v)}
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

      <NavFABs showChat={false} />
    </View>
  );
}

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
