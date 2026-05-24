import { useState } from 'react';
import { Image as RNImage, View } from 'react-native';
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

// Figma 353:11560 — settings sub-screen "Dados pessoais". Form-based.
// TopBar (DS v0.1.38) + section title + 11 fields + Salvar button +
// Home FAB. Pre-populated com Figma example values; demo phase,
// sem persistência (Salvar = router.back()).
export default function SettingsPersonalData() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Pre-populated state per Figma 353:11560 example values
  const [nome, setNome] = useState('Carlos Sampaio');
  const [data, setData] = useState('00/00/0000');
  const [cpf, setCpf] = useState('000.000.000-00');
  const [email, setEmail] = useState('seu@email.com');
  const [telefone, setTelefone] = useState('(00) 00000 0000');
  const [uf, setUf] = useState('MG');
  const [cidade, setCidade] = useState('Quitandinha');
  const [profissao, setProfissao] = useState('');
  const [setor, setSetor] = useState('');
  const [funcao, setFuncao] = useState('');
  const [gerente, setGerente] = useState('');

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
            options={[]}
            value={profissao}
            onChange={setProfissao}
          />
          <Combobox
            label="Setor"
            placeholder="Selecione aqui"
            options={[]}
            value={setor}
            onChange={setSetor}
          />
          <Combobox
            label="Função"
            placeholder="Selecione aqui"
            options={[]}
            value={funcao}
            onChange={setFuncao}
          />
          <Combobox
            label="Gerente responsável"
            placeholder="Selecione aqui"
            options={[]}
            value={gerente}
            onChange={setGerente}
          />

          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Salvar alterações"
            elevation="lg"
            accessibilityLabel="Salvar alterações"
            onPress={() => router.back()}
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
