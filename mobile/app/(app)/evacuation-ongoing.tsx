import { Image as RNImage, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:30336 — evacuation-route-ongoing. Basemap fullscreen +
// LocationPin (destination alert) + 2 time chips + Chat/Home FABs.
// Demo phase: basemap.png como background; route line + navigation
// arrow (vector8/navigation assets) deferidos pra Phase 2.

export default function EvacuationOngoing() {
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

      {/* Destination pin (alert) */}
      <View
        style={{
          position: 'absolute',
          top: '42%',
          left: '70%',
          transform: [{ translateX: -20 }, { translateY: -20 }],
        }}
      >
        <LocationPin variant="badge" status="alert" size={40} name="Destino" />
      </View>

      {/* Time chip: 6 minutos — junto à origem/centro */}
      <View
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: [{ translateX: -28 }, { translateY: -10 }],
          backgroundColor: theme.background,
          paddingHorizontal: theme.padding.xs,
          paddingVertical: theme.padding.xs,
          borderRadius: theme.border.radius.s,
        }}
      >
        <RNText
          style={{
            fontFamily: theme.fontFamily.body,
            fontWeight: theme.fontWeight.medium,
            fontSize: theme.fontSize.sm,
            color: theme.content.dark,
          }}
        >
          6 minutos
        </RNText>
      </View>

      {/* Time chip: 17 minutos — junto ao destino */}
      <View
        style={{
          position: 'absolute',
          top: '46%',
          left: '78%',
          transform: [{ translateX: -32 }, { translateY: -10 }],
          backgroundColor: theme.background,
          paddingHorizontal: theme.padding.xs,
          paddingVertical: theme.padding.xs,
          borderRadius: theme.border.radius.s,
        }}
      >
        <RNText
          style={{
            fontFamily: theme.fontFamily.body,
            fontWeight: theme.fontWeight.medium,
            fontSize: theme.fontSize.sm,
            color: theme.content.dark,
          }}
        >
          17 minutos
        </RNText>
      </View>

      {/* Chat FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          right: theme.padding.m,
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.surface.success}
          elevation="lg"
          iconLeft={
            <Icon
              name="chat_bubble"
              width={25.714}
              height={25.714}
              color={theme.content.light}
            />
          }
          accessibilityLabel="Abrir chat"
          onPress={() => router.push('/(app)/chat/inbox')}
        />
      </View>

      {/* Home FAB */}
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
