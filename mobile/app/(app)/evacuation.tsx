import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { Feature, LineString } from 'geojson';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { MapView } from '@/components/MapView';
import { MapMarker } from '@/components/MapMarker';
import { MapLineSource } from '@/components/MapLineSource';
import { MapChipBody } from '@/components/MapChipBody';
import { NavFABs } from '@/components/NavFABs';
import {
  EVACUATION_DESTINATION,
  EVACUATION_ORIGIN,
} from '@/lib/mapMockData';
import { getEvacuationRoute } from '@/lib/evacuationRouteCache';
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
//
// OSRM resilience: getEvacuationRoute() falls back to a 5-point linear
// interpolation when OSRM is unreachable — the screen still renders.

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

  const [waypoints, setWaypoints] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvacuationRoute().then((route) => {
      if (!cancelled) setWaypoints(route.waypoints);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const lineShape = useMemo<Feature<LineString> | null>(() => {
    if (!waypoints || waypoints.length === 0) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: waypoints },
    };
  }, [waypoints]);

  // Sample at 35% / 70% so the time chips align with the curving polyline
  // rather than its straight-line midpoint. Figma copy is preserved verbatim.
  const chipAnchors = useMemo<{ a: [number, number]; b: [number, number] } | null>(() => {
    if (!waypoints || waypoints.length === 0) return null;
    const i1 = Math.min(Math.max(Math.floor(waypoints.length * 0.35), 0), waypoints.length - 1);
    const i2 = Math.min(Math.max(Math.floor(waypoints.length * 0.7), 0), waypoints.length - 1);
    return { a: waypoints[i1], b: waypoints[i2] };
  }, [waypoints]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MapView center={EVACUATION_ORIGIN} zoom={15}>
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
        <MapMarker key="evacuation-origin" coordinate={EVACUATION_ORIGIN} id="evacuation-origin">
          <SwiThemeProvider>
            <LocationPin variant="badge" status="good" size={40} name="Início da rota" />
          </SwiThemeProvider>
        </MapMarker>
        <MapMarker key="evacuation-destination" coordinate={EVACUATION_DESTINATION} id="evacuation-destination">
          <SwiThemeProvider>
            <LocationPin variant="badge" status="alert" size={40} name="Destino" />
          </SwiThemeProvider>
        </MapMarker>
        {chipAnchors && (
          <MapMarker key="evacuation-chip-1" coordinate={chipAnchors.a} id="evacuation-chip-1">
            <SwiThemeProvider>
              <MapChipBody text="6 minutos" />
            </SwiThemeProvider>
          </MapMarker>
        )}
        {chipAnchors && (
          <MapMarker key="evacuation-chip-2" coordinate={chipAnchors.b} id="evacuation-chip-2">
            <SwiThemeProvider>
              <MapChipBody text="17 minutos" />
            </SwiThemeProvider>
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
    </View>
  );
}
