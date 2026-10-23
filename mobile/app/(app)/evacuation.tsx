import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  Text,
  Title,
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
import { chipAnchors, chipEtaLabel, lineFeature, routeNotice } from '@/services/evacuation/routeFormat';
import { BRAZIL_BOUNDS, boundsAround } from '@/lib/mapGeometry';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';

//
// First screen migrated off the legacy maplibre-gl imperative wrapper onto
// the declarative MapView API that works on both react-native-web (via
// MapView.web.tsx + maplibre-gl) and native iOS/Android (via MapView.
// native.tsx + @maplibre/maplibre-react-native).
//
// On-map geo-anchored children:
//   - origin LocationPin (variant=badge, status=good): o GPS da pessoa, ou a
//     origem que o backend usou (última posição real) quando não há GPS
//   - destination LocationPin (variant=badge, status=alert): o ponto de
//     encontro que o gestor marcou ao iniciar a evacuação
//   - 2 time chips ("6 minutos" / "17 minutos") anchored at 35% / 70% of
//     the waypoints array so they visually align with the curving polyline
//   - cyan #8AD2E2 polyline rendered via <MapLineSource>

// Theme-aware chip body extracted to components/MapChipBody.tsx (audit
// remain wrapped in <SwiThemeProvider> when rendered as a maplibre-gl
// marker child on web (the detached React root doesn't inherit theme).

export default function EvacuationRoute() {
  if (!isFeatureEnabled('maps')) {
    return <ProdOnlyPlaceholder />;
  }
  return <EvacuationRouteScreen />;
}

function EvacuationRouteScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { route: liveRoute, errorKind, coords, ended } = useEvacuationRoute();
  const leave = useLeaveWhenEvacuationEnds(ended);
  // Encerrada pelo gestor, a tela sai do modo evacuação: nada de rota, pinos
  // ou confirmação de chegada de uma evacuação que já acabou. Fica o aviso, e
  // a tela volta ao início sozinha.
  const route = ended ? null : liveRoute;

  // Sem rota não há linha nem chips: traçado inventado numa tela de segurança
  // guiaria a pessoa pro lugar errado. O aviso diz o que fazer no lugar.
  const waypoints = route?.waypoints ?? null;
  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);
  const notice = routeNotice(route, errorKind);

  const origin = ended ? null : (coords ?? route?.origin ?? null);
  // Com rota, centra na origem dela. Sem rota ainda, enquadra a pessoa (ou o
  // Brasil sem GPS) por `bounds`: no web o `center` só vale quando aparece pela
  // primeira vez, então ele fica guardado pra quando a rota chegar.
  const frame = useMemo(
    () => (coords ? boundsAround([coords]) : null) ?? BRAZIL_BOUNDS,
    [coords],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={route?.origin} zoom={15} bounds={frame}>
        {/* On-map declarative children (partitioned into the native <Map>
            by MapView.native, attached imperatively by MapView.web). */}
        {/* `key` em cada child do <Map> é OBRIGATÓRIO mesmo quando não está
            num map(). Sem keys, React reconcilia por POSIÇÃO no array — quando
            `lineShape` muda null→object, lineSource aparece em slot 0 e shifta
            os Markers; o Marker que estava em slot 1 (destination) recebe os
            props de origin sem remount → maplibre useFrozenId throws "id
            cannot be changed". Keys explícitos fixam reconciliação por
            identidade. */}
        {lineShape && (
          <MapLineSource
            key="evacuation-route"
            id="evacuation-route"
            shape={lineShape}
            paint={{ color: '#8AD2E2', width: 4, opacity: 0.95 }}
          />
        )}
        {origin && (
          <MapMarker key="evacuation-origin" coordinate={origin} id="evacuation-origin">
              <LocationPin variant="badge" status="good" size={40} name="Início da rota" />
          </MapMarker>
        )}
        {route && (
          <MapMarker key="evacuation-destination" coordinate={route.destination} id="evacuation-destination">
              <LocationPin variant="badge" status="alert" size={40} name="Ponto de encontro" />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-chip-1" coordinate={anchors.a} id="evacuation-chip-1">
              <MapChipBody text={chipEtaLabel(route?.durationSec, 0.35)} />
          </MapMarker>
        )}
        {anchors && (
          <MapMarker key="evacuation-chip-2" coordinate={anchors.b} id="evacuation-chip-2">
              <MapChipBody text={chipEtaLabel(route?.durationSec, 0.7)} />
          </MapMarker>
        )}

        {/* UI overlay (renders in the absolute-positioned layer above the
            map on both platforms). */}
        <View
          style={{
            position: 'absolute',
            top: insets.top + theme.padding.m,
            left: theme.padding.m,
            right: theme.padding.m,
            alignItems: 'center',
          }}
        >
          <Title variant="title.xs" color={theme.content.dark}>
            Procedimento de evacuação
          </Title>
        </View>

        {ended && (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + 80,
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

        {!ended && (
          <View
            style={{
              position: 'absolute',
              top: insets.top + 80,
              left: theme.padding.m,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 259,
                backgroundColor: theme.surface.standard,
                borderRadius: 16,
                padding: theme.padding.m,
                gap: theme.gap.m,
                alignItems: 'center',
                shadowColor: theme.shadow.color,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.16,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Icon name="turn_right" size={24} color={theme.content.dark} />
              <Title
                variant="title.xs"
                color={theme.content.success}
                style={{ textAlign: 'center' }}
              >
                Rota de evacuação
              </Title>
              <Text
                variant="body.s"
                color={theme.content.dark}
                style={{ textAlign: 'center' }}
              >
                A rota traçada garante seu retorno em segurança, se precisar ajudar outras pessoas primeiro encontre um abrigo seguro para se proteger
              </Text>
              {notice && (
                <Text
                  variant="body.s"
                  color={notice.variant === 'error' ? theme.content.error : theme.content.warning}
                  style={{ textAlign: 'center' }}
                  accessibilityRole="alert"
                >
                  {notice.text}
                </Text>
              )}
              <Button
                variant="contained"
                backgroundColor={theme.surface.success}
                labelColor={theme.content.light}
                label="Continuar"
                elevation="lg"
                accessibilityLabel="Continuar evacuação"
                onPress={() => router.push('/(app)/evacuation-ongoing')}
              />
            </View>
          </View>
        )}

        <NavFABs />
      </MapView>

      {!ended && <EvacuationAckBar />}
    </View>
  );
}
