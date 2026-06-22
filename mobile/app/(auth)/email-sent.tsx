import { useEffect, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { useAuth } from '../../services/auth/AuthProvider';
import { AUTH_BACKEND } from '../../lib/featureFlags';

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
  const { confirmSignUp } = useAuth();
  const [code, setCode] = useState('');

  useEffect(() => {
    // Mock-only auto-advance: simulates the user clicking the confirmation
    // link in their inbox. In amplify mode the user types the emailed code
    // into the field below and presses "Confirmar conta".
    if (AUTH_BACKEND !== 'mock') return;
    const t = setTimeout(() => {
      // Forward `email` to account-confirmation so it can complete the
      // session (signIn) before redirecting into the wizard. The signup
      // chain depends on this — see R-1 in 2026-05-17-mobile-routes-audit.md.
      router.replace({
        pathname: '/(auth)/account-confirmation',
        params: { username: username ?? '', email: email ?? '' },
      });
    }, ADVANCE_MS);
    return () => clearTimeout(t);
    // `router` from useRouter() is referentially stable across renders;
    // including it in deps re-runs this fire-and-go timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, email]);

  const handleConfirm = async () => {
    try {
      await confirmSignUp({ email: email ?? '', code });
      // Phase 6: post-confirm routing needs validation against a real Cognito
      // pool. A live pool may auto-sign-in and route to onboarding
      // (complimentary-data) instead of bouncing back to login.
      router.replace('/(auth)/login');
    } catch {
      Alert.alert('Erro', 'Código inválido ou expirado.');
    }
  };

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
            iconName="mail"
            iconSize={48}
            iconColor={theme.content.light}
            accessibilityLabel="Email de confirmação enviado"
          />
          <Title variant="title.xs">Confirme sua conta pelo email</Title>
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

          {AUTH_BACKEND === 'amplify' && (
            <View style={{ width: '100%', gap: theme.gap.l }}>
              <Input
                label="Código de confirmação"
                placeholder="000000"
                keyboardType="numeric"
                value={code}
                onChangeText={setCode}
              />
              <Button
                variant="contained"
                label="Confirmar conta"
                fullWidth
                onPress={handleConfirm}
              />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
