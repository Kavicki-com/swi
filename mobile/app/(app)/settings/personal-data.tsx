import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  Input,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { fetchProfileCatalog, type ProfileCatalog } from '../../../services/api/catalog';

// Figma 353:11560 — settings sub-screen "Dados pessoais". Form-based.
// TopBar (DS v0.1.38) + section title + 11 fields + Salvar button +
// Home FAB. Pre-populated com Figma example values; demo phase,
// sem persistência (Salvar = router.back()).
export default function SettingsPersonalData() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Prefill REAL via GET /profile/me — os exemplos do Figma ('Carlos
  // Sampaio', '00/00/0000') eram mock fixo e o Salvar era um router.back():
  // o cliente editava, "salvava" e perdia tudo (QA 2026-07-26).
  const { loadProfile, saveProfile } = useProfile();
  const [nome, setNome] = useState('');
  const [data, setData] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [uf, setUf] = useState('');
  const [cidade, setCidade] = useState('');
  const [profissao, setProfissao] = useState('');
  const [setor, setSetor] = useState('');
  const [funcao, setFuncao] = useState('');
  const [gerente, setGerente] = useState('');
  const [saving, setSaving] = useState(false);
  // Vocabulário real da org (DISTINCT do backend) — mesmas listas do painel.
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProfile()
      .then((p) => {
        if (cancelled || !p) return;
        setNome(p.fullName ?? '');
        setData(p.birthDate ?? '');
        setCpf(p.cpf ?? '');
        setTelefone(p.phone ?? '');
        setUf(p.uf ?? '');
        setCidade(p.city ?? '');
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProfile({
        fullName: nome.trim() || undefined,
        birthDate: data.trim() || undefined,
        cpf: cpf.trim() || undefined,
        phone: telefone.trim() || undefined,
        uf: uf.trim() || undefined,
        city: cidade.trim() || undefined,
        jobTitle: profissao || undefined,
        sector: setor || undefined,
        duty: funcao || undefined,
        managerName: gerente || undefined,
      });
      Alert.alert('Pronto', 'Seus dados foram salvos.');
      router.back();
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar seus dados.');
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
        extraScrollHeight={60}
        enableOnAndroid
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

          <Input
            label="Nome Completo"
            value={nome}
            onChangeText={setNome}
          />
          <Input
            label="Data de Nascimento"
            value={data}
            onChangeText={setData}
          />
          <Input label="CPF" value={cpf} onChangeText={setCpf} />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label="Telefone"
            value={telefone}
            onChangeText={setTelefone}
            keyboardType="phone-pad"
          />

          {/* Row UF (77) + Cidade (flex), gap.sm between */}
          <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
            <View style={{ width: 77 }}>
              <Input
                label="UF"
                value={uf}
                onChangeText={setUf}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Cidade"
                value={cidade}
                onChangeText={setCidade}
              />
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
            options={toOptions(undefined, gerente)}
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
