import { useState } from 'react';
import { Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, Title, Toast, useTheme } from '@kavicki/swi-design-system';
import { PasswordInput } from '../../../components/PasswordInput';
import { isPasswordValid } from '../../../lib/validatePassword';

export default function PasswordRecoveryNewPassword() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const pwMatches = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = isPasswordValid(password) && pwMatches;

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
          <Title variant="title.xs">Crie a sua nova senha</Title>
          <Text variant="body.m">
            Escolha uma senha segura para o seu acesso, ela deve seguir os padrões abaixo:
          </Text>

          <Toast
            variant="info"
            title="Sua senha precisa ter 8 caracteres incluindo letras e números"
            message={'1 símbolo @#$%ˆ\n1 Letras maiúscula'}
          />

          <PasswordInput
            label="Nova Senha"
            placeholder="*********"
            value={password}
            onChangeText={setPassword}
          />

          <PasswordInput
            label="Confirmar nova senha"
            placeholder="*********"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            description={pwMatches ? 'As senhas são iguais ✓' : undefined}
            descriptionVariant="success"
          />

          <Button
            variant="contained"
            label="Alterar senha"
            fullWidth
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
