import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Auto-advance to account-confirmation simulating the user clicking the
// confirmation link in the email. 4s gives enough time to read the message;
// keeps fidelity to the Figma (no extra "Já confirmei" button there).
const ADVANCE_MS = 4000;

export default function EmailSent() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { email, username } = useLocalSearchParams<{ email?: string; username?: string }>();
  const displayEmail = email && email.length > 0 ? email : 'nomedousuario@email.com';

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace({
        pathname: '/(auth)/account-confirmation',
        params: { username: username ?? '' },
      });
    }, ADVANCE_MS);
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
            iconName="mail"
            accessibilityLabel="Email de confirmação enviado"
          />
          <Title variant="title.xs">Confirme sua conta pelo email</Title>
          <Text variant="body.s" style={{ textAlign: 'center', color: theme.content.dark }}>
            Enviamos um email para{' '}
            <Text
              variant="body.s"
              style={{
                fontStyle: 'italic',
                color: theme.content.secondaryLight,
              }}
            >
              {displayEmail}
            </Text>{' '}
            acesse sua caixa de entrada e clique no link para confirmar a sua conta.
          </Text>
        </View>
      </View>
    </View>
  );
}
