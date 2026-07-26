import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  ExamInfoCard,
  ImageUploader,
  Input,
  Text,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';
import { useProfile } from '../../../services/profile/ProfileProvider';

const BLOOD_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({
  label: v,
  value: v,
}));
// gender persiste como CÓDIGO ('male'/'female'/'other') — a convenção que o
// painel inteiro compara (detalhe do funcionário, painel do chat).
const GENDER_OPTIONS = [
  { label: 'Masculino', value: 'male' },
  { label: 'Feminino', value: 'female' },
  { label: 'Outro', value: 'other' },
];

// Figma 353:12057 — settings sub-screen "Dados de saúde". Form-based.
// TopBar + section title + 2 comboboxes + 2 multiline inputs +
// 4 ExamInfoCards + ImageUploader + Salvar + Home FAB.
// Demo phase: useState only, sem persistência, sem upload real.
export default function SettingsHealthData() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Prefill REAL + salvar de verdade — a tela era useState solto e o Salvar
  // um router.back(): edição de saúde era descartada (QA 2026-07-26).
  const { loadProfile, saveProfile } = useProfile();
  const [tipoSanguineo, setTipoSanguineo] = useState('');
  const [genero, setGenero] = useState('');
  const [alergias, setAlergias] = useState('');
  const [doencas, setDoencas] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadProfile()
      .then((p) => {
        if (cancelled || !p) return;
        setTipoSanguineo(p.bloodType ?? '');
        setGenero(p.gender ?? '');
        setAlergias(p.allergies ?? '');
        setDoencas(p.chronicConditions ?? '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // loadProfile é estável (useCallback no provider); rodar 1x no mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProfile({
        bloodType: tipoSanguineo || undefined,
        gender: genero || undefined,
        allergies: alergias || undefined,
        chronicConditions: doencas || undefined,
      });
      Alert.alert('Pronto', 'Seus dados foram salvos.');
      router.back();
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar seus dados.');
    } finally {
      setSaving(false);
    }
  };

  const exams: Array<{
    year: number;
    date: string;
    examName: string;
    future?: boolean;
  }> = [
    { year: 2027, date: '05 Mar', examName: 'Exame de reciclagem técnica' },
    { year: 2029, date: '19 Nov', examName: 'Avaliação de segurança' },
    { year: 2031, date: '14 Jul', examName: 'Certificação em normas ISO' },
    { year: 2033, date: '28 Fev', examName: 'Exame de aptidão física e mental', future: true },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={60}
        enableOnAndroid
      >
        <TopBar title="Dados de saúde" onBack={() => router.back()} />

        <View
          style={{
            gap: theme.gap.xl,
            marginTop: theme.padding.xxl,
          }}
        >
          <Title variant="title.xs" color={theme.content.primary}>
            Dados da saúde
          </Title>

          <Combobox
            label="Tipo sanguíneo"
            placeholder="Selecione aqui"
            options={BLOOD_OPTIONS}
            value={tipoSanguineo}
            onChange={setTipoSanguineo}
          />
          <Combobox
            label="Gênero"
            placeholder="Selecione aqui"
            options={GENDER_OPTIONS}
            value={genero}
            onChange={setGenero}
          />

          <Input
            label="Possui alergias?"
            description={`separe suas alergias com " , " (virgula)`}
            placeholder="(descreva aqui)"
            value={alergias}
            onChangeText={setAlergias}
            multiline
            numberOfLines={3}
          />
          <Input
            label="Possui doenças crônicas?"
            placeholder="(descreva aqui)"
            value={doencas}
            onChangeText={setDoencas}
            multiline
            numberOfLines={3}
          />

          <View style={{ gap: theme.gap.m }}>
            <Text variant="label.m" color={theme.content.dark}>
              Histórico Médico
            </Text>

            {exams.map((exam) => (
              <ExamInfoCard
                key={`${exam.year}-${exam.date}`}
                year={exam.year}
                date={exam.date}
                examName={exam.examName}
                compact
                mobile
                fullWidth
                future={exam.future}
                onActionPress={() => {}}
              />
            ))}

            <ImageUploader
              helperText="Selecione arquivos do tipo: JPG ou PNG"
              pickFileLabel="Enviar novo exame"
              showTakePhoto={false}
              accentColor={theme.content.primary}
              onPickFile={() => {}}
            />
          </View>

          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label={saving ? 'Salvando…' : 'Salvar alterações'}
            elevation="lg"
            accessibilityLabel="Salvar alterações"
            onPress={handleSave}
          />
        </View>
      </KeyboardAwareScrollView>

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        {/* HomeFAB fiel ao Figma 348:10334 (substitui Button DS antigo). */}
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
