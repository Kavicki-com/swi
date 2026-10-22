import { useEffect, useState } from 'react';
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
import { useAuth } from '../../../services/auth/AuthProvider';
import { useField } from '../../../lib/forms/useField';
import { useSubmitOnce } from '../../../lib/forms/useSubmitOnce';
import {
  validatePasswordField,
  validatePasswordMatch,
  validateRequired,
} from '../../../lib/validation/validators';

// password inputs + Toast informativo + Salvar + Home FAB. Salvar troca a
// senha de verdade (POST /auth/password/change via useAuth); a mensagem de
// erro da API (ex.: senha atual incorreta) aparece num Toast de erro. No
// sucesso o Toast "Senha alterada." aparece e a tela volta depois dele.
//
// O botão trava enquanto a troca está no ar (useSubmitOnce) e segue travado
// depois do sucesso: um novo toque mandaria a senha antiga, que já não vale.

// Tempo para ler o aviso de sucesso antes de a tela voltar.
const BACK_AFTER_SUCCESS_MS = 2000;

export default function SettingsChangePassword() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { changePassword } = useAuth();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sair da tela antes do prazo (voltar na mão) cancela a volta agendada.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => router.back(), BACK_AFTER_SUCCESS_MS);
    return () => clearTimeout(t);
    // `router` de useRouter() é estável; só o sucesso agenda a volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

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

  const handleSave = async () => {
    if (!canSubmit) {
      currentPassword.setTouched(true);
      newPassword.setTouched(true);
      repeatPassword.setTouched(true);
      return;
    }
    setSaveError(null);
    try {
      await changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      });
      setSaved(true);
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? e.message
          : 'Não foi possível alterar a senha. Tente novamente.',
      );
    }
  };

  const { run: save, busy: saving } = useSubmitOnce(handleSave);

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

          {saveError ? <Toast variant="error" title={saveError} /> : null}
          {saved ? <Toast variant="success" title="Senha alterada." /> : null}
        </View>
      </KeyboardAwareScrollView>

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
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Salvar nova senha"
            elevation="lg"
            accessibilityLabel="Salvar nova senha"
            disabled={saving || saved}
            onPress={save}
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
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
