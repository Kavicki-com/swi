import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, StepBar, Title, useTheme } from '@kavicki/swi-design-system';
import { OnboardingHeader } from '../../../components/OnboardingHeader';

export default function ComplimentaryDataStep2() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [uf, setUf] = useState('');

  const goNext = () => {
    router.push({
      pathname: '/(auth)/complimentary-data/step-3',
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

        <StepBar total={3} current={2} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados de endereço
        </Title>

        <View style={{ gap: theme.gap.m }}>
          <Input
            label="CEP"
            placeholder="00000-000"
            value={cep}
            onChangeText={setCep}
            keyboardType="number-pad"
            autoComplete="postal-code"
          />
          <Input
            label="Logradouro"
            placeholder="Avenida Quatro de Julho"
            value={street}
            onChangeText={setStreet}
            autoComplete="street-address"
          />
          <Input
            label="Número"
            placeholder="00"
            value={number}
            onChangeText={setNumber}
            keyboardType="number-pad"
          />
          <Input
            label="Bairro"
            placeholder="Pampulha"
            value={neighborhood}
            onChangeText={setNeighborhood}
          />
          <Input
            label="UF"
            placeholder="MG"
            value={uf}
            onChangeText={setUf}
            autoCapitalize="characters"
            maxLength={2}
          />
        </View>

        <View style={{ gap: theme.gap.sm }}>
          <Button variant="contained" label="Avançar" fullWidth onPress={goNext} />
          <Button variant="outline" label="Voltar" fullWidth onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}
