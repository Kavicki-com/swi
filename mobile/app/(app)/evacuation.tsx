import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapChipBody } from '@/components/MapChipBody';
import { NavFABs } from '@/components/NavFABs';
import { EvacuationAckBar } from '@/components/EvacuationAckBar';
import { SITE_ROUTE } from '@/services/evacuation/types';
import { useEvacuation } from '@/services/evacuation/EvacuationProvider';
import { chipAnchors, chipEtaLabel, lineFeature, straightLine } from '@/services/evacuation/routeFormat';
import { ProdOnlyPlaceholder } from '@/components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '@/lib/featureFlags';

// Figma 385:30193 — evacuation-route (idle / "rota planejada").
//
// First screen migrated off the legacy maplibre-gl imperative wrapper onto
// the declarative MapView API that works on both react-native-web (via
// MapView.web.tsx + maplibre-gl) and native iOS/Android (via MapView.
// native.tsx + @maplibre/maplibre-react-native).
//
// On-map geo-anchored children:
//   - origin LocationPin (variant=badge, status=good)
//   - destination LocationPin (variant=badge, status=alert)
//   - 2 time chips ("6 minutos" / "17 minutos") anchored at 35% / 70% of
//     the waypoints array so they visually align with the curving polyline
//   - cyan #8AD2E2 polyline rendered via <MapLineSource>

// Theme-aware chip body extracted to components/MapChipBody.tsx (audit
// cleanup 2026-05-17) — shared with evacuation-ongoing.tsx. Note: must
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

  const { route, loadStatus, load } = useEvacuation();

  useEffect(() => { load(); }, [load]);

  // ready → rota real; error → fallback reto (mapa nunca renderiza vazio);
  // loading/idle → null (só pinos, sem linha desenhada ainda).
  const waypoints = useMemo<[number, number][] | null>(() => {
    if (route) return route.waypoints;
    if (loadStatus === 'error') return straightLine(SITE_ROUTE.origin, SITE_ROUTE.destination);
    return null;
  }, [route, loadStatus]);

  const lineShape = useMemo(() => lineFeature(waypoints ?? []), [waypoints]);
  const anchors = useMemo(() => chipAnchors(waypoints ?? []), [waypoints]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={SITE_ROUTE.origin} zoom={15}>
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
        <MapMarker key="evacuation-origin" coordinate={SITE_ROUTE.origin} id="evacuation-origin">
            <LocationPin variant="badge" status="good" size={40} name="Início da rota" />
        </MapMarker>
        <MapMarker key="evacuation-destination" coordinate={SITE_ROUTE.destination} id="evacuation-destination">
            <LocationPin variant="badge" status="alert" size={40} name="Destino" />
        </MapMarker>
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

        <NavFABs />
      </MapView>

      {/* Evacuação REAL ativa (Fase 2): CTA de confirmação de presença. */}
      <EvacuationAckBar />
    </View>
  );
}
