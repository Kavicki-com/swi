import { Image as RNImage, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  type LocationPinStatus,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:21840 — map-metereologic-alerts. Basemap fullscreen +
// 11 pins de status (5 good + 4 alert + 2 low) espalhados +
// 3 map controls verticais + Home FAB.
// Demo phase: basemap.png como background (weather-radar artwork do
// Figma deferred — bytes não disponíveis no asset bundle).

type AlertPin = {
  id: string;
  status: LocationPinStatus;
  offsetX: number;
  offsetY: number;
};

const PINS: AlertPin[] = [
  // Cluster top-left
  { id: 'good-1', status: 'good', offsetX: -120, offsetY: -180 },
  { id: 'alert-1', status: 'alert', offsetX: 80, offsetY: -160 },
  { id: 'good-2', status: 'good', offsetX: 100, offsetY: -100 },
  // Center cluster
  { id: 'low-1', status: 'low', offsetX: -60, offsetY: -20 },
  { id: 'alert-2', status: 'alert', offsetX: 60, offsetY: 10 },
  // Lower cluster
  { id: 'good-3', status: 'good', offsetX: -110, offsetY: 80 },
  { id: 'alert-3', status: 'alert', offsetX: 90, offsetY: 60 },
  { id: 'low-2', status: 'low', offsetX: -130, offsetY: 130 },
  { id: 'good-4', status: 'good', offsetX: 30, offsetY: 110 },
  { id: 'good-5', status: 'good', offsetX: -50, offsetY: 180 },
  { id: 'alert-4', status: 'alert', offsetX: 130, offsetY: 200 },
];

const mapControlShadow = {
  shadowColor: '#1D1D1D',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.16,
  shadowRadius: 8,
  elevation: 4,
};

export default function MapWeather() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <RNImage
          source={require('../../assets/basemap.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      {/* Pins absolute-positioned around center */}
      {PINS.map((pin) => (
        <View
          key={pin.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: [{ translateX: pin.offsetX - 20 }, { translateY: pin.offsetY - 20 }],
          }}
        >
          <LocationPin
            variant="badge"
            status={pin.status}
            size={40}
            name={`Alerta ${pin.status}`}
          />
        </View>
      ))}

      {/* Map controls — right side, vertical stack */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + theme.padding.m,
          right: theme.padding.m,
          gap: theme.gap.s,
        }}
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="button"
          accessibilityLabel="Empregados no mapa"
          style={{
            backgroundColor: theme.surface.high,
            padding: theme.padding.sm,
            borderRadius: theme.border.radius.m,
            alignItems: 'center',
            justifyContent: 'center',
            ...mapControlShadow,
          }}
        >
          <Icon name="person_apron" size={24} color={theme.content.dark} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/(app)/map')}
          accessibilityRole="button"
          accessibilityLabel="Heatmap"
          style={{
            backgroundColor: theme.surface.high,
            padding: theme.padding.sm,
            borderRadius: theme.border.radius.m,
            alignItems: 'center',
            justifyContent: 'center',
            ...mapControlShadow,
          }}
        >
          <Icon name="mode_heat" size={24} color={theme.content.dark} />
        </Pressable>
        <Pressable
          onPress={() => {}}
          accessibilityRole="button"
          accessibilityLabel="Câmeras"
          style={{
            backgroundColor: theme.surface.high,
            padding: theme.padding.sm,
            borderRadius: theme.border.radius.m,
            alignItems: 'center',
            justifyContent: 'center',
            ...mapControlShadow,
          }}
        >
          <Icon name="video_camera_back" size={24} color={theme.content.dark} />
        </Pressable>
      </View>

      {/* Home FAB — centered (sem Chat FAB nesta variant) */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
