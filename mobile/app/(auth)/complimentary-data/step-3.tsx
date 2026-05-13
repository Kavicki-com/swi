import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  GenderSelector,
  Input,
  Radio,
  StepBar,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import type { GenderValue } from '@kavicki/swi-design-system';
import { OnboardingHeader } from '../../../components/OnboardingHeader';

const HEIGHT_OPTIONS = Array.from({ length: 81 }, (_, i) => {
  const v = 140 + i; // 140cm..220cm
  return { label: `${v} cm`, value: String(v) };
});

const WEIGHT_OPTIONS = Array.from({ length: 121 }, (_, i) => {
  const v = 40 + i; // 40kg..160kg
  return { label: `${v} kg`, value: String(v) };
});

const BLOOD_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({
  label: v,
  value: v,
}));

export default function ComplimentaryDataStep3() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  const [gender, setGender] = useState<GenderValue | null>(null);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [disability, setDisability] = useState<'sim' | 'nao' | null>(null);

  const finish = () => {
    // Onboarding continues into the Smartband configuration flow before the
    // dashboard. Smartband-complete is what finally lands on /(app)/dashboard.
    router.replace('/(onboarding)/smartband/connection');
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

        <StepBar total={3} current={3} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados de saúde
        </Title>

        <View style={{ gap: theme.gap.xs }}>
          <Text variant="body.m" style={{ fontWeight: theme.fontWeight.bold }}>
            Seu gênero
          </Text>
          <GenderSelector value={gender} onChange={setGender} />
        </View>

        <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
          <View style={{ flex: 1 }}>
            <Combobox
              label="Altura"
              placeholder="cm"
              options={HEIGHT_OPTIONS}
              value={height}
              onChange={setHeight}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Combobox
              label="Peso"
              placeholder="Kg"
              options={WEIGHT_OPTIONS}
              value={weight}
              onChange={setWeight}
            />
          </View>
        </View>

        <Combobox
          label="Tipo sanguíneo"
          placeholder="Selecione aqui"
          options={BLOOD_OPTIONS}
          value={bloodType}
          onChange={setBloodType}
        />

        <Input
          label="Possui alergias?"
          placeholder="(descreva aqui)"
          value={allergies}
          onChangeText={setAllergies}
          multiline
          numberOfLines={4}
        />

        <Input
          label="Possui doenças crônicas?"
          placeholder="(descreva aqui)"
          value={conditions}
          onChangeText={setConditions}
          multiline
          numberOfLines={4}
        />

        <View style={{ gap: theme.gap.s }}>
          <Text variant="body.m" style={{ fontWeight: theme.fontWeight.bold }}>
            Pessoa com deficiência?
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.gap.m }}>
            <Radio
              label="Sim"
              checked={disability === 'sim'}
              onChange={() => setDisability('sim')}
            />
            <Radio
              label="Não"
              checked={disability === 'nao'}
              onChange={() => setDisability('nao')}
            />
          </View>
        </View>

        <View style={{ gap: theme.gap.sm }}>
          <Button variant="contained" label="Concluir" fullWidth onPress={finish} />
          <Button variant="outline" label="Voltar" fullWidth onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}
