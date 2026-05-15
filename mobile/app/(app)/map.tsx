import { Image as RNImage, Pressable, Text as RNText, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:28757 — map-view-general. Basemap fullscreen + LocationPin
// centrado + 2 raios concêntricos (5KM/10KM) + 3 map controls verticais
// à direita (employee/heatmap/cameras) + Chat FAB + Home FAB.
// Demo phase: basemap estático (basemap.png); sem MapLibre/MapBox real
// no mobile (no admin sim). Map controls são no-op toggles visuais.

const avatarUri = Asset.fromModule(
  require('../../assets/avatar-construction.png'),
).uri;

const mapControlShadow = {
  shadowColor: '#1D1D1D',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.16,
  shadowRadius: 8,
  elevation: 4,
};

export default function MapViewGeneral() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Basemap fullscreen */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <RNImage
          source={require('../../assets/basemap.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      {/* 2 raios concêntricos centrados — 5KM (inner) e 10KM (outer) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: -324 }, { translateY: -324 }],
          width: 648,
          height: 648,
        }}
      >
        {/* 10KM outer ring */}
        <View
          style={{
            position: 'absolute',
            width: 648,
            height: 648,
            borderRadius: 324,
            borderWidth: 1,
            borderColor: 'rgba(245,245,245,0.5)',
          }}
        />
        {/* 10KM chip — bottom of outer ring */}
        <View
          style={{
            position: 'absolute',
            top: 633,
            left: 295,
            backgroundColor: theme.surface.primary,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
          }}
        >
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.light,
            }}
          >
            10KM
          </RNText>
        </View>

        {/* 5KM inner ring */}
        <View
          style={{
            position: 'absolute',
            width: 396,
            height: 396,
            borderRadius: 198,
            borderWidth: 1,
            borderColor: 'rgba(245,245,245,0.5)',
            top: 126,
            left: 126,
          }}
        />
        {/* 5KM chip — bottom of inner ring */}
        <View
          style={{
            position: 'absolute',
            top: 508,
            left: 295,
            backgroundColor: theme.surface.primary,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
          }}
        >
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.light,
            }}
          >
            5KM
          </RNText>
        </View>

        {/* Worker LocationPin centrado */}
        <LocationPin
          variant="avatar"
          avatarUri={avatarUri}
          size={40}
          accessibilityLabel="Sua localização"
        />
      </View>

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
          onPress={() => {}}
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

      {/* Home FAB — centered */}
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
