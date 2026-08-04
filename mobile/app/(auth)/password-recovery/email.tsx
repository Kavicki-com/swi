import { Alert, Image, View } from 'react-native';
import { useSubmitOnce } from '../../../lib/forms/useSubmitOnce';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { useAuth } from '../../../services/auth/AuthProvider';
import { useField } from '../../../lib/forms/useField';
import { validateEmail } from '../../../lib/validation/validators';
import { AUTH_BACKEND } from '../../../lib/featureFlags';
import { errorMessage } from '../../../lib/errors/errorMessage';

export default function PasswordRecoveryEmail() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { resetPassword } = useAuth();
  const email = useField({ validator: validateEmail });

  const canSubmit = email.isValid;

  const handleSubmit = async () => {
    if (!canSubmit) {
      email.setTouched(true);
      return;
    }
    if (AUTH_BACKEND === 'api') {
      try { await resetPassword({ email: email.value }); }
      catch (e) { Alert.alert('Erro', errorMessage(e, 'Não foi possível enviar o código.')); return; }
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

  // Trava de reentrancia: `disabled` so cobria o formulario incompleto,
  // nao o periodo da requisicao — um segundo toque disparava de novo
  // (QA 2026-07-27, no fim do cadastro).
  const { run: enviar } = useSubmitOnce(handleSubmit);

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
        bottomOffset={60}
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
          {/* SEM `disabled={!canSubmit}` (QA Mobile #1): o handleSubmit já
              marca o campo como tocado pra revelar o erro, e botão
              desabilitado nunca dispara onPress — aquele bloco era código
              morto e o toque sumia no vazio.

              A trava de duplo envio não cai junto: ela vive no useSubmitOnce
              (`enviar`), que foi criado justamente porque o disabled era
              insuficiente pra isso. */}
          <Button
            variant="contained"
            label="Enviar Link"
            fullWidth
            onPress={enviar}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
