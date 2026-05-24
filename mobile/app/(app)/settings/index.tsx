import { Image as RNImage, Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  HorizontalCard,
  Icon,
  Text,
  useTheme,
} from '@kavicki/swi-design-system';
import { useAuth } from '../../../services/auth/AuthProvider';
import { HomeFAB } from '../../../components/HomeFAB';

// Figma 348:10615 — settings hub. Container left=16, top=40, w=328, gap.l=24,
// items-center. ScrollView pattern matches my-stats; Home FAB sits absolute
// over the safe-area bottom (matches my-stats home FAB).
const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

export default function Settings() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();

  const go = (path: Href) => () => router.push(path);

  const handleSignOut = () => {
    signOut();
    router.replace('/(auth)/login');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Background decorative overlay — Figma imgSettings.
          Same pattern as dashboard-bg.png. pointerEvents on wrapper View
          (not on RNImage) because RN ImageProps typing omits pointerEvents
          even though runtime accepts it. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.xxl,
          // 160 garante respiro entre "Sair" e o Home FAB (FAB altura ~72 +
          // bottom 24 = ~96, +64 de breathing room = 160).
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.gap.l, alignItems: 'center' }}>
          {/* Avatar + Edit float — Figma 348:10371 wrapper 106×91.
              alignItems:'center' centraliza o Avatar (80pt) dentro do wrapper
              (106pt). Sem isso, o Avatar ficava no left-start do wrapper,
              causando off-set visual ~13pt à esquerda. O Edit icon (right:0,
              top:0 absolute) continua no canto top-right do wrapper,
              overlapando o avatar no canto sup-dir (Figma intent). */}
          <View style={{ width: 106, height: 91, justifyContent: 'flex-end', alignItems: 'center' }}>
            <Avatar customSize={80} uri={avatarUri} />
            <View style={{ position: 'absolute', right: 0, top: 0 }}>
              <Button
                variant="contained"
                shape="pill"
                size="small"
                backgroundColor={theme.content.dark}
                elevation="lg"
                iconLeft={
                  <Icon
                    name="border_color"
                    width={18.182}
                    height={20}
                    color={theme.content.light}
                  />
                }
                accessibilityLabel="Editar perfil"
                onPress={go('/(app)/settings/personal-data')}
              />
            </View>
          </View>

          {/* Menu — 6 HorizontalCard, gap.m */}
          <View style={{ width: '100%', gap: theme.gap.m }}>
            <HorizontalCard label="Editar perfil"   onPress={go('/(app)/settings/personal-data')} />
            <HorizontalCard label="Dados de saúde"  onPress={go('/(app)/settings/health-data')} />
            <HorizontalCard label="Alterar senha"   onPress={go('/(app)/settings/change-password')} />
            <HorizontalCard label="Permissões"      onPress={go('/(app)/settings/preferences')} />
            <HorizontalCard label="Suporte"         onPress={go('/(app)/settings/support')} />
            <HorizontalCard label="FAQ"             onPress={go('/(app)/settings/faq')} />
          </View>

          {/* Ghost links — Montserrat Bold 14, color per role. Materialized
              as `link.m` variant (DS v0.1.80, Figma 348:10615 "GhostButton"). */}
          <Pressable
            onPress={go('/(app)/settings/privacy')}
            style={{
              height: 41,
              paddingHorizontal: theme.padding.sm,
              paddingVertical: theme.padding.s,
              borderRadius: theme.border.radius.m,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}
            accessibilityRole="link"
            accessibilityLabel="Política de privacidade e termos de uso"
          >
            <Text variant="link.m" color={theme.content.primary}>
              Política de privacidade e termos de uso
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSignOut}
            style={{
              height: 41,
              width: '100%',
              paddingHorizontal: theme.padding.sm,
              paddingVertical: theme.padding.s,
              borderRadius: theme.border.radius.m,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Sair"
          >
            <Text variant="link.m" color={theme.content.error}>
              Sair
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Home FAB — fiel ao Figma 348:10334 via HomeFAB component
          (substituiu o DS Button que renderizava ~84×84 com borda externa;
          o Figma é 71.43×71.43 com anel interno 10.286pt). */}
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
        <HomeFAB onPress={go('/(app)/dashboard')} />
      </View>
    </View>
  );
}
