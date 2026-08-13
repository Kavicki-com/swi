import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  ImageUploader,
  Input,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { useAuth } from '../../../services/auth/AuthProvider';
import { fetchProfileCatalog, type ProfileCatalog } from '../../../services/api/catalog';
import { errorMessage } from '../../../lib/errors/errorMessage';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { uploadImage } from '../../../services/api/uploadMedia';
import { useField } from '../../../lib/forms/useField';
import {
  maskBirthDate,
  maskCPF,
  maskPhone,
  maskUF,
} from '../../../lib/validation/masks';
import {
  validateBirthDate,
  validateCPF,
  validateFullName,
  validatePhone,
  validateRequired,
  validateUF,
  type ValidationResult,
} from '../../../lib/validation/validators';

// Campo que só precisa ser válido SE preenchido. Os validadores da casa
// tratam vazio como erro ("UF é obrigatória"), o que é certo no cadastro —
// mas aqui é EDIÇÃO: quem tem o perfil parcialmente preenchido não pode ficar
// impedido de corrigir a cidade porque nunca informou a UF.
const optional =
  (validator: (v: string) => ValidationResult) =>
  (v: string): ValidationResult =>
    v.trim().length === 0 ? { valid: true } : validator(v);

// Figma 353:11560 — settings sub-screen "Dados pessoais". Form-based.
// TopBar (DS v0.1.38) + section title + 11 fields + Salvar button +
// Home FAB. Prefill real via GET /profile/me e Salvar via saveProfile
// (upload de avatar por URL assinada ANTES do PUT); ver handleSave.
export default function SettingsPersonalData() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Prefill REAL via GET /profile/me — os exemplos do Figma ('Carlos
  // Sampaio', '00/00/0000') eram mock fixo e o Salvar era um router.back():
  // o cliente editava, "salvava" e perdia tudo (QA 2026-07-26).
  const { loadProfile, saveProfile } = useProfile();
  // O e-mail da conta vive no User, nao no Profile. Ate 2026-07-27 este campo
  // era um input editavel que NUNCA era preenchido no load nem enviado no
  // save: digitar ali nao fazia absolutamente nada. Agora ele mostra o e-mail
  // real, em leitura — trocar e-mail e operacao de autenticacao (exige
  // verificacao do novo endereco) e nao cabe nesta tela.
  const { user } = useAuth();
  // Máscara + validação vêm de lib/validation, as MESMAS já usadas no cadastro
  // (complimentary-data/step-1). Esta tela nasceu com useState cru: a data de
  // nascimento aceitava "02011999" sem barras e o Salvar mandava isso pro
  // backend (QA no aparelho, 2026-07-27).
  const nome = useField({ validator: validateFullName });
  const data = useField({ validator: validateBirthDate, mask: maskBirthDate });
  const cpf = useField({ validator: validateCPF, mask: maskCPF });
  const telefone = useField({ validator: validatePhone, mask: maskPhone });
  // Opcionais: o backend aceita perfil parcial, então exigir aqui trancaria
  // quem só quer corrigir um campo.
  const uf = useField({ validator: optional(validateUF), mask: maskUF });
  const cidade = useField({ validator: optional((v) => validateRequired(v, 'Cidade')) });
  const [profissao, setProfissao] = useState('');
  const [setor, setSetor] = useState('');
  const [funcao, setFuncao] = useState('');
  const [gerente, setGerente] = useState('');
  const [saving, setSaving] = useState(false);
  // Duas variaveis de proposito: `fotoUri` e o que a tela MOSTRA (pode ser a
  // URL assinada que veio do backend), `fotoLocal` e o arquivo novo a subir.
  // Sem separar, salvar qualquer outro campo re-subiria a mesma foto e criaria
  // um objeto novo no bucket a cada vez.
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [fotoLocal, setFotoLocal] = useState<string | null>(null);
  const media = useMediaPicker();
  // Vocabulário real da org (DISTINCT do backend) — mesmas listas do painel.
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProfile()
      .then((p) => {
        if (cancelled || !p) return;
        // setValue aplica a máscara: perfil antigo salvo sem formatação entra
        // na tela já formatado, em vez de perpetuar o dado cru.
        nome.setValue(p.fullName ?? '');
        data.setValue(p.birthDate ?? '');
        cpf.setValue(p.cpf ?? '');
        telefone.setValue(p.phone ?? '');
        uf.setValue(p.uf ?? '');
        cidade.setValue(p.city ?? '');
        setFotoUri(p.avatarUrl ?? null);
        setProfissao(p.jobTitle ?? '');
        setSetor(p.sector ?? '');
        setFuncao(p.duty ?? '');
        setGerente(p.managerName ?? '');
      })
      .catch(() => {});
    void fetchProfileCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // loadProfile é estável (useCallback no provider); rodar 1x no mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // value === label (o backend guarda o rótulo verbatim). Injeta o valor
  // atual quando o catálogo ainda não chegou / não o contém — sem isso o
  // Combobox do DS exibe o placeholder em cima de um cadastro preenchido.
  const toOptions = (values: string[] | undefined, current: string) => {
    const base = (values ?? []).map((v) => ({ label: v, value: v }));
    if (current && !base.some((o) => o.value === current)) {
      base.unshift({ label: current, value: current });
    }
    return base;
  };

  const campos = [nome, data, cpf, telefone, uf, cidade];
  const podeSalvar = campos.every((f) => f.isValid);

  const escolherFoto = async (obter: () => Promise<string | null>) => {
    const uri = await obter();
    if (!uri) return;
    setFotoUri(uri);
    setFotoLocal(uri);
  };

  const handleSave = async () => {
    // Tentar salvar com campo inválido revela os erros de uma vez: sem isto o
    // botão simplesmente não faria nada e a tela ficaria muda sobre o motivo
    // (o useField só acusa erro depois do blur).
    if (!podeSalvar) {
      campos.forEach((f) => f.setTouched(true));
      return;
    }
    setSaving(true);
    try {
      // O upload precede o PUT porque o backend guarda a KEY, nao o arquivo: o
      // arquivo vai direto pro bucket por URL assinada. Falhar aqui aborta o
      // salvamento inteiro em vez de gravar um perfil sem a foto que a pessoa
      // acabou de escolher — e o formulario continua preenchido pra ela tentar
      // de novo.
      let avatarKey: string | undefined;
      if (fotoLocal) {
        try {
          avatarKey = await uploadImage(fotoLocal, 'avatars');
        } catch (e) {
          Alert.alert('Erro', errorMessage(e, 'Nao foi possivel enviar a foto.'));
          return;
        }
      }
      await saveProfile({
        ...(avatarKey ? { avatarKey } : {}),
        fullName: nome.value.trim() || undefined,
        birthDate: data.value.trim() || undefined,
        cpf: cpf.value.trim() || undefined,
        phone: telefone.value.trim() || undefined,
        uf: uf.value.trim() || undefined,
        city: cidade.value.trim() || undefined,
        jobTitle: profissao || undefined,
        sector: setor || undefined,
        duty: funcao || undefined,
        managerName: gerente || undefined,
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
      {/* Background overlay — Figma imgSettingsPersonalData.
          Wrapper View pattern (RN ImageProps typing omits pointerEvents). */}
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
        <TopBar title="Dados pessoais" onBack={() => router.back()} />

        <View
          style={{
            gap: theme.gap.m,
            marginTop: theme.padding.xxl,
          }}
        >
          {/* Section title — content.primary green Montserrat Bold 16 */}
          <Title variant="title.xs" color={theme.content.primary}>
            Dados do cadastro
          </Title>

          {/* Foto de perfil — mesma UI ja aprovada no passo 1 do cadastro
              (ImageUploader do DS). La ela existe mas DESCARTA o arquivo: o
              wizard roda antes da conta existir, entao nao ha token pro
              presign. Aqui a pessoa esta autenticada, e este passou a ser o
              unico caminho no app pra definir foto — sem ele o Avatar cai nas
              iniciais em jornada, dashboard, chat, mapa e no seletor de
              responsaveis (QA no aparelho, 2026-07-27). */}
          <Title variant="title.xs" color={theme.content.primary}>
            Foto de perfil
          </Title>
          <ImageUploader
            value={fotoUri ? { uri: fotoUri } : null}
            onTakePhoto={() => escolherFoto(media.takePhoto)}
            onPickFile={() => escolherFoto(media.pickFromGallery)}
            onRemove={() => { setFotoUri(null); setFotoLocal(null); }}
            helperText="Selecione arquivos do tipo: JPG ou PNG"
            takePhotoLabel="Tirar Foto"
            pickFileLabel="Enviar arquivo"
          />

          <Input label="Nome Completo" {...nome.bind()} />
          <Input
            label="Data de Nascimento"
            {...data.bind()}
            keyboardType="number-pad"
            maxLength={10}
          />
          <Input
            label="CPF"
            {...cpf.bind()}
            keyboardType="number-pad"
            maxLength={14}
          />
          <Input
            label="Email"
            value={user?.email ?? ''}
            // `disabled` e a prop do DS pra isto — ele OMITE `editable` de
            // TextInputProps de proposito, pra que o estado desabilitado venha
            // com o tratamento visual do design em vez de so travar o toque.
            disabled
            description="Para alterar o e-mail, fale com o suporte."
          />
          <Input
            label="Telefone"
            {...telefone.bind()}
            keyboardType="phone-pad"
            maxLength={15}
          />

          {/* Row UF (77) + Cidade (flex), gap.sm between */}
          <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
            <View style={{ width: 77 }}>
              <Input
                label="UF"
                {...uf.bind()}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Cidade" {...cidade.bind()} />
            </View>
          </View>

          <Combobox
            label="Profissão"
            placeholder="Selecione aqui"
            options={toOptions(catalog?.jobTitles, profissao)}
            value={profissao}
            onChange={setProfissao}
          />
          <Combobox
            label="Setor"
            placeholder="Selecione aqui"
            options={toOptions(catalog?.sectors, setor)}
            value={setor}
            onChange={setSetor}
          />
          <Combobox
            label="Função"
            placeholder="Selecione aqui"
            options={toOptions(catalog?.duties, funcao)}
            value={funcao}
            onChange={setFuncao}
          />
          <Combobox
            label="Gerente responsável"
            placeholder="Selecione aqui"
            options={toOptions(catalog?.managers, gerente)}
            value={gerente}
            onChange={setGerente}
          />

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

      {/* HomeFAB fiel ao Figma 348:10334 (substitui Button DS antigo). */}
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
