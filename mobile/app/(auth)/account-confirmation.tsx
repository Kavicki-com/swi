import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Auto-redirect timer per Figma description "Você será redirecionado para a
// tela inicial". 2.5s gives the user time to register the success state and
// matches the "feels intentional, not too snappy" rhythm of similar flows.
const REDIRECT_MS = 2500;

export default function AccountConfirmation() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  useEffect(() => {
    const t = setTimeout(() => {
      // Account just confirmed → onboarding (complimentary-data). Dashboard
      // is the final destination after the 3-step flow completes (in step-3).
      router.replace({
        pathname: '/(auth)/complimentary-data/step-1',
        params: { username: username ?? '' },
      });
    }, REDIRECT_MS);
    return () => clearTimeout(t);
  }, [router, username]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 328, gap: theme.gap.l, alignItems: 'center' }}>
          <SuccessBadge
            iconName="check"
            accessibilityLabel="Conta criada com sucesso"
          />
          <Title variant="title.xs">Conta criada com sucesso!</Title>
          <Text variant="body.s" style={{ textAlign: 'center', color: theme.content.medium }}>
            Você será redirecionado para a tela inicial
          </Text>
        </View>
      </View>
    </View>
  );
}
