import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { useAuth } from '../../services/auth/AuthProvider';

// Auto-redirect timer per Figma description "Você será redirecionado para a
// tela inicial". 2.5s gives the user time to register the success state and
// matches the "feels intentional, not too snappy" rhythm of similar flows.
const REDIRECT_MS = 2500;

export default function AccountConfirmation() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username, email } = useLocalSearchParams<{ username?: string; email?: string }>();
  const { signIn } = useAuth();

  useEffect(() => {
    // Confirmation is the moment the user is considered "signed in" in the
    // demo flow — sign-up doesn't authenticate, so without this call the
    // post-onboarding redirect to /(app)/dashboard would bounce back to login.
    // Production: a real backend would mint a session at the confirmation
    // link click and the client would receive a token here.
    if (email && email.length > 0) {
      signIn(email);
    }

    const t = setTimeout(() => {
      // Account just confirmed → onboarding (complimentary-data). Dashboard
      // is the final destination after the 3-step flow completes (in step-3).
      router.replace({
        pathname: '/(auth)/complimentary-data/step-1',
        params: { username: username ?? '' },
      });
    }, REDIRECT_MS);
    return () => clearTimeout(t);
    // `router` from useRouter() is referentially stable across renders;
    // including it in deps re-runs this fire-and-go timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, email, signIn]);

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
          paddingHorizontal: theme.padding.m,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: '100%', gap: theme.gap.l, alignItems: 'center' }}>
          <SuccessBadge
            iconName="check_circle"
            iconColor={theme.content.light}
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
