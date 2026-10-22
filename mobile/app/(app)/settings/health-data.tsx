import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  ExamInfoCard,
  ImageUploader,
  Input,
  RadioGroup,
  Text,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { errorMessage } from '../../../lib/errors/errorMessage';
import { abrirMidiaOuAvisar } from '../../../lib/media/trustedMediaUrl';
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
// Altura, peso e PcD com as mesmas opções do cadastro (passo 3 dos dados
// complementares): 140 a 220 cm, 40 a 160 kg, Sim ou Não.
const HEIGHT_OPTIONS = Array.from({ length: 81 }, (_, i) => {
  const v = 140 + i;
  return { label: `${v} cm`, value: String(v) };
});
const WEIGHT_OPTIONS = Array.from({ length: 121 }, (_, i) => {
  const v = 40 + i;
  return { label: `${v} kg`, value: String(v) };
});
const DISABILITY_OPTIONS = [
  { label: 'Sim', value: 'sim' },
  { label: 'Não', value: 'nao' },
];
type Disability = 'sim' | 'nao';

// gender persiste como CÓDIGO ('male'/'female'/'other') — a convenção que o
// painel inteiro compara (detalhe do funcionário, painel do chat).
const GENDER_OPTIONS = [
  { label: 'Masculino', value: 'male' },
  { label: 'Feminino', value: 'female' },
  { label: 'Outro', value: 'other' },
];

// TopBar + section title + comboboxes (tipo sanguíneo, gênero, altura, peso) +
// 2 multiline inputs + PcD + histórico de exames + Salvar + Home FAB.
// Altura, peso e PcD seguem os campos, rótulos e a validação do cadastro
// (obrigatórios, mensagem depois do toque em salvar) e vão no mesmo PUT do
// perfil. Esse trecho da tela não tem desenho no Figma.
export default function SettingsHealthData() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Prefill REAL + salvar de verdade — a tela era useState solto e o Salvar
  const { loadProfile, saveProfile } = useProfile();
  const [tipoSanguineo, setTipoSanguineo] = useState('');
  const [genero, setGenero] = useState('');
  const [alergias, setAlergias] = useState('');
  const [doencas, setDoencas] = useState('');
  const [altura, setAltura] = useState('');
  const [peso, setPeso] = useState('');
  const [pcd, setPcd] = useState<Disability | null>(null);
  const [saving, setSaving] = useState(false);

  // Um painel de lista aberto por vez entre Altura e Peso (lado a lado, um
  // cobriria o outro), como no cadastro.
  const [openCombobox, setOpenCombobox] = useState<'altura' | 'peso' | null>(null);
  const handleOpenChange = (key: 'altura' | 'peso') => (next: boolean) => {
    setOpenCombobox(next ? key : null);
  };

  // A mesma regra do cadastro: sem blur em que se pendurar (Combobox e Radio),
  // a mensagem de obrigatório aparece depois do toque em salvar.
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const faltando = (vazio: boolean, mensagem: string) =>
    tentouSalvar && vazio
      ? { description: mensagem, descriptionVariant: 'error' as const }
      : {};

  // Exames REAIS. A lista era um array fixo de 4 exames inventados, duplicado
  // com o my-stats, e o botão de enviar tinha `onPickFile={() => {}}` — não
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
        setAltura(p.heightCm != null ? String(p.heightCm) : '');
        setPeso(p.weightKg != null ? String(p.weightKg) : '');
        setPcd(p.hasDisability == null ? null : p.hasDisability ? 'sim' : 'nao');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // loadProfile é estável (useCallback no provider); rodar 1x no mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (altura.length === 0 || peso.length === 0 || pcd === null) {
      setTentouSalvar(true);
      return;
    }
    setSaving(true);
    try {
      await saveProfile({
        bloodType: tipoSanguineo || undefined,
        gender: genero || undefined,
        allergies: alergias || undefined,
        chronicConditions: doencas || undefined,
        heightCm: parseInt(altura, 10),
        weightKg: parseInt(peso, 10),
        hasDisability: pcd === 'sim',
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

          {/* zIndex: o painel aberto (position absolute dentro do Combobox do
              DS) fica por cima dos campos que vêm depois, como no cadastro. */}
          <View style={{ flexDirection: 'row', gap: theme.gap.sm, zIndex: 30 }}>
            <View style={{ flex: 1, zIndex: 2 }}>
              <Combobox
                label="Altura"
                placeholder="cm"
                options={HEIGHT_OPTIONS}
                value={altura}
                onChange={setAltura}
                open={openCombobox === 'altura'}
                onOpenChange={handleOpenChange('altura')}
                maxVisibleRows={3}
                {...faltando(altura.length === 0, 'Altura é obrigatória')}
              />
            </View>
            <View style={{ flex: 1, zIndex: 1 }}>
              <Combobox
                label="Peso"
                placeholder="Kg"
                options={WEIGHT_OPTIONS}
                value={peso}
                onChange={setPeso}
                open={openCombobox === 'peso'}
                onOpenChange={handleOpenChange('peso')}
                maxVisibleRows={3}
                {...faltando(peso.length === 0, 'Peso é obrigatório')}
              />
            </View>
          </View>

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

          <RadioGroup
            label="Pessoa com deficiência?"
            options={DISABILITY_OPTIONS}
            value={pcd}
            onChange={(v) => setPcd(v as Disability)}
            {...faltando(pcd === null, 'Selecione uma opção')}
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
                  onActionPress={() => { void abrirMidiaOuAvisar(exam.fileUrl, exam.name); }}
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
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
