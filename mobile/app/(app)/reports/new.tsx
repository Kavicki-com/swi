import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  ImageUploader,
  Input,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 372:21297 — new-report form. Voltar + "Novo relatório" title +
// 3 inputs (Título / Resumo / Detalhes multiline) + Atribuir
// responsáveis OutlineButton + Anexos section (4 placeholders +
// ImageUploader) + CTAs Salvar / Cancelar.
// Demo phase: useState efêmero, sem persistência.

export default function NewReport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [titulo, setTitulo] = useState('');
  const [resumo, setResumo] = useState('');
  const [detalhes, setDetalhes] = useState('');

  const cancel = () => router.back();
  const save = () => router.back();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/reports-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + theme.padding.l,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Voltar */}
        <Button
          variant="ghost"
          label="Voltar"
          labelColor={theme.content.primaryLight}
          accessibilityLabel="Voltar"
          onPress={cancel}
          iconLeft={
            <Icon
              name="keyboard_arrow_left"
              width={24}
              height={24}
              color={theme.content.primaryLight}
            />
          }
        />

        {/* Form title — Montserrat Bold 20 content.primary */}
        <Title variant="title.s" color={theme.content.primary}>
          Novo relatório
        </Title>

        {/* Inputs */}
        <Input
          label="Título do relatório"
          placeholder="Nome completo do novo administrador"
          value={titulo}
          onChangeText={setTitulo}
        />
        <Input
          label="Resumo do relatório"
          placeholder="Digite aqui um resumo do seu relatório"
          value={resumo}
          onChangeText={setResumo}
        />
        <Input
          label="Detalhes do relatório"
          placeholder="Digite aqui o seu relatório"
          value={detalhes}
          onChangeText={setDetalhes}
          multiline
          numberOfLines={10}
        />

        {/* Atribuir responsáveis — outline com + icon à direita */}
        <Button
          variant="outline"
          borderColor={theme.content.primary}
          labelColor={theme.content.primary}
          label="Atribuir responsáveis"
          accessibilityLabel="Atribuir responsáveis"
          onPress={() => router.push('/(app)/reports/responsibles')}
          iconRight={<Icon name="add" size={24} color={theme.content.primary} />}
        />

        {/* Anexos */}
        <Title variant="title.xs" color={theme.content.primary}>
          Anexos
        </Title>

        {/* 4 image placeholders em 2×2 grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.sm }}>
          {[1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={{
                width: 156,
                height: 132,
                backgroundColor: theme.surface.medium,
                borderRadius: theme.border.radius.m,
              }}
            />
          ))}
        </View>

        {/* ImageUploader (Enviar arquivo) */}
        <ImageUploader
          helperText="Selecione arquivos do tipo: JPG ou PNG"
          pickFileLabel="Enviar arquivo"
          showTakePhoto={false}
          accentColor={theme.content.primary}
          onPickFile={() => {}}
        />

        {/* CTAs */}
        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Salvar relatório"
          elevation="lg"
          accessibilityLabel="Salvar relatório"
          onPress={save}
        />
        <Button
          variant="ghost"
          label="Cancelar"
          labelColor={theme.content.primaryLight}
          accessibilityLabel="Cancelar"
          onPress={cancel}
        />
      </ScrollView>
    </View>
  );
}
