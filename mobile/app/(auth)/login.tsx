import { useState } from 'react';
import { useSubmitOnce } from '../../lib/forms/useSubmitOnce';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, Logo, useTheme } from '@kavicki/swi-design-system';
import { useAuth } from '../../services/auth/AuthProvider';
import { useProfile } from '../../services/profile/ProfileProvider';
import { onboardingPendente } from '../../services/profile/onboarding';
import { useField } from '../../lib/forms/useField';
import { validateEmail, validateRequired } from '../../lib/validation/validators';
import { errorMessage } from '../../lib/errors/errorMessage';

export default function Login() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { loadProfile } = useProfile();
  const email = useField({ validator: validateEmail });
  // Senha só precisa ser não-vazia (login usa credencial existente; regras de
  // formato só se aplicam ao cadastrar/trocar).
  const password = useField({
    validator: (v) => validateRequired(v, 'Senha'),
  });
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = email.isValid && password.isValid;

  const handleLogin = async () => {
    if (!canSubmit) {
      email.setTouched(true);
      password.setTouched(true);
      return;
    }
    try {
      await signIn({ email: email.value, password: password.value });
      // Fluxo 2 do cadastro (reordenação 2026-07-27): o primeiro login depois
      // da aprovação do admin desvia pro wizard de complimentary-data, agora
      // autenticado com o token do próprio worker. Perfil completo (ou wizard
      // já feito) segue direto pro dashboard. Abandonou no meio? O próximo
      // login cai aqui de novo e o que já foi salvo continua no servidor.
      let pendente = false;
      try {
        pendente = onboardingPendente(await loadProfile());
      } catch {
        // Leitura do perfil falhou (rede): não trava o login por causa do
        // desvio — o dashboard é o destino seguro.
      }
      router.replace(pendente ? '/(auth)/complimentary-data/step-1' : '/(app)/dashboard');
    } catch (e) {
      // Backend real (AUTH_BACKEND='api') lança com mensagem pronta do servidor
      // — ex.: gate de aprovação ("aguardando aprovação do administrador") ou
      // e-mail não verificado. Mostra essa mensagem quando houver (é o sinal que
      // o QA precisa distinguir); no mock nunca cai aqui.
      Alert.alert('Erro', errorMessage(e, 'Email ou senha inválidos.'));
    }
  };

  // Trava de reentrancia: `disabled={!canSubmit || enviando}` continua verdadeiro
  // enquanto a requisicao esta no ar, entao um segundo toque disparava a
  // acao de novo (QA 2026-07-27: no cadastro, o 2o toque levou 409 de
  // e-mail ja existente enquanto o 1o ja tinha criado a conta e navegado).
  const { run: enviar, busy: enviando } = useSubmitOnce(handleLogin);

  return (
    // Bg: base sólida theme.background + overlay PNG em object-cover (espelha Figma node 138:7937 — `object-cover`, sem opacity).
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        // width/height 100% explícitos: react-native-web não aplica
        // dimensões 100% automaticamente em <Image> com position:absolute +
        // top/left/right/bottom 0 — sem isso, o div/img é renderizado nas
        // dimensões NATURAIS do PNG (1920×1080) e só o canto superior-esquerdo
        // 360×800 fica visível, deslocando o gradiente vs Figma. 2026-05-18.
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
      />
      {/* KeyboardAvoidingView behavior='padding' comprime a view inteira
          quando o teclado abre — logo, inputs E botões (Entrar/Primeiro
          acesso/Suporte) ficam todos visíveis ao mesmo tempo (apertados,
          mas acessíveis). KeyboardAwareScrollView (usada em forms longos)
          scrollava pro input focado e deixava botões abaixo escondidos
          atrás do teclado — pattern inadequado pro layout compacto do
          login. iOS: padding adicionado dinamicamente; Android: sistema já
          ajusta via windowSoftInputMode (undefined = default behavior). */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* paddingTop:insets.top só pro safe area do status bar; o resto
            do espaço vertical é distribuído por flex justifyContent:'center'.
            Quando teclado abre via KAV padding, o View encolhe e o
            conteúdo (Logo + Form) RECENTRALIZA no espaço disponível,
            empurrando tudo pra cima sem corte. Antes usava paddingTop:
            insets.top + 123 + marginTop:88 rígidos — ao encolher, o
            paddingTop continuava 123, sobrando pouco espaço pra forma,
            cortando os botões abaixo. */}
        <View
          style={{
            flex: 1,
            paddingTop: insets.top,
            paddingHorizontal: theme.padding.m,
            justifyContent: 'center',
            gap: theme.gap.xxl,
          }}
        >
        <View style={{ alignSelf: 'center' }}>
          <Logo size="l" />
        </View>

        <View style={{ gap: theme.gap.l }}>
          <View style={{ gap: theme.gap.l }}>
            <Input
              {...email.bind()}
              label="Login"
              placeholder="seu@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Input
              {...password.bind()}
              label="Senha"
              placeholder="*********"
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
              onPress={enviar}
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
      </KeyboardAvoidingView>
    </View>
  );
}
