import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Checkbox,
  Icon,
  Input,
  Text,
  Toast,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Password rules per Figma toast (211:12899):
// - 8 characters, letters and numbers
// - 1 symbol @#$%ˆ
// - 1 uppercase letter
function validatePassword(pw: string) {
  return {
    length: pw.length >= 8,
    lettersAndNumbers: /[A-Za-z]/.test(pw) && /[0-9]/.test(pw),
    symbol: /[@#$%^]/.test(pw),
    uppercase: /[A-Z]/.test(pw),
  };
}

export default function SignUp() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const pwChecks = useMemo(() => validatePassword(password), [password]);
  const pwMatches = confirmPassword.length > 0 && password === confirmPassword;
  const pwIsValid = Object.values(pwChecks).every(Boolean);
  const canSubmit =
    fullName.length > 0 && email.length > 0 && pwIsValid && pwMatches && agreed;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Demo flow: sign-up → email-sent (wait for click) → account-confirmation
    // (success). In production the email link deep-links to confirmation; in the
    // demo, email-sent has a manual "Já confirmei" affordance to advance.
    // Pass `username` forward so account-confirmation can hand it to the
    // complimentary-data flow ("Boas vindas {username}!").
    const username = fullName.trim().split(/\s+/)[0] ?? '';
    router.push({
      pathname: '/(auth)/email-sent',
      params: { email, username },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: 48, alignItems: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: 328, gap: theme.gap.xl }}>
          <Title variant="title.xs">Crie a sua conta</Title>

          <Text variant="body.m">
            Insira suas informações para acessar as funcionalidades do app
          </Text>

          <View style={{ gap: theme.gap.m }}>
            <Input
              label="Nome completo"
              placeholder="Seu nome completo"
              value={fullName}
              onChangeText={setFullName}
              autoComplete="name"
              autoCapitalize="words"
            />

            <Input
              label="Email"
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />

            <Input
              label="Crie uma senha"
              placeholder="*********"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              iconRight={
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  hitSlop={8}
                >
                  <Icon
                    name={showPassword ? 'visibility_off' : 'visibility'}
                    size={22}
                    color={theme.content.dark}
                  />
                </Pressable>
              }
            />

            <Input
              label="Confirme sua senha"
              placeholder="*********"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              description={pwMatches ? 'As senhas são iguais ✓' : undefined}
              descriptionVariant="success"
              iconRight={
                <Pressable
                  onPress={() => setShowConfirmPassword((s) => !s)}
                  accessibilityLabel={
                    showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'
                  }
                  hitSlop={8}
                >
                  <Icon
                    name={showConfirmPassword ? 'visibility_off' : 'visibility'}
                    size={22}
                    color={theme.content.dark}
                  />
                </Pressable>
              }
            />
          </View>

          <Toast
            variant="info"
            title="Sua senha precisa ter 8 caracteres incluindo letras e números"
            message={'1 símbolo @#$%ˆ\n1 Letras maiúscula'}
          />

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
      </ScrollView>
    </View>
  );
}
