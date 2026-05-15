import { useState } from 'react';
import { Image as RNImage, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  Input,
  Title,
  Toast,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 353:12228 — settings sub-screen "Alterar senha". Form com 3
// password inputs + Toast informativo + Salvar + Home FAB. Demo
// phase: useState efêmero, sem persistência (Salvar → router.back()).
export default function SettingsChangePassword() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);

  const visibilityToggle = (visible: boolean, onToggle: () => void) => (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
    >
      <Icon
        name={visible ? 'visibility_off' : 'visibility'}
        size={24}
        color={theme.content.dark}
      />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/settings-change-password-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="Alterar senha" onBack={() => router.back()} />

        <View
          style={{
            width: 328,
            gap: theme.gap.m,
            marginTop: theme.padding.xxl,
            alignItems: 'stretch',
          }}
        >
          <Title variant="title.xs" color={theme.content.primary}>
            Senha de acesso
          </Title>

          <Input
            label="Senha atual"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry={!showCurrent}
            autoCapitalize="none"
            autoCorrect={false}
            iconRight={visibilityToggle(showCurrent, () => setShowCurrent((v) => !v))}
          />
          <Input
            label="Nova senha"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNew}
            autoCapitalize="none"
            autoCorrect={false}
            iconRight={visibilityToggle(showNew, () => setShowNew((v) => !v))}
          />
          <Input
            label="Repetir nova senha"
            value={repeatPassword}
            onChangeText={setRepeatPassword}
            secureTextEntry={!showRepeat}
            autoCapitalize="none"
            autoCorrect={false}
            iconRight={visibilityToggle(showRepeat, () => setShowRepeat((v) => !v))}
          />

          <Toast
            variant="info"
            title={
              'Sua senha precisa ter 8 caracteres incluindo letras e números\n1 símbolo @#$%ˆ\n1 Letras maiúscula'
            }
          />

          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Salvar nova senha"
            elevation="lg"
            accessibilityLabel="Salvar nova senha"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>

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
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
