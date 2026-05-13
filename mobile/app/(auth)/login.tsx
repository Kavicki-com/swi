import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, Logo, useTheme } from '@kavicki/swi-design-system';
import { useAuth } from '../../services/auth/AuthProvider';

export default function Login() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = email.length > 0 && password.length > 0;

  const handleLogin = () => {
    if (!canSubmit) return;
    signIn(email);
    router.replace('/(app)/dashboard');
  };

  return (
    // Bg: base sólida theme.background + overlay PNG em object-cover (espelha Figma node 138:7937 — `object-cover`, sem opacity).
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View style={{ flex: 1, paddingTop: insets.top + 123, alignItems: 'center' }}>
        <Logo size="l" />

        {/* Form top deve ficar em 275px (Figma) — 123 paddingTop + 64 Logo height + 88 marginTop = 275. */}
        <View style={{ width: 328, marginTop: 88, gap: theme.gap.l }}>
          <View style={{ gap: theme.gap.l }}>
            <Input
              label="Login"
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Input
              label="Senha"
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
          </View>

          <View style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="ghost"
              label="Recuperar senha"
              onPress={() => router.push('/(auth)/password-recovery/email')}
            />
          </View>

          <View style={{ gap: theme.gap.sm }}>
            <Button
              variant="contained"
              label="Entrar"
              fullWidth
              disabled={!canSubmit}
              onPress={handleLogin}
            />
            <Button
              variant="outline"
              label="Primeiro acesso"
              fullWidth
              onPress={() => router.push('/(auth)/sign-up')}
            />
          </View>

          <Button
            variant="ghost"
            label="Suporte"
            fullWidth
            onPress={() => router.push('/modals/support-form')}
          />
        </View>
      </View>
    </View>
  );
}
