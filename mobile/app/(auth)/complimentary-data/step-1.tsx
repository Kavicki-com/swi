import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
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

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);

  const goNext = () => {
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
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 26,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 16,
          gap: theme.gap.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <OnboardingHeader username={username} />

        <StepBar total={3} current={1} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados pessoais
        </Title>

        <View style={{ gap: theme.gap.m }}>
          <Input
            label="Nome completo"
            placeholder="Seu nome completo"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            autoCapitalize="words"
          />
          <Input
            label="Telefone"
            placeholder="(00) 00000-0000"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Input
            label="CPF"
            placeholder="000.000.000-00"
            value={cpf}
            onChangeText={setCpf}
            keyboardType="number-pad"
          />
          <Input
            label="Data de nascimento"
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

        <View style={{ gap: theme.gap.sm }}>
          <Button variant="contained" label="Avançar" fullWidth onPress={goNext} />
          <Button variant="outline" label="Voltar" fullWidth onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}
