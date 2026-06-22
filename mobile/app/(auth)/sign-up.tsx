import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Checkbox,
  Input,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { PasswordInput } from '../../components/PasswordInput';
import { useAuth } from '../../services/auth/AuthProvider';
import { useField } from '../../lib/forms/useField';
import {
  validateEmail,
  validateFullName,
  validatePasswordField,
  validatePasswordMatch,
} from '../../lib/validation/validators';

export default function SignUp() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const fullName = useField({ validator: validateFullName });
  const email = useField({ validator: validateEmail });
  const password = useField({ validator: validatePasswordField });
  const confirmPassword = useField({
    validator: (v) => validatePasswordMatch(password.value, v),
  });
  const [agreed, setAgreed] = useState(false);

  const pwMatches =
    password.value.length > 0 && password.value === confirmPassword.value;
  const canSubmit =
    fullName.isValid &&
    email.isValid &&
    password.isValid &&
    confirmPassword.isValid &&
    agreed;

  const handleSubmit = async () => {
    if (!canSubmit) {
      fullName.setTouched(true);
      email.setTouched(true);
      password.setTouched(true);
      confirmPassword.setTouched(true);
      return;
    }
    // Demo flow: sign-up → email-sent (wait for click) → account-confirmation
    // (success). In production the email link deep-links to confirmation; in the
    // demo, email-sent has a manual "Já confirmei" affordance to advance.
    const username = fullName.value.trim().split(/\s+/)[0] ?? '';
    try {
      await signUp({ email: email.value, password: password.value, name: fullName.value.trim() });
      router.push({ pathname: '/(auth)/email-sent', params: { email: email.value, username } });
    } catch {
      Alert.alert('Erro', 'Não foi possível criar a conta.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: 48, paddingHorizontal: theme.padding.m }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={60}
        enableOnAndroid
      >
        <View style={{ gap: theme.gap.xl }}>
          <Title variant="title.xs">Crie a sua conta</Title>

          <Text variant="body.m">
            Insira suas informações para acessar as funcionalidades do app
          </Text>

          <View style={{ gap: theme.gap.m }}>
            <Input
              {...fullName.bind()}
              label="Nome completo"
              labelWeight="regular"
              placeholder="Seu nome completo"
              autoComplete="name"
              autoCapitalize="words"
            />

            <Input
              {...email.bind()}
              label="Email"
              labelWeight="regular"
              placeholder="seu@email.com"
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />

            <PasswordInput
              label="Crie uma senha"
              labelWeight="regular"
              placeholder="*********"
              value={password.value}
              onChangeText={password.onChangeText}
              onBlur={password.onBlur}
              description={password.error}
              descriptionVariant={password.error ? 'error' : 'default'}
            />

            <PasswordInput
              label="Confirme sua senha"
              labelWeight="regular"
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
          </View>

          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            label="Eu estou de acordo com as políticas e termos de uso descritos no link abaixo"
            size="s"
          />

          <Button
            variant="ghost"
            label="Política de privacidade & Termos de uso"
            underline
            labelFamily="body"
            labelWeight="regular"
            fullWidth
            onPress={() => router.push('/modals/privacy-policy')}
          />

          <View style={{ gap: theme.gap.sm }}>
            <Button
              variant="contained"
              label="Criar conta"
              fullWidth
              disabled={!canSubmit}
              onPress={handleSubmit}
            />
            <Button
              variant="outline"
              label="Voltar"
              fullWidth
              onPress={() => router.back()}
            />
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
