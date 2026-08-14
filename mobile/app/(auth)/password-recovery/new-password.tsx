import { useState } from 'react';
import { useSubmitOnce } from '../../../lib/forms/useSubmitOnce';
import { Alert, Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, Toast, useTheme } from '@kavicki/swi-design-system';
import { PasswordInput } from '../../../components/PasswordInput';
import { useAuth } from '../../../services/auth/AuthProvider';
import { useField } from '../../../lib/forms/useField';
import {
  validatePasswordField,
  validatePasswordMatch,
} from '../../../lib/validation/validators';
import { AUTH_BACKEND } from '../../../lib/featureFlags';
import { errorMessage } from '../../../lib/errors/errorMessage';

export default function PasswordRecoveryNewPassword() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { confirmReset } = useAuth();
  const { email } = useLocalSearchParams<{ email?: string }>();

  const password = useField({ validator: validatePasswordField });
  const confirmPassword = useField({
    validator: (v) => validatePasswordMatch(password.value, v),
  });
  const [code, setCode] = useState('');

  const pwMatches =
    password.value.length > 0 && password.value === confirmPassword.value;
  const canSubmit = password.isValid && confirmPassword.isValid;

  const handleSubmit = async () => {
    if (!canSubmit) {
      password.setTouched(true);
      confirmPassword.setTouched(true);
      return;
    }
    if (AUTH_BACKEND === 'api') {
      try { await confirmReset({ email: String(email ?? ''), code, newPassword: password.value }); }
      catch (e) { Alert.alert('Erro', errorMessage(e, 'Código inválido ou expirado.')); return; }
    }
    // Demo: recovery complete → back to login. Production would also surface
    // a "senha alterada" toast/screen before login.
    router.replace('/(auth)/login');
  };

  // Trava de reentrancia: `disabled` so cobria o formulario incompleto,
  // nao o periodo da requisicao — um segundo toque disparava de novo
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
          <Title variant="title.xs">Crie a sua nova senha</Title>
          <Text variant="body.m">
            Escolha uma senha segura para o seu acesso, ela deve seguir os padrões abaixo:
          </Text>

          <Toast
            variant="info"
            title="Sua senha precisa ter 8 caracteres incluindo letras e números"
            message={'1 símbolo @#$%ˆ\n1 Letras maiúscula'}
          />

          {AUTH_BACKEND === 'api' && (
            <Input
              label="Código de recuperação"
              placeholder="000000"
              keyboardType="numeric"
              value={code}
              onChangeText={setCode}
            />
          )}

          <PasswordInput
            label="Nova Senha"
            placeholder="*********"
            value={password.value}
            onChangeText={password.onChangeText}
            onBlur={password.onBlur}
            description={password.error}
            descriptionVariant={password.error ? 'error' : 'default'}
          />

          <PasswordInput
            label="Confirmar nova senha"
            placeholder="*********"
            value={confirmPassword.value}
            onChangeText={confirmPassword.onChangeText}
            onBlur={confirmPassword.onBlur}
            description={
              confirmPassword.error ?? (pwMatches ? 'As senhas são iguais ✓' : undefined)
            }
            descriptionVariant={
              confirmPassword.error ? 'error' : pwMatches ? 'success' : 'default'
            }
          />

          <Button
            variant="contained"
            label="Alterar senha"
            fullWidth
            onPress={enviar}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
