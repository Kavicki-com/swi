import { useState } from 'react';
import { Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
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
import { isFeatureEnabled } from '../../../lib/featureFlags';

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

  // Coordinator: only one Combobox panel can be open at a time. Without this,
  // both Altura and Peso panels could float simultaneously (overlapping each
  // other and the fields below), which was the observed bug.
  type ComboboxKey = 'altura' | 'peso' | 'sangue';
  const [openCombobox, setOpenCombobox] = useState<ComboboxKey | null>(null);
  const handleOpenChange = (key: ComboboxKey) => (next: boolean) => {
    setOpenCombobox(next ? key : null);
  };

  // Required: gênero, altura, peso, tipo sanguíneo, status de deficiência.
  // Allergies + conditions ficam opcionais (não é incomum o usuário não ter).
  // Match com R-10 em 2026-05-17-mobile-routes-audit.md.
  const canSubmit =
    gender !== null &&
    height.length > 0 &&
    weight.length > 0 &&
    bloodType.length > 0 &&
    disability !== null;

  const finish = () => {
    if (!canSubmit) return;
    // Onboarding continues into the Smartband configuration flow before the
    // dashboard. Smartband-complete is what finally lands on /(app)/dashboard.
    //
    // Demo phase: when the smartband gate is off (Expo Go / web preview), the
    // entire smartband sub-tree renders ProdOnlyPlaceholder, dead-ending the
    // signup flow. Skip directly to the dashboard so the demo's signup path
    // actually reaches the authenticated app. signIn() was already called in
    // account-confirmation so the (app)/_layout guard lets us through.
    if (isFeatureEnabled('smartbandOnboarding')) {
      router.replace('/(onboarding)/smartband/connection');
    } else {
      router.replace('/(app)/dashboard');
    }
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

        <StepBar total={3} current={3} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados de saúde
        </Title>

        <View style={{ gap: theme.gap.xs }}>
          <Text variant="label.m">Seu gênero</Text>
          <GenderSelector value={gender} onChange={setGender} />
        </View>

        {/* Z-index ladder: each Combobox section gets a higher zIndex than
            the sections below it, so its open Panel (position:absolute,
            z-index:50 inside the DS Container) renders ABOVE following
            form fields instead of being covered by them. RN siblings without
            explicit zIndex render in document order (later on top) — without
            this, the Combobox panel would be obscured by Tipo sanguíneo /
            inputs / Concluir CTA below. */}
        <View style={{ flexDirection: 'row', gap: theme.gap.sm, zIndex: 30 }}>
          <View style={{ flex: 1, zIndex: 2 }}>
            <Combobox
              label="Altura"
              placeholder="cm"
              options={HEIGHT_OPTIONS}
              value={height}
              onChange={setHeight}
              open={openCombobox === 'altura'}
              onOpenChange={handleOpenChange('altura')}
              // Lista de 81 opções (140-220cm) cap em 3 visíveis + scroll
              // pra não vazar viewport.
              maxVisibleRows={3}
            />
          </View>
          <View style={{ flex: 1, zIndex: 1 }}>
            <Combobox
              label="Peso"
              placeholder="Kg"
              options={WEIGHT_OPTIONS}
              value={weight}
              onChange={setWeight}
              open={openCombobox === 'peso'}
              onOpenChange={handleOpenChange('peso')}
              // Lista de 121 opções (40-160kg) cap em 3 visíveis + scroll.
              maxVisibleRows={3}
            />
          </View>
        </View>

        <View style={{ zIndex: 20 }}>
          <Combobox
            label="Tipo sanguíneo"
            placeholder="Selecione aqui"
            options={BLOOD_OPTIONS}
            value={bloodType}
            onChange={setBloodType}
            open={openCombobox === 'sangue'}
            onOpenChange={handleOpenChange('sangue')}
          />
        </View>

        <View style={{ zIndex: 10 }}>
          <Input
            label="Possui alergias?"
            placeholder="(descreva aqui)"
            value={allergies}
            onChangeText={setAllergies}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={{ zIndex: 9 }}>
          <Input
            label="Possui doenças crônicas?"
            placeholder="(descreva aqui)"
            value={conditions}
            onChangeText={setConditions}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={{ gap: theme.gap.s }}>
          <Text variant="label.m">Pessoa com deficiência?</Text>
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

        <View style={{ gap: theme.gap.sm, zIndex: 7 }}>
          <Button
            variant="contained"
            label="Concluir"
            fullWidth
            disabled={!canSubmit}
            onPress={finish}
          />
          <Button variant="outline" label="Voltar" fullWidth onPress={() => router.back()} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
