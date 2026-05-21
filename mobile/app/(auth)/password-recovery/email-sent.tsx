import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Figma 290:688 — password-recovery email-confirmation-message.
// Distinct from the signup variant (211:12920): copy is "Acesse o link de
// recuperação" + "Enviamos um email para … confirmar a sua conta." (the
// Figma copy reuses "confirmar a sua conta" verbatim across both variants).
// Auto-advance to new-password simulates the user clicking the recovery link
// in the email. 4s mirrors the signup variant (consistent UX between flows).
const ADVANCE_MS = 4000;

export default function PasswordRecoveryEmailSent() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const displayEmail = email && email.length > 0 ? email : 'nomedousuario@email.com';

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace({
        pathname: '/(auth)/password-recovery/new-password',
        params: { email: email ?? '' },
      });
    }, ADVANCE_MS);
    return () => clearTimeout(t);
    // `router` from useRouter() is referentially stable across renders;
    // including it in deps re-runs this fire-and-go timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/login-bg.png')}
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
            iconName="mail"
            accessibilityLabel="Email de recuperação de senha enviado"
          />
          <Title variant="title.xs">Acesse o link de recuperação</Title>
          <Text variant="body.s" style={{ textAlign: 'center', color: theme.content.dark }}>
            Enviamos um email para{' '}
            <Text
              variant="body.s"
              italic
              style={{
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
