import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  ImageUploader,
  Input,
  JourneyTheme,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { responsiblesSelection } from '../../../components/modals/ResponsiblesModal';

// Figma 372:21297 — new-report form. Voltar + "Novo relatório" title +
// 3 inputs (Título / Resumo / Detalhes multiline) + Atribuir
// responsáveis OutlineButton + Anexos section (4 placeholders +
// ImageUploader) + CTAs Salvar / Cancelar.
// Demo phase: useState efêmero, sem persistência. Seleção de
// responsáveis volta do modal via singleton `responsiblesSelection`.

export default function NewReport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [titulo, setTitulo] = useState('');
  const [resumo, setResumo] = useState('');
  const [detalhes, setDetalhes] = useState('');
  const [responsibleIds, setResponsibleIds] = useState<string[]>(() =>
    responsiblesSelection.get(),
  );

  // Rehidrata seleção ao reentrar (modal de responsáveis fecha via router.back).
  useFocusEffect(
    useCallback(() => {
      setResponsibleIds(responsiblesSelection.get());
    }, []),
  );

  const responsiblesLabel =
    responsibleIds.length === 0
      ? 'Atribuir responsáveis'
      : responsibleIds.length === 1
        ? `1 responsável atribuído`
        : `${responsibleIds.length} responsáveis atribuídos`;

  const cancel = () => {
    responsiblesSelection.clear();
    router.back();
  };
  const save = () => {
    responsiblesSelection.clear();
    router.back();
  };


  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/reports-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

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
        {/* Voltar — left-aligned, largura natural (match /reports/[id] e
            Figma 372:21297). */}
        <View style={{ alignSelf: 'flex-start' }}>
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
        </View>

        {/* Form title — Montserrat Bold 20 content.primary */}
        <Title variant="title.s" color={theme.content.primary}>
          Novo relatório
        </Title>

        {/* Inputs */}
        <Input
          label="Título do relatório"
          placeholder="Digite aqui o título do relatório"
          value={titulo}
          onChangeText={setTitulo}
        />
        <Input
          label="Resumo do relatório"
          placeholder="Digite aqui um resumo do seu relatório"
          value={resumo}
          onChangeText={setResumo}
        />
        {/* Detalhes textarea — Figma 372:21297 mostra textarea alta
            (~250-300h) ocupando espaço significativo do form. */}
        <Input
          label="Detalhes do relatório"
          placeholder="Digite aqui o seu relatório"
          value={detalhes}
          onChangeText={setDetalhes}
          multiline
          numberOfLines={16}
        />

        {/* Atribuir responsáveis — outline com + icon à direita.
            Label reflete contagem após seleção via modal. */}
        <Button
          variant="outline"
          borderColor={theme.content.primary}
          labelColor={theme.content.primary}
          label={responsiblesLabel}
          accessibilityLabel={responsiblesLabel}
          onPress={() => router.push('/(app)/reports/responsibles')}
          iconRight={<Icon name="add_circle" size={20} color={theme.content.primary} />}
        />

        {/* Anexos */}
        <Title variant="title.xs" color={theme.content.primary}>
          Anexos
        </Title>

        {/* 4 image placeholders em 2×2 grid — 156×156 quadrados com
            add_a_photo glifo centrado (Figma 372:21297 mostra ícone de
            câmera/foto em cada placeholder cinza, quadrado 156). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.sm }}>
          {[1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={{
                width: 156,
                height: 156,
                backgroundColor: theme.surface.medium,
                borderRadius: theme.border.radius.m,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="add_a_photo" size={32} color={theme.content.medium} />
            </View>
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
