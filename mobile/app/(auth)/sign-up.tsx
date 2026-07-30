import { useEffect, useState } from 'react';
import { useSubmitOnce } from '../../lib/forms/useSubmitOnce';
import { Alert, Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Checkbox,
  Combobox,
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
import { listCompanies, type CompanyOption } from '../../services/api/companies';
import { errorMessage } from '../../lib/errors/errorMessage';
import { AUTH_BACKEND } from '../../lib/featureFlags';

// Só o fluxo api tem empresas reais pra escolher; no mock o seletor some e o
// fluxo fica idêntico ao anterior.
const NEEDS_COMPANY = AUTH_BACKEND === 'api';

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

  // Empresa do cadastro: o vínculo é o que coloca o worker na fila de
  // aprovação org-scoped do painel (QA 2026-07-26).
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companiesError, setCompaniesError] = useState(false);
  useEffect(() => {
    if (!NEEDS_COMPANY) return;
    let cancelled = false;
    listCompanies()
      .then((list) => {
        if (!cancelled) setCompanies(list);
      })
      .catch(() => {
        // Sem a lista o cadastro não anda mesmo (a API está fora do ar) —
        // mostra o aviso inline em vez de deixar submeter um vínculo vazio.
        if (!cancelled) setCompaniesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pwMatches =
    password.value.length > 0 && password.value === confirmPassword.value;
  const canSubmit =
    fullName.isValid &&
    email.isValid &&
    password.isValid &&
    confirmPassword.isValid &&
    (!NEEDS_COMPANY || companyId.length > 0) &&
    agreed;

  const handleSubmit = async () => {
    if (!canSubmit) {
      fullName.setTouched(true);
      email.setTouched(true);
      password.setTouched(true);
      confirmPassword.setTouched(true);
      return;
    }
    // Fluxo 1 (reordenado 2026-07-27): a conta nasce AQUI, com nome, e-mail,
    // senha e empresa. Segue pra confirmação de e-mail e daí pra fila de
    // aprovação do painel. O wizard de perfil (complimentary-data) virou o
    // fluxo 2: roda DEPOIS do primeiro login pós-aprovação, autenticado com o
    // token do próprio worker — a ordem antiga rodava o wizard sem conta, e um
    // token alheio esquecido gravava o perfil na conta errada (incidente
    // 2026-07-27, "Teste Ricardo" × "Joao Tester").
    const params = {
      email: email.value,
      password: password.value,
      name: fullName.value.trim(),
      ...(companyId ? { companyId } : {}),
    };

    try {
      await signUp(params);
      router.push({ pathname: '/(auth)/email-sent', params: { email: email.value } });
    } catch (e) {
      // O motivo vem do servidor ("E-mail já cadastrado", "Empresa não
      // encontrada") — sem ele o cliente relê o formulário sem achar o erro.
      Alert.alert('Erro', errorMessage(e, 'Não foi possível criar a conta.'));
    }
  };

  // Trava de reentrancia: `disabled={!canSubmit || enviando}` continua verdadeiro
  // enquanto a requisicao esta no ar, entao um segundo toque disparava a
  // acao de novo (QA 2026-07-27: no cadastro, o 2o toque levou 409 de
  // e-mail ja existente enquanto o 1o ja tinha criado a conta e navegado).
  const { run: enviar, busy: enviando } = useSubmitOnce(handleSubmit);

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
        bottomOffset={60}
      >
        <View style={{ gap: theme.gap.xl }}>
          <Title variant="title.xs">Crie a sua conta</Title>

          <Text variant="body.m">
            Insira suas informações para acessar as funcionalidades do app
          </Text>

          <View style={{ gap: theme.gap.m }}>
            {NEEDS_COMPANY ? (
              <View>
                <Combobox
                  label="Empresa"
                  placeholder="Selecione a sua empresa"
                  options={companies.map((c) => ({ label: c.name, value: c.id }))}
                  value={companyId}
                  onChange={setCompanyId}
                  accessibilityLabel="Empresa"
                />
                {companiesError ? (
                  <Text variant="body.s" color={theme.content.error}>
                    Não foi possível carregar as empresas — verifique a conexão.
                  </Text>
                ) : null}
              </View>
            ) : null}

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
              onPress={enviar}
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
