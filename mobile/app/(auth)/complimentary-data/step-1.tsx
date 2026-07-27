import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
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
import { useField } from '../../../lib/forms/useField';
import {
  validateBirthDate,
  validateCPF,
  validateFullName,
  validatePhone,
} from '../../../lib/validation/validators';
import {
  maskBirthDate,
  maskCPF,
  maskPhone,
} from '../../../lib/validation/masks';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { errorMessage } from '../../../lib/errors/errorMessage';

export default function ComplimentaryDataStep1() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  // Figma 211:13009 mostra Nome completo "já preenchido" — esse é o estado
  // intencional: o usuário acabou de digitar fullName na step de signup e
  // esse valor flui via `username` param. Pré-popular evita re-typing.
  const fullName = useField({
    initial: username ?? '',
    validator: validateFullName,
  });
  const phone = useField({ validator: validatePhone, mask: maskPhone });
  const cpf = useField({ validator: validateCPF, mask: maskCPF });
  const birthDate = useField({
    validator: validateBirthDate,
    mask: maskBirthDate,
  });
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);
  const media = useMediaPicker();
  const { saveProfile } = useProfile();

  // Required: nome, telefone, CPF, data nascimento. Foto fica opcional (avatar
  // default cobre quem não envia).
  const canSubmit =
    fullName.isValid && phone.isValid && cpf.isValid && birthDate.isValid;

  const goNext = async () => {
    if (!canSubmit) {
      fullName.setTouched(true);
      phone.setTouched(true);
      cpf.setTouched(true);
      birthDate.setTouched(true);
      return;
    }
    try {
      // Phase 6: birthDate is masked DD/MM/YYYY but Profile.birthDate is
      // AWSDate YYYY-MM-DD — convert (DD/MM/YYYY → YYYY-MM-DD) before the
      // amplify path is exercised. Mock stores the raw string fine.
      await saveProfile({
        fullName: fullName.value,
        phone: phone.value,
        cpf: cpf.value,
        birthDate: birthDate.value,
      });
    } catch (e) {
      Alert.alert('Erro', errorMessage(e, 'Não foi possível salvar seus dados.'));
      return;
    }
    router.push({
      pathname: '/(auth)/complimentary-data/step-2',
      params: { username },
    });
  };

  const handleTakePhoto = async () => {
    const uri = await media.takePhoto();
    if (uri) setPhoto({ uri });
  };
  const handlePickFile = async () => {
    const uri = await media.pickFromGallery();
    if (uri) setPhoto({ uri });
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
        bottomOffset={60}
      >
        <OnboardingHeader username={username} />

        <StepBar total={3} current={1} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados pessoais
        </Title>

        <View style={{ gap: theme.gap.m }}>
          <Input
            {...fullName.bind()}
            label="Nome completo"
            labelWeight="regular"
            placeholder="Seu nome completo"
            autoComplete="name"
            autoCapitalize="words"
          />
          <Input
            {...phone.bind()}
            label="Telefone"
            labelWeight="regular"
            placeholder="(00) 00000-0000"
            keyboardType="phone-pad"
            autoComplete="tel"
            maxLength={15}
          />
          <Input
            {...cpf.bind()}
            label="CPF"
            labelWeight="regular"
            placeholder="000.000.000-00"
            keyboardType="number-pad"
            maxLength={14}
          />
          <Input
            {...birthDate.bind()}
            label="Data de nascimento"
            labelWeight="regular"
            placeholder="dd/mm/aaaa"
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Foto de perfil
        </Title>

        <ImageUploader
          value={photo}
          onTakePhoto={handleTakePhoto}
          onPickFile={handlePickFile}
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
