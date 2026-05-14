import { Image as RNImage, Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  HorizontalCard,
  Icon,
  Text,
  useTheme,
} from '@kavicki/swi-design-system';

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

  const go = (path: string) => () => router.push(path as never);

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
          source={require('../../../assets/settings-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.xxl,
          paddingBottom: insets.bottom + 120,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: 328, gap: theme.gap.l, alignItems: 'center' }}>
          {/* Avatar + Edit float — Figma 348:10371 wrapper 106×91 */}
          <View style={{ width: 106, height: 91, justifyContent: 'flex-end' }}>
            <Avatar customSize={80} uri={avatarUri} bordered borderWidth={3} />
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

          {/* Ghost links — Montserrat Bold 14, color per role.
              Gap K: DS lacks Button variant="ghost" / label.s text variant. */}
          <Pressable
            onPress={go('/(app)/settings/privacy')}
            style={{
              height: 41,
              paddingHorizontal: theme.padding.sm,
              paddingVertical: theme.padding.s,
              borderRadius: theme.border.radius.m,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="link"
            accessibilityLabel="Política de privacidade e termos de uso"
          >
            <Text
              style={{
                fontFamily: theme.fontFamily.title,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.m,
                color: theme.content.primary,
              }}
            >
              Política de privacidade e termos de uso
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.replace('/(auth)/login' as never)}
            style={{
              height: 41,
              width: '100%',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: theme.border.radius.m,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Sair"
          >
            <Text
              style={{
                fontFamily: theme.fontFamily.title,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.m,
                color: theme.content.error,
              }}
            >
              Sair
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Home FAB — same pattern as my-stats home FAB */}
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
              width={30.857}
              height={30.857}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={go('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
