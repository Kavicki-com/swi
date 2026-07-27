import { useState } from 'react';
import { ActivityIndicator, Alert, Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, StepBar, Title, useTheme } from '@kavicki/swi-design-system';
import { OnboardingHeader } from '../../../components/OnboardingHeader';
import { useField } from '../../../lib/forms/useField';
import {
  validateCEP,
  validateRequired,
  validateUF,
} from '../../../lib/validation/validators';
import { maskCEP, maskUF } from '../../../lib/validation/masks';
import { useCepLookup } from '../../../lib/cep/useCepLookup';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { errorMessage } from '../../../lib/errors/errorMessage';

export default function ComplimentaryDataStep2() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username?: string }>();

  const cep = useField({ validator: validateCEP, mask: maskCEP });
  const street = useField({
    validator: (v) => validateRequired(v, 'Logradouro'),
  });
  const number = useField({
    validator: (v) => validateRequired(v, 'Número'),
  });
  const neighborhood = useField({
    validator: (v) => validateRequired(v, 'Bairro'),
  });
  const uf = useField({ validator: validateUF, mask: maskUF });
  const [cepNotFound, setCepNotFound] = useState(false);
  // City has no visible Input on this screen (matches Figma), but the CEP
  // lookup resolves it — capture it here so it persists to Profile.city.
  const [city, setCity] = useState('');
  const { saveProfile } = useProfile();

  const { loading: cepLoading, lookup } = useCepLookup({
    onSuccess: (addr) => {
      setCepNotFound(false);
      if (addr.street) street.setValue(addr.street);
      if (addr.neighborhood) neighborhood.setValue(addr.neighborhood);
      if (addr.state) uf.setValue(addr.state);
      if (addr.city) setCity(addr.city);
    },
    onError: () => setCepNotFound(true),
  });

  const handleCepBlur = () => {
    cep.onBlur();
    setCepNotFound(false);
    if (cep.isValid) void lookup(cep.value);
  };

  const cepError = cep.error ?? (cepNotFound ? 'CEP não encontrado' : undefined);

  const canSubmit =
    cep.isValid &&
    street.isValid &&
    number.isValid &&
    neighborhood.isValid &&
    uf.isValid &&
    !cepNotFound;

  const goNext = async () => {
    if (!canSubmit) {
      cep.setTouched(true);
      street.setTouched(true);
      number.setTouched(true);
      neighborhood.setTouched(true);
      uf.setTouched(true);
      return;
    }
    try {
      await saveProfile({
        cep: cep.value,
        street: street.value,
        number: number.value,
        neighborhood: neighborhood.value,
        city: city || undefined,
        uf: uf.value,
      });
    } catch (e) {
      Alert.alert('Erro', errorMessage(e, 'Não foi possível salvar seus dados.'));
      return;
    }
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

        <StepBar total={3} current={2} />

        <Title variant="title.xs" style={{ color: theme.content.primary }}>
          Dados de endereço
        </Title>

        <View style={{ gap: theme.gap.m }}>
          <Input
            value={cep.value}
            onChangeText={cep.onChangeText}
            onBlur={handleCepBlur}
            description={cepError}
            descriptionVariant={cepError ? 'error' : 'default'}
            label="CEP"
            placeholder="00000-000"
            keyboardType="number-pad"
            autoComplete="postal-code"
            maxLength={9}
            iconRight={cepLoading ? <ActivityIndicator size="small" /> : undefined}
          />
          <Input
            {...street.bind()}
            label="Logradouro"
            placeholder="Avenida Quatro de Julho"
            autoComplete="street-address"
          />
          <Input
            {...number.bind()}
            label="Número"
            placeholder="00"
            keyboardType="number-pad"
          />
          <Input
            {...neighborhood.bind()}
            label="Bairro"
            placeholder="Pampulha"
          />
          <Input
            {...uf.bind()}
            label="UF"
            placeholder="MG"
            autoCapitalize="characters"
            maxLength={2}
          />
        </View>

        {/* Actions inside the scroll (mesmo padrão do step-3): elimina
            possibilidade de overlap; user scrolla naturalmente até os
            botões no fim do form. */}
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
