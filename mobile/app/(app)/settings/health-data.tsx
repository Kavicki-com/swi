import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, Linking, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
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
import { errorMessage } from '../../../lib/errors/errorMessage';
import { createExam, listExams, type Exam } from '../../../services/api/exams';
import { examCardParts } from '../../../services/api/examCard';
import { pickExamDocument } from '../../../lib/media/pickDocument';
import { useField } from '../../../lib/forms/useField';
import { validateExamDate, validateRequired } from '../../../lib/validation/validators';
import { maskBirthDate } from '../../../lib/validation/masks';

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

  // Exames REAIS. A lista era um array fixo de 4 exames inventados, duplicado
  // com o my-stats, e o botão de enviar tinha `onPickFile={() => {}}` — não
  // fazia absolutamente nada (QA 2026-07-26).
  const [exams, setExams] = useState<Exam[]>([]);
  const [sendingExam, setSendingExam] = useState(false);
  const examName = useField({ validator: (v) => validateRequired(v, 'Nome do exame') });
  const examDate = useField({ validator: validateExamDate, mask: maskBirthDate });

  useEffect(() => {
    let cancelled = false;
    void listExams()
      .then((list) => { if (!cancelled) setExams(list); })
      // Sem exames a seção só some; um alerta aqui atrapalharia quem veio
      // editar tipo sanguíneo e nem liga pro histórico.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Anexar é o ÚLTIMO passo: nome e validade primeiro (decisão do cliente —
  // campos inline acima do botão), senão o card não tem o que mostrar.
  const enviarExame = async () => {
    if (!examName.isValid || !examDate.isValid) {
      examName.setTouched(true);
      examDate.setTouched(true);
      return;
    }
    // Seletor de DOCUMENTO, não a galeria: laudo costuma ser PDF, e na galeria
    // ele nem aparece. Era a última ponta que restringia o formato do exame.
    const uri = await pickExamDocument();
    if (!uri) return;
    setSendingExam(true);
    try {
      const [dd, mm, yyyy] = examDate.value.split('/');
      const novo = await createExam({
        name: examName.value.trim(),
        date: `${yyyy}-${mm}-${dd}`,   // a API guarda data de calendário
        fileUri: uri,
      });
      setExams((prev) => [novo, ...prev]);
      examName.setValue('');
      examDate.setValue('');
    } catch (e) {
      Alert.alert('Erro', errorMessage(e, 'Não foi possível enviar o exame.'));
    } finally {
      setSendingExam(false);
    }
  };

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
    } catch (e) {
      Alert.alert('Erro', errorMessage(e, 'Não foi possível salvar seus dados.'));
    } finally {
      setSaving(false);
    }
  };

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
        bottomOffset={60}
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

            {exams.length === 0 ? (
              <Text variant="body.s" color={theme.content.dark}>
                Nenhum exame enviado.
              </Text>
            ) : null}

            {exams.map((exam) => {
              const parts = examCardParts(exam);
              return (
                <ExamInfoCard
                  key={exam.id}
                  year={parts.year}
                  date={parts.date}
                  examName={exam.name}
                  compact
                  mobile
                  fullWidth
                  future={parts.future}
                  onActionPress={() => Linking.openURL(exam.fileUrl)}
                />
              );
            })}

            {/* Nome e validade ANTES de anexar (decisão do cliente): o card do
                histórico mostra os três, então o arquivo sozinho não desenha
                nada. */}
            <Input
              {...examName.bind()}
              label="Nome do exame"
              placeholder="Ex.: Exame de reciclagem técnica"
            />
            <Input
              {...examDate.bind()}
              label="Validade"
              placeholder="dd/mm/aaaa"
              keyboardType="number-pad"
              maxLength={10}
            />

            <ImageUploader
              helperText="Selecione arquivos do tipo: PDF, JPG, PNG ou TXT"
              pickFileLabel={sendingExam ? 'Enviando…' : 'Enviar novo exame'}
              showTakePhoto={false}
              accentColor={theme.content.primary}
              onPickFile={enviarExame}
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
