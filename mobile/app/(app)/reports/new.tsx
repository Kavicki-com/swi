import { useCallback, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
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
import {
  responsiblesSelection,
  type ResponsiblePick,
} from '../../../components/modals/ResponsiblesModal';
import { useField } from '../../../lib/forms/useField';
import { validateRequired } from '../../../lib/validation/validators';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { useReports } from '../../../services/reports/ReportsProvider';

// 3 inputs (Título / Resumo / Detalhes multiline) + Atribuir
// responsáveis OutlineButton + Anexos section (4 placeholders +
// ImageUploader) + CTAs Salvar / Cancelar.
// Backend slice: salvar vai pelo provider via useReports().create() (o mock
// persiste in-memory na sessão). Seleção de
// responsáveis volta do modal via singleton `responsiblesSelection`.

export default function NewReport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { create } = useReports();
  const [saving, setSaving] = useState(false);

  const titulo = useField({ validator: (v) => validateRequired(v, 'Título') });
  const resumo = useField({ validator: (v) => validateRequired(v, 'Resumo') });
  const detalhes = useField({ validator: (v) => validateRequired(v, 'Detalhes') });
  // A seleção já vem com id E NOME. Antes só trazia ids e esta tela resolvia o
  // nome pelo diretório do chat via useChat() — que vive noutra subárvore de
  const [responsibles, setResponsibles] = useState<ResponsiblePick[]>(() =>
    responsiblesSelection.get(),
  );

  // Anexos — 4 placeholders + 1 "Enviar arquivo" via ImageUploader. As URIs
  // escolhidas entram no submit como `imageUris` e sobem no create do
  // ReportsProvider; o estado local é só a grade em edição.
  const [attachments, setAttachments] = useState<(string | undefined)[]>(
    [undefined, undefined, undefined, undefined],
  );
  const setAttachmentAt = (index: number, uri: string) => {
    setAttachments((prev) => {
      const next = [...prev];
      next[index] = uri;
      return next;
    });
  };

  // Esvazia o slot NO LUGAR, sem compactar o array: a pessoa está olhando pra
  // grade, e puxar as fotos seguintes uma casa pra cima mexeria na posição do
  // que ela decidiu manter.
  const clearAttachmentAt = (index: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      next[index] = undefined;
      return next;
    });
  };

  const media = useMediaPicker();
  // não havia caminho de volta. `onRemove` só vai quando há o que remover; em
  // slot vazio o menu segue com as três opções de sempre.
  const showPicker = async (index: number) => {
    const uri = await media.showPicker(
      attachments[index] ? { onRemove: () => clearAttachmentAt(index) } : undefined,
    );
    if (uri) setAttachmentAt(index, uri);
  };

  // "Enviar arquivo" alimenta a GRADE, não a si mesmo. A tela mantinha dois
  // estados separados — os 4 quadrados e uma preview própria do uploader — e a
  // foto escolhida por aqui aparecia dentro do próprio botão, longe dos
  //
  // Mesmo modelo que journey/task/[id] já usa: um lugar só pras fotos.
  const primeiroSlotLivre = attachments.findIndex((a) => !a);
  const pickFileForUploader = async () => {
    // Cheio: nem abre o seletor. Sem isto o 5º toque sobrescreveria o primeiro
    // anexo em silêncio, e a pessoa perderia uma foto já escolhida.
    if (primeiroSlotLivre === -1) return;
    const uri = await media.pickFromGallery();
    if (uri) setAttachmentAt(primeiroSlotLivre, uri);
  };

  // Rehidrata seleção ao reentrar (modal de responsáveis fecha via router.back).
  useFocusEffect(
    useCallback(() => {
      setResponsibles(responsiblesSelection.get());
    }, []),
  );

  const responsiblesLabel =
    responsibles.length === 0
      ? 'Atribuir responsáveis'
      : responsibles.length === 1
        ? `1 responsável atribuído`
        : `${responsibles.length} responsáveis atribuídos`;

  const canSubmit = titulo.isValid && resumo.isValid && detalhes.isValid;

  const cancel = () => {
    responsiblesSelection.clear();
    router.back();
  };
  const save = async () => {
    if (!canSubmit) {
      titulo.setTouched(true);
      resumo.setTouched(true);
      detalhes.setTouched(true);
      return;
    }
    // O backend guarda NOMES (e casa nome↔perfil pra resolver os avatares do
    // card). Vêm da seleção, que já os trouxe do diretório real da empresa —
    // GRAVADA como responsável no banco de verdade.
    const responsibleNames = responsibles.map((r) => r.name);
    setSaving(true);
    try {
      await create({
        title: titulo.value,
        summary: resumo.value,
        details: detalhes.value,
        responsibles: responsibleNames,
        imageUris: attachments.filter(Boolean) as string[],
      });
      responsiblesSelection.clear();
      router.back();
    } finally {
      setSaving(false);
    }
  };


  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/login-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + theme.padding.l,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        <View style={{ alignSelf: 'flex-start', marginLeft: -18 }}>
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
          {...titulo.bind()}
          label="Título do relatório"
          placeholder="Digite aqui o título do relatório"
        />
        <Input
          {...resumo.bind()}
          label="Resumo do relatório"
          placeholder="Digite aqui um resumo do seu relatório"
        />
        <Input
          {...detalhes.bind()}
          label="Detalhes do relatório"
          placeholder="Digite aqui o seu relatório"
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

        <View style={{ gap: theme.gap.sm }}>
          {[[0, 1], [2, 3]].map((row, rowIdx) => (
            <View
              key={rowIdx}
              style={{ flexDirection: 'row', gap: theme.gap.sm }}
            >
              {row.map((i) => {
                const uri = attachments[i];
                return (
                  <Pressable
                    key={i}
                    onPress={() => showPicker(i)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      uri
                        ? `Anexo ${i + 1} (toque para trocar ou remover)`
                        : `Adicionar anexo ${i + 1}`
                    }
                    style={{
                      flex: 1,
                      aspectRatio: 1,
                      backgroundColor: theme.surface.medium,
                      borderRadius: theme.border.radius.m,
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {uri ? (
                      <Image
                        source={{ uri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Icon name="add_a_photo" size={32} color={theme.content.medium} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View
          style={{
            height: 3,
            width: '100%',
            backgroundColor: theme.surface.standard,
            borderRadius: theme.border.radius.pill,
            overflow: 'hidden',
          }}
        >
          <View
            testID="progresso-anexos"
            style={{
              width: `${(attachments.filter(Boolean).length / attachments.length) * 100}%`,
              height: '100%',
              backgroundColor: theme.content.light,
            }}
          />
        </View>

        {/* ImageUploader (Enviar arquivo) — wired ao expo-image-picker.
            showTakePhoto=false na spec original, então onPickFile dispara
            só galeria. `value` mostra a preview quando user já selecionou. */}
        <ImageUploader
          helperText="Selecione arquivos do tipo: JPG ou PNG"
          pickFileLabel="Enviar arquivo"
          showTakePhoto={false}
          accentColor={theme.content.primary}
          // value null de proposito: a preview vive nos 4 quadrados acima.
          value={null}
          onPickFile={pickFileForUploader}
        />

        {/* CTAs */}
        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Salvar relatório"
          elevation="lg"
          accessibilityLabel="Salvar relatório"
          disabled={saving}
          onPress={save}
        />
        <Button
          variant="ghost"
          label="Cancelar"
          labelColor={theme.content.primaryLight}
          accessibilityLabel="Cancelar"
          onPress={cancel}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}
