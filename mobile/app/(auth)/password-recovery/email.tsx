import { Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { useField } from '../../../lib/forms/useField';
import { validateEmail } from '../../../lib/validation/validators';

export default function PasswordRecoveryEmail() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const email = useField({ validator: validateEmail });

  const canSubmit = email.isValid;

  const handleSubmit = () => {
    if (!canSubmit) {
      email.setTouched(true);
      return;
    }
    // Figma 290:688 — show the recovery-specific "Acesse o link de
    // recuperação" confirmation screen (distinct from the signup variant
    // 211:12920). The email-sent screen auto-advances to new-password after
    // 4s, simulating the user clicking the magic-link in their inbox.
    router.push({
      pathname: '/(auth)/password-recovery/email-sent',
      params: { email: email.value },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingHorizontal: theme.padding.m,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={60}
        enableOnAndroid
      >
        <View style={{ width: '100%', gap: theme.gap.l }}>
          <Title variant="title.xs">Vamos recuperar a sua senha</Title>
          <Text variant="body.m">
            Insira seu endereço de email, vamos enviar um link de recuperação para você
          </Text>
          <Input
            {...email.bind()}
            label="e-mail"
            placeholder="seu@email.com"
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
      </KeyboardAwareScrollView>
    </View>
  );
}
