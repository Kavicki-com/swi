import { useMemo, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, Text, Title, Toast, useTheme } from '@kavicki/swi-design-system';

// Password rules per Figma toast (138:7959), identical to sign-up:
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

export default function PasswordRecoveryNewPassword() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const pwChecks = useMemo(() => validatePassword(password), [password]);
  const pwIsValid = Object.values(pwChecks).every(Boolean);
  const pwMatches = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = pwIsValid && pwMatches;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Demo: recovery complete → back to login. Production would also surface
    // a "senha alterada" toast/screen before login.
    router.replace('/(auth)/login');
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
          <Title variant="title.xs">Crie a sua nova senha</Title>
          <Text variant="body.m">
            Escolha uma senha segura para o seu acesso, ela deve seguir os padrões abaixo:
          </Text>

          <Toast
            variant="info"
            title="Sua senha precisa ter 8 caracteres incluindo letras e números"
            message={'1 símbolo @#$%ˆ\n1 Letras maiúscula'}
          />

          <Input
            label="Nova Senha"
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
            label="Confirmar nova senha"
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

          <Button
            variant="contained"
            label="Alterar senha"
            fullWidth
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      </View>
    </View>
  );
}
