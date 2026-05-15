import { Image as RNImage, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  LocationPin,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:30193 — evacuation-route. Basemap + título topo +
// 2 LocationPin (start good + destination alert) + 2 time chips +
// instruction card centrado (turn_right + Rota de evacuação +
// Continuar) + FABs.
// Demo phase: basemap.png como background; route line SVG omitida
// (Phase 2). Continuar → /evacuation-ongoing.

export default function EvacuationRoute() {
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
          top: '55%',
          left: '40%',
          transform: [{ translateX: -20 }, { translateY: -20 }],
        }}
      >
        <LocationPin variant="badge" status="good" size={40} name="Início da rota" />
      </View>

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

      {/* Instruction card */}
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
            shadowColor: '#1D1D1D',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.16,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Icon name="turn_right" size={24} color={theme.content.dark} />
          <RNText
            style={{
              fontFamily: theme.fontFamily.title,
              fontWeight: theme.fontWeight.bold,
              fontSize: theme.fontSize.ms,
              color: theme.content.success,
              textAlign: 'center',
            }}
          >
            Rota de evacuação
          </RNText>
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.medium,
              fontSize: theme.fontSize.sm,
              color: theme.content.dark,
              textAlign: 'center',
            }}
          >
            A rota traçada garante seu retorno em segurança, se precisar ajudar outras pessoas primeiro encontre um abrigo seguro para se proteger
          </RNText>
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
