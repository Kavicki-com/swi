import { useState } from 'react';
import { Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  ImageUploader,
  Input,
  StepBar,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { OnboardingHeader } from '../../../components/OnboardingHeader';

export default function ComplimentaryDataStep1() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  // Figma 211:13009 mostra Nome completo "já preenchido" — esse é o estado
  // intencional: o usuário acabou de digitar fullName na step de signup e
  // esse valor flui via `username` param. Pré-popular evita re-typing.
  const [fullName, setFullName] = useState(username ?? '');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);

  // Required fields per Figma: nome, telefone, CPF, data nascimento. Foto fica
  // opcional (avatar default cobre quem não envia). Match com o padrão
  // canSubmit/disabled que já existe em sign-up.tsx/login.tsx — ver R-10 em
  // 2026-05-17-mobile-routes-audit.md.
  const canSubmit =
    fullName.trim().length > 0 &&
    phone.trim().length > 0 &&
    cpf.trim().length > 0 &&
    birthDate.trim().length > 0;

  const goNext = () => {
    if (!canSubmit) return;
    router.push({
      pathname: '/(auth)/complimentary-data/step-2',
      params: { username },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 26,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.xl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={60}
        enableOnAndroid
      >
        <OnboardingHeader username={username} />

        <StepBar total={3} current={1} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados pessoais
        </Title>

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
            label="Telefone"
            labelWeight="regular"
            placeholder="(00) 00000-0000"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Input
            label="CPF"
            labelWeight="regular"
            placeholder="000.000.000-00"
            value={cpf}
            onChangeText={setCpf}
            keyboardType="number-pad"
          />
          <Input
            label="Data de nascimento"
            labelWeight="regular"
            placeholder="dd/mm/aaaa"
            value={birthDate}
            onChangeText={setBirthDate}
            keyboardType="number-pad"
          />
        </View>

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Foto de perfil
        </Title>

        <ImageUploader
          value={photo}
          onTakePhoto={() => setPhoto({ uri: 'demo://placeholder' })}
          onPickFile={() => setPhoto({ uri: 'demo://placeholder' })}
          onRemove={() => setPhoto(null)}
          helperText="Selecione arquivos do tipo: JPG ou PNG"
          takePhotoLabel="Tirar Foto"
          pickFileLabel="Enviar arquivo"
        />

        {/* Actions inside the scroll (mesmo padrão do step-3): elimina o
            problema de overlap quando o ImageUploader expande, já que os
            botões fluem naturalmente abaixo do conteúdo. */}
        <View style={{ gap: theme.gap.sm }}>
          <Button
            variant="contained"
            label="Avançar"
            fullWidth
            disabled={!canSubmit}
            onPress={goNext}
          />
          <Button variant="outline" label="Voltar" fullWidth onPress={() => router.back()} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
