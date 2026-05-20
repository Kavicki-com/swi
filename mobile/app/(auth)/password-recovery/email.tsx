import { useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, useTheme } from '@kavicki/swi-design-system';

export default function PasswordRecoveryEmail() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');

  const canSubmit = email.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Figma 290:688 — show the recovery-specific "Acesse o link de
    // recuperação" confirmation screen (distinct from the signup variant
    // 211:12920). The email-sent screen auto-advances to new-password after
    // 4s, simulating the user clicking the magic-link in their inbox.
    router.push({
      pathname: '/(auth)/password-recovery/email-sent',
      params: { email },
    });
  };

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
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 328, gap: theme.gap.l }}>
          <Title variant="title.xs">Vamos recuperar a sua senha</Title>
          <Text variant="body.m">
            Insira seu endereço de email, vamos enviar um link de recuperação para você
          </Text>
          <Input
            label="e-mail"
            placeholder="seu@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
          />
          <Button
            variant="contained"
            label="Enviar Link"
            fullWidth
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      </View>
    </View>
  );
}
