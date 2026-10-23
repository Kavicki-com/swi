import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LocationPin,
  Toast,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapChipBody } from '@/components/MapChipBody';
import { NavFABs } from '@/components/NavFABs';
import { EvacuationAckBar } from '@/components/EvacuationAckBar';
import { useEvacuationRoute } from '@/services/evacuation/useEvacuationRoute';
import { useLeaveWhenEvacuationEnds } from '@/services/evacuation/useLeaveWhenEvacuationEnds';
import {
  chipAnchors, chipEtaLabel, lineFeature, navArrow, navArrowAt, routeNotice,
} from '@/services/evacuation/routeFormat';
import { BRAZIL_BOUNDS, boundsAround } from '@/lib/mapGeometry';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';

//
// Migrated off the legacy maplibre-gl imperative wrapper onto the
// declarative MapView API (matches evacuation.tsx). Works on both web
// (via MapView.web.tsx + maplibre-gl) and native iOS/Android (via
// MapView.native.tsx + @maplibre/maplibre-react-native).
//
// On-map geo-anchored children:
//   - Purple #BC88FF polyline (em-andamento color, vs cyan idle)
//   - Destination pin only (user IS the origin in this state): o ponto de
//     encontro que o gestor marcou
//   - Navigation arrow marker (teal #50B3D2) na posição do GPS, apontando pro
//     próximo waypoint; sem GPS, a ~30% da rota como antes
//   - 2 time chips ("6 minutos" / "17 minutos") at 35% / 70%
//

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
  const insets = useSafeAreaInsets();

  const { route: liveRoute, errorKind, coords, ended } = useEvacuationRoute();
  const leave = useLeaveWhenEvacuationEnds(ended);
  // Encerrada pelo gestor, a tela sai do modo evacuação: nada de rota, seta,
  // chips ou confirmação de chegada de uma evacuação que já acabou. Fica o
  // aviso, e a tela volta ao início sozinha.
  const route = ended ? null : liveRoute;

  // Sem rota não há linha, seta nem chips: navegar por traçado inventado leva
  // pro lugar errado. O aviso no topo diz o que fazer no lugar.
  const waypoints = route?.waypoints ?? null;
  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const arrow = useMemo(
    () => (coords ? navArrowAt(coords, waypoints ?? []) : navArrow(waypoints ?? [])),
    [coords, waypoints],
  );
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);
  const notice = routeNotice(route, errorKind);

  // Com rota, o meio do caminho; sem rota, enquadra a pessoa (ou o Brasil) por
  // `bounds`, porque no web o `center` só vale quando aparece pela 1ª vez.
  const center = route ? midpoint(route.origin, route.destination) : undefined;
  const frame = useMemo(
    () => (coords ? boundsAround([coords]) : null) ?? BRAZIL_BOUNDS,
    [coords],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={center} zoom={15} bounds={frame}>
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
        {route && (
          <MapMarker key="evacuation-destination" coordinate={route.destination} id="evacuation-destination">
              <LocationPin variant="badge" status="alert" size={40} name="Ponto de encontro" />
          </MapMarker>
        )}
        {arrow && (
          <MapMarker key="evacuation-nav-arrow" coordinate={arrow.at} id="evacuation-nav-arrow">
              <NavArrowBody rotationDeg={arrow.rotation} />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-ongoing-chip-1" coordinate={anchors.a} id="evacuation-ongoing-chip-1">
              <MapChipBody text={chipEtaLabel(route?.durationSec, 0.35)} />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-ongoing-chip-2" coordinate={anchors.b} id="evacuation-ongoing-chip-2">
              <MapChipBody text={chipEtaLabel(route?.durationSec, 0.7)} />
          </MapMarker>
        )}

        {/* Aviso fixo (sem fechar): numa evacuação a frase É a instrução. O
            Toast é o do DS, como está; `box-none` deixa o toque passar. */}
        {ended && (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + theme.padding.s,
              left: theme.padding.m,
              right: theme.padding.m,
            }}
          >
            <Toast
              variant="success"
              title="Evacuação encerrada"
              message="O gestor encerrou a evacuação. Voltando ao início."
              action={{
                label: 'Voltar ao início',
                accessibilityLabel: 'Voltar ao início',
                onPress: leave,
              }}
              testID="evacuation-ended-notice"
            />
          </View>
        )}
        {!ended && notice && (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + theme.padding.s,
              left: theme.padding.m,
              right: theme.padding.m,
            }}
          >
            <Toast variant={notice.variant} title={notice.text} testID="evacuation-route-notice" />
          </View>
        )}

        <NavFABs />
      </MapView>

      {!ended && <EvacuationAckBar />}
    </View>
  );
}
