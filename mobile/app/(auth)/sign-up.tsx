import { useState } from 'react';
import { Image, View } from 'react-native';
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

export default function SignUp() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);

  const pwMatches = confirmPassword.length > 0 && password === confirmPassword;
  // Demo phase: regras estritas de senha (8 chars + maiúscula + número + símbolo)
  // removidas pra agilizar testes. Confirmação `pwMatches` mantida como UX
  // (evita digitação descuidada).
  const canSubmit =
    fullName.length > 0 && email.length > 0 && password.length > 0 && pwMatches && agreed;

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
              label="Nome completo"
              labelWeight="regular"
              placeholder="Seu nome completo"
              value={fullName}
              onChangeText={setFullName}
              autoComplete="name"
              autoCapitalize="words"
            />

            <Input
              label="Email"
              labelWeight="regular"
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
            />

            <PasswordInput
              label="Crie uma senha"
              labelWeight="regular"
              placeholder="*********"
              value={password}
              onChangeText={setPassword}
            />

            <PasswordInput
              label="Confirme sua senha"
              labelWeight="regular"
              placeholder="*********"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              description={pwMatches ? 'As senhas são iguais ✓' : undefined}
              descriptionVariant="success"
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
