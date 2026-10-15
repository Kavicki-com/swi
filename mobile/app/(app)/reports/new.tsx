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
  Text,
  Title,
  Toast,
  useTheme,
} from '@kavicki/swi-design-system';
import { errorMessage } from '../../../lib/errors/errorMessage';
import { QUEUE_FULL_TITLE } from '../../../services/outbox/sendCopy';
import {
  responsiblesSelection,
  type ResponsiblePick,
} from '../../../components/modals/ResponsiblesModal';
import { useField } from '../../../lib/forms/useField';
import { validateRequired } from '../../../lib/validation/validators';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { pickReportDocument } from '../../../lib/media/pickDocument';
import { localFileSize } from '../../../lib/media/localFileSize';
import { attachmentIcon, formatBytes, kindLabel } from '../../../lib/media/attachmentLabels';
import {
  checkReportAttachment,
  reportAttachmentInfo,
  type ReportAttachmentKind,
} from '../../../services/api/uploadMedia';
import { useReports } from '../../../services/reports/ReportsProvider';

// 3 inputs (Título / Resumo / Detalhes multiline) + Atribuir
// responsáveis OutlineButton + Anexos section (4 placeholders +
// ImageUploader) + CTAs Salvar / Cancelar.
// Backend slice: salvar vai pelo provider via useReports().create() (o mock
// persiste in-memory na sessão). Seleção de
// responsáveis volta do modal via singleton `responsiblesSelection`.
//
// Anexo multimídia (Anexo I): além da foto, vídeo pela galeria e áudio ou PDF
// pelo seletor de documento. O quadrado mostra o tipo e o tamanho, e o que o
// servidor recusaria (tipo fora da lista, tamanho acima do teto do tipo) é
// recusado aqui, na escolha, com a mesma frase do painel.

// Um quadrado preenchido. `size` null quando o arquivo não pôde ser lido: a
// fila de envios refaz a checagem com o tamanho real na entrada.
type SlotAttachment = { uri: string; kind: ReportAttachmentKind; size: number | null };

const HELPER_TEXT =
  'Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF. Vídeo até 100 MB, áudio até 25 MB, os demais até 15 MB.';

export default function NewReport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { create } = useReports();
  const [saving, setSaving] = useState(false);
  // Relatório que não entrou na fila de envios: fila cheia, ou anexo recusado
  // na entrada. A tela fica aberta e a pessoa não perde o que escreveu.
  const [notice, setNotice] = useState<{ variant: 'warning' | 'error'; title: string } | null>(
    null,
  );

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
  const [attachments, setAttachments] = useState<(SlotAttachment | undefined)[]>(
    [undefined, undefined, undefined, undefined],
  );
  const setAttachmentAt = (index: number, attachment: SlotAttachment) => {
    setAttachments((prev) => {
      const next = [...prev];
      next[index] = attachment;
      return next;
    });
  };

  // Esvazia o slot NO LUGAR, sem compactar o array: a pessoa está olhando pra
  // grade, e puxar os anexos seguintes uma casa pra cima mexeria na posição do
  // que ela decidiu manter.
  const clearAttachmentAt = (index: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      next[index] = undefined;
      return next;
    });
  };

  // Tipo e tamanho conferidos NA ESCOLHA. Recusa com a frase do servidor e
  // deixa o quadrado como estava; aceito, o quadrado mostra tipo e tamanho.
  const acceptPicked = (uri: string): SlotAttachment | null => {
    const size = localFileSize(uri);
    const refused = checkReportAttachment(uri, size);
    const info = reportAttachmentInfo(uri);
    if (refused || !info) {
      setNotice({ variant: 'error', title: refused ?? 'Tipo de arquivo não aceito.' });
      return null;
    }
    setNotice(null);
    return { uri, kind: info.kind, size };
  };

  // A galeria mostra foto e vídeo; a câmera segue tirando foto.
  const media = useMediaPicker({ mediaTypes: ['images', 'videos'] });
  // `onRemove` só vai quando há o que remover; em slot vazio o menu segue sem
  // essa opção. `onPickDocument` põe "Escolher áudio ou PDF" no menu.
  const showPicker = async (index: number) => {
    const uri = await media.showPicker({
      onPickDocument: pickReportDocument,
      ...(attachments[index] ? { onRemove: () => clearAttachmentAt(index) } : {}),
    });
    if (!uri) return;
    const accepted = acceptPicked(uri);
    if (accepted) setAttachmentAt(index, accepted);
  };

  // "Enviar arquivo" alimenta a GRADE, não a si mesmo. A tela mantinha dois
  // estados separados — os 4 quadrados e uma preview própria do uploader — e a
  // foto escolhida por aqui aparecia dentro do próprio botão, longe dos
  //
  // Mesmo modelo que journey/task/[id] já usa: um lugar só pras fotos.
  const primeiroSlotLivre = attachments.findIndex((a) => !a);
  const pickFileForUploader = async () => {
    // Cheio: nem abre o seletor. Sem isto o 5º toque sobrescreveria o primeiro
    // anexo em silêncio, e a pessoa perderia um anexo já escolhido.
    if (primeiroSlotLivre === -1) return;
    const uri = await media.pickFromGallery();
    if (!uri) return;
    const accepted = acceptPicked(uri);
    if (accepted) setAttachmentAt(primeiroSlotLivre, accepted);
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
    setNotice(null);
    try {
      // O relatório entra na fila de envios e a tela volta para a lista na
      // hora, com sinal ou sem: lá ele aparece como "Aguardando envio" até o
      // servidor confirmar.
      const result = await create({
        title: titulo.value,
        summary: resumo.value,
        details: detalhes.value,
        responsibles: responsibleNames,
        imageUris: attachments.flatMap((a) => (a ? [a.uri] : [])),
      });
      if (result === 'full') {
        setNotice({ variant: 'warning', title: QUEUE_FULL_TITLE });
        return;
      }
      responsiblesSelection.clear();
      router.back();
    } catch (e) {
      setNotice({
        variant: 'error',
        title: errorMessage(e, 'Não foi possível salvar o relatório.'),
      });
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
                const attachment = attachments[i];
                return (
                  <Pressable
                    key={i}
                    onPress={() => showPicker(i)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      attachment
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
                    {attachment?.kind === 'image' ? (
                      <Image
                        source={{ uri: attachment.uri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : attachment ? (
                      // Vídeo, áudio e PDF não têm miniatura: ícone do tipo,
                      // o tipo e o tamanho, para a pessoa conferir antes de enviar.
                      <View style={{ alignItems: 'center', gap: theme.gap.xs }}>
                        <Icon name={attachmentIcon(attachment.kind)} size={32} color={theme.content.dark} />
                        <Text variant="label.m" color={theme.content.dark}>
                          {kindLabel(attachment.kind)}
                        </Text>
                        {attachment.size !== null ? (
                          <Text variant="caption.s" color={theme.content.medium}>
                            {formatBytes(attachment.size)}
                          </Text>
                        ) : null}
                      </View>
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
            só galeria (foto e vídeo). `value` mostra a preview quando user já
            selecionou. */}
        <ImageUploader
          helperText={HELPER_TEXT}
          pickFileLabel="Enviar arquivo"
          showTakePhoto={false}
          accentColor={theme.content.primary}
          // value null de proposito: a preview vive nos 4 quadrados acima.
          value={null}
          onPickFile={pickFileForUploader}
        />

        {notice ? (
          <Toast variant={notice.variant} title={notice.title} onClose={() => setNotice(null)} />
        ) : null}

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
