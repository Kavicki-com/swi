import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { ReportDetailState } from '../../../components/reports/ReportsListState';
import { responsiblesSelection } from '../../../components/modals/ResponsiblesModal';
import { ADMINS } from '../../../lib/admins';
import { useField } from '../../../lib/forms/useField';
import { validateRequired } from '../../../lib/validation/validators';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { useReports } from '../../../services/reports/ReportsProvider';

// Figma 372:21297 — new-report form. Voltar + "Novo relatório" title +
// 3 inputs (Título / Resumo / Detalhes multiline) + Atribuir
// responsáveis OutlineButton + Anexos section (grade 2×2 de previews +
// ImageUploader como único entry point) + CTAs Salvar / Cancelar.
// Backend slice: salvar vai pelo provider via useReports().create() (mock
// persiste in-memory na sessão; amplify é deploy-gated). Seleção de
// responsáveis volta do modal via singleton `responsiblesSelection`.
//
// Modo EDIÇÃO (?edit=<id>) — o "Revisar relatório" do report-details abre
// este mesmo form pré-preenchido (não há tela de edição própria no Figma).
// Título vira "Revisar relatório", salvar vai por update() (PATCH parcial).
// Imagens são exibidas na grade mas NÃO são editáveis (uploader oculto):
// as existentes chegam como URLs presigned sem key recuperável — ver nota
// no ReportUpdateInput.

export default function NewReport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { create, update, loadOne } = useReports();
  const [saving, setSaving] = useState(false);

  // Modo edição: param `edit` carrega o relatório e pré-preenche o form.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEdit = !!edit;
  const [editStatus, setEditStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>(
    isEdit ? 'loading' : 'idle',
  );
  const [editReloadKey, setEditReloadKey] = useState(0);

  const titulo = useField({ validator: (v) => validateRequired(v, 'Título') });
  const resumo = useField({ validator: (v) => validateRequired(v, 'Resumo') });
  const detalhes = useField({ validator: (v) => validateRequired(v, 'Detalhes') });
  const [responsibleIds, setResponsibleIds] = useState<string[]>(() =>
    responsiblesSelection.get(),
  );

  // Anexos — 4 slots de preview preenchidos NA ORDEM pelos uploads feitos
  // via "Enviar arquivo" (ImageUploader abaixo). Os quadrados são exibição
  // apenas; o botão é o único ponto de entrada de foto, e a barra do
  // uploader sobe 25% por foto (cheia com 4).
  // Demo phase: useState efêmero, sem persistência.
  const [attachments, setAttachments] = useState<(string | undefined)[]>(
    [undefined, undefined, undefined, undefined],
  );
  const attachmentCount = attachments.filter(Boolean).length;
  const attachmentsFull = attachmentCount >= attachments.length;

  const media = useMediaPicker();
  const pickFileForUploader = async () => {
    if (attachmentsFull) return; // 4/4 — sem slot livre, upload vira no-op
    const uri = await media.pickFromGallery();
    if (!uri) return;
    setAttachments((prev) => {
      const slot = prev.findIndex((u) => !u);
      if (slot < 0) return prev;
      const next = [...prev];
      next[slot] = uri;
      return next;
    });
  };

  // Rehidrata seleção ao reentrar (modal de responsáveis fecha via router.back).
  useFocusEffect(
    useCallback(() => {
      setResponsibleIds(responsiblesSelection.get());
    }, []),
  );

  // Prefill do modo edição. Deps SÓ [edit, loadOne, editReloadKey]: os fields
  // (titulo/resumo/detalhes) trocam de identidade a cada render — incluí-los
  // re-rodaria o effect a cada tecla e sobrescreveria a digitação do usuário
  // com os valores do servidor.
  useEffect(() => {
    if (!edit) return;
    let active = true;
    setEditStatus('loading');
    loadOne(edit)
      .then((r) => {
        if (!active) return;
        if (!r) {
          setEditStatus('empty');
          return;
        }
        titulo.setValue(r.title);
        resumo.setValue(r.summary);
        detalhes.setValue(r.details);
        // Report guarda NOMES; o form/modal trabalham com ids de ADMINS.
        // Nomes fora da lista (ex.: seeds antigos) caem fora do prefill —
        // o PATCH só altera responsibles se o usuário re-selecionar.
        const ids = r.responsibles
          .map((name) => ADMINS.find((a) => a.name === name)?.id)
          .filter(Boolean) as string[];
        responsiblesSelection.set(ids);
        setResponsibleIds(ids);
        // Grade de anexos mostra as imagens existentes (exibição apenas).
        const imgs = r.images.slice(0, 4);
        setAttachments([imgs[0], imgs[1], imgs[2], imgs[3]]);
        setEditStatus('idle');
      })
      .catch(() => {
        if (active) setEditStatus('error');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, loadOne, editReloadKey]);

  const responsiblesLabel =
    responsibleIds.length === 0
      ? 'Atribuir responsáveis'
      : responsibleIds.length === 1
        ? `1 responsável atribuído`
        : `${responsibleIds.length} responsáveis atribuídos`;

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
    // O singleton guarda ids; o card precisa exibir os NOMES reais. ADMINS
    // (lib/admins.ts) é a mesma fonte que o ResponsiblesModal renderiza, então
    // o id→nome resolve por aí. Ids desconhecidos caem fora (Boolean filter).
    const responsibles = responsibleIds
      .map((id) => ADMINS.find((a) => a.id === id)?.name)
      .filter(Boolean) as string[];
    setSaving(true);
    try {
      if (isEdit) {
        // PATCH parcial — imagens ficam fora (ver header). O [id] refaz o
        // fetch no focus ao voltar, então a tela de detalhes reflete a edição.
        await update(edit!, {
          title: titulo.value,
          summary: resumo.value,
          details: detalhes.value,
          responsibles,
        });
      } else {
        await create({
          title: titulo.value,
          summary: resumo.value,
          details: detalhes.value,
          responsibles,
          imageUris: attachments.filter(Boolean) as string[],
        });
      }
      responsiblesSelection.clear();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  // Gate do modo edição: enquanto o relatório carrega (ou se falhou), mostra
  // o mesmo state visual do report-details. 'idle' = form pronto (create ou
  // edição carregada).
  if (isEdit && editStatus !== 'idle') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <JourneyTheme
          gradient={require('../../../assets/login-bg.png')}
          pattern={require('../../../assets/smartband-bg-pattern.png')}
        />
        <ReportDetailState
          kind={editStatus}
          onRetry={editStatus === 'error' ? () => setEditReloadKey((k) => k + 1) : undefined}
        />
      </View>
    );
  }

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
        extraScrollHeight={60}
        enableOnAndroid
      >
        {/* Voltar — left-aligned, largura natural (match /reports/[id] e
            Figma 372:21297). marginLeft:-18 compensa: (a) padding-left do
            ghost Button (theme.padding.sm = 12pt) + (b) inset visual do
            glyph keyboard_arrow_left dentro do bounding box 24x24 do Icon
            (~6pt) = total 18pt. Alinha a ponta do "<" com o edge do
            content area (settings TopBar precisa só de -6 porque seu BackSlot
            tem padding-left:0). */}
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
          {isEdit ? 'Revisar relatório' : 'Novo relatório'}
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
        {/* Detalhes textarea — Figma 372:21297 mostra textarea alta
            (~250-300h) ocupando espaço significativo do form. */}
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

        {/* 4 quadrados de preview em 2×2 grid. Figma 372:21297 mostra cards
            quadrados ocupando full-width do content area (com gap entre eles).
            Exibição apenas — preenchidos na ordem pelos uploads do "Enviar
            arquivo" abaixo; não são botões (o upload por toque no quadrado
            saía do fluxo das telas).
            Row-grouping com flex:1 + aspectRatio:1 garante 2 colunas, cada
            uma metade da largura, quadradas. */}
        <View style={{ gap: theme.gap.sm }}>
          {[[0, 1], [2, 3]].map((row, rowIdx) => (
            <View
              key={rowIdx}
              style={{ flexDirection: 'row', gap: theme.gap.sm }}
            >
              {row.map((i) => {
                const uri = attachments[i];
                return (
                  <View
                    key={i}
                    accessibilityLabel={
                      uri ? `Anexo ${i + 1}` : `Espaço de anexo ${i + 1} vazio`
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
                        accessibilityRole="image"
                      />
                    ) : (
                      <Icon name="add_a_photo" size={32} color={theme.content.medium} />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* ImageUploader (Enviar arquivo) — wired ao expo-image-picker
            (galeria; showTakePhoto=false na spec original). Único ponto de
            entrada dos anexos: cada foto vai pro primeiro quadrado livre da
            grade acima, e a barra interna do DS (renderizada quando não há
            `value`) sobe proporcionalmente via `progress` — 25% por foto,
            cheia com 4. Sem `value`/`onRemove`: o preview é a própria grade.
            Com 4/4 o handler vira no-op em vez de `disabled` — o disabled do
            DS acinzentaria a barra cheia (fill content.medium + opacity),
            escondendo o estado "completo".
            Oculto no modo edição: imagens não são editáveis (a grade acima
            mostra as existentes; ver nota no header). */}
        {!isEdit && (
          <ImageUploader
            helperText="Selecione arquivos do tipo: JPG ou PNG"
            pickFileLabel="Enviar arquivo"
            showTakePhoto={false}
            accentColor={theme.content.primary}
            progress={(attachmentCount / attachments.length) * 100}
            onPickFile={pickFileForUploader}
          />
        )}

        {/* CTAs */}
        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Salvar relatório"
          elevation="lg"
          accessibilityLabel="Salvar relatório"
          disabled={!canSubmit || saving}
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
