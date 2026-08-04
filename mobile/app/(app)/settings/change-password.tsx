import { Image as RNImage, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Title,
  Toast,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { PasswordInput } from '../../../components/PasswordInput';
import { HomeFAB } from '../../../components/HomeFAB';
import { useField } from '../../../lib/forms/useField';
import {
  validatePasswordField,
  validatePasswordMatch,
  validateRequired,
} from '../../../lib/validation/validators';

// Figma 353:12228 — settings sub-screen "Alterar senha". Form com 3
// password inputs + Toast informativo + Salvar + Home FAB. Demo
// phase: useState efêmero, sem persistência (Salvar → router.back()).
export default function SettingsChangePassword() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const currentPassword = useField({
    validator: (v) => validateRequired(v, 'Senha atual'),
  });
  const newPassword = useField({ validator: validatePasswordField });
  const repeatPassword = useField({
    validator: (v) => validatePasswordMatch(newPassword.value, v),
  });

  const pwMatches =
    newPassword.value.length > 0 && newPassword.value === repeatPassword.value;
  const canSubmit =
    currentPassword.isValid && newPassword.isValid && repeatPassword.isValid;

  const handleSave = () => {
    if (!canSubmit) {
      currentPassword.setTouched(true);
      newPassword.setTouched(true);
      repeatPassword.setTouched(true);
      return;
    }
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        <TopBar title="Alterar senha" onBack={() => router.back()} />

        <View
          style={{
            gap: theme.gap.m,
            marginTop: theme.padding.xxl,
          }}
        >
          <Title variant="title.xs" color={theme.content.primary}>
            Senha de acesso
          </Title>

          <PasswordInput
            label="Senha atual"
            value={currentPassword.value}
            onChangeText={currentPassword.onChangeText}
            onBlur={currentPassword.onBlur}
            description={currentPassword.error}
            descriptionVariant={currentPassword.error ? 'error' : 'default'}
          />
          <PasswordInput
            label="Nova senha"
            value={newPassword.value}
            onChangeText={newPassword.onChangeText}
            onBlur={newPassword.onBlur}
            description={newPassword.error}
            descriptionVariant={newPassword.error ? 'error' : 'default'}
          />
          <PasswordInput
            label="Repetir nova senha"
            value={repeatPassword.value}
            onChangeText={repeatPassword.onChangeText}
            onBlur={repeatPassword.onBlur}
            description={
              repeatPassword.error ?? (pwMatches ? 'As senhas são iguais ✓' : undefined)
            }
            descriptionVariant={
              repeatPassword.error ? 'error' : pwMatches ? 'success' : 'default'
            }
          />

          <Toast
            variant="info"
            title={
              'Sua senha precisa ter 8 caracteres incluindo letras e números\n1 símbolo @#$%ˆ\n1 Letras maiúscula'
            }
          />
        </View>
      </KeyboardAwareScrollView>

      {/* Salvar — absolute acima do Home FAB (Figma 353:12292 top:628 numa
          tela de 800; ~85px de gap antes do FAB no top:714). Fora do
          ScrollView pra preservar o spacing constante mesmo com teclado. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + 120,
          left: 0,
          right: 0,
          paddingHorizontal: theme.padding.m,
        }}
      >
        <View>
          {/* SEM `disabled={!canSubmit}` (QA Mobile #1): o handleSave já marca
              os campos como tocados pra revelar o erro de cada um, e botão
              desabilitado nunca dispara onPress — aquele bloco era código
              morto e o toque sumia no vazio.

              A validação não afrouxa: quem decide salvar continua sendo o
              `if (!canSubmit)` do handleSave. */}
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Salvar nova senha"
            elevation="lg"
            accessibilityLabel="Salvar nova senha"
            onPress={handleSave}
          />
        </View>
      </View>

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        {/* HomeFAB fiel ao Figma 348:10334 (substitui Button DS antigo). */}
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
