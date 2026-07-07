import { useCallback, useRef, useState } from 'react';
import { Image as RNImage, ScrollView, View, type TextInput as RNTextInput } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  AvatarGroup,
  Button,
  Icon,
  Input,
  JourneyTheme,
  ProgressBar,
  ReportCard,
  SearchInput,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { ReportDetailState } from '../../../components/reports/ReportsListState';
import { useReports } from '../../../services/reports/ReportsProvider';
import type { Report } from '../../../services/reports/types';

// Figma 364:20304 — report-details. Voltar + actions row (search +
// Fazer comentário + Revisar) + ReportCard + Detalhes + Imagens
// horizontal scroll + Atividades cards + Add comment input + CTA.
// Backend slice: report data via useReports().loadOne(id).
// Ações (2026-07-07): "Revisar relatório" abre o form new.tsx em modo
// edição (?edit=<id>); "Fazer comentário" (topo) foca o input de baixo;
// o CTA de baixo persiste via useReports().addComment() e o comentário
// aparece na seção "Comentários" (composição DS — o Figma não desenha a
// lista; decisão de design com o usuário).

type DetailStatus = 'loading' | 'ready' | 'empty' | 'error';

export default function ReportDetails() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loadOne, addComment } = useReports();

  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<DetailStatus>('loading');
  // Bump pra re-disparar o load no retry (o effect só depende de id/loadOne).
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  // Ref do input de baixo — o botão "Fazer comentário" do topo foca aqui
  // (DS Input encaminha o ref pro TextInput interno; o KASV auto-rola até
  // o input focado).
  const commentInputRef = useRef<RNTextInput>(null);

  // useFocusEffect (não useEffect): voltar da edição (new?edit=<id>) refaz o
  // fetch e a tela reflete o PATCH. Refetch com dados já na tela é SILENCIOSO
  // (mantém 'ready' — sem flash de loading); o full loading só no 1º load.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      // useLocalSearchParams pode devolver id undefined em runtime (rota sem
      // param). Sem id não há o que buscar — marca 'empty' direto ("Relatório
      // não encontrado") em vez de chamar loadOne(undefined) no backend.
      if (!id) {
        setStatus('empty');
        return () => {
          active = false;
        };
      }
      setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
      loadOne(id)
        .then((r) => {
          if (!active) return;
          setReport(r);
          setStatus(r ? 'ready' : 'empty');
        })
        .catch(() => {
          if (active) setStatus('error');
        });
      return () => {
        active = false;
      };
    }, [id, loadOne, reloadKey]),
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Persiste e anexa localmente (o get do focus seguinte traz do server).
  // addComment → null = relatório sumiu no server; o próximo focus resolve
  // pro estado 'empty', então só ignora aqui.
  const submitComment = useCallback(async () => {
    const text = comment.trim();
    if (!text || sendingComment || !report) return;
    setSendingComment(true);
    try {
      const created = await addComment(report.id, text);
      if (created) {
        setReport((prev) =>
          prev ? { ...prev, comments: [...prev.comments, created] } : prev,
        );
        setComment('');
      }
    } finally {
      setSendingComment(false);
    }
  }, [comment, sendingComment, report, addComment]);

  if (status !== 'ready' || !report) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <JourneyTheme
          gradient={require('../../../assets/login-bg.png')}
          pattern={require('../../../assets/smartband-bg-pattern.png')}
        />
        <ReportDetailState
          kind={status === 'ready' ? 'empty' : status}
          onRetry={status === 'error' ? retry : undefined}
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

      {/* KeyboardAwareScrollView gerencia keyboard avoidance + auto-scroll
          até o input focado, e diferente do ScrollView nativo com
          automaticallyAdjustKeyboardInsets, respeita o `extraScrollHeight`
          como gap explícito entre o input e o topo do teclado (KAV+
          contentInset eram sobrescritos pelo iOS quando o teclado abria).
          Substitui a combinação anterior de KeyboardAvoidingView +
          ScrollView + automaticallyAdjustKeyboardInsets + contentInset. */}
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
        // Gap entre input focado e topo do teclado (incluindo QuickType bar).
        extraScrollHeight={60}
        enableOnAndroid
      >
        {/* Voltar — ghost button com chevron-left.
            Figma 364:20304 mostra "< Voltar" left-aligned no topo com
            largura natural (não full-width). marginLeft:-18 compensa:
            (a) padding-left do ghost Button (theme.padding.sm = 12pt) +
            (b) inset visual do glyph keyboard_arrow_left dentro do bounding
            box 24x24 (~6pt). Settings TopBar precisa só -6 porque seu
            BackSlot tem padding-left:0. */}
        <View style={{ alignSelf: 'flex-start', marginLeft: -18 }}>
          <Button
            variant="ghost"
            label="Voltar"
            labelColor={theme.content.primaryLight}
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
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

        {/* Actions row: SearchInput + Fazer comentário + Revisar */}
        <View style={{ gap: theme.gap.m }}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar no relatório"
          />
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ flex: 1 }}>
              <Button
                variant="outline"
                size="small"
                borderColor={theme.content.primary}
                labelColor={theme.content.primary}
                label="Fazer comentário"
                accessibilityLabel="Fazer comentário"
                // Mesma ação do fluxo de baixo: foca o input "Adicionar
                // comentário" (KASV rola até ele com o teclado aberto).
                onPress={() => commentInputRef.current?.focus()}
                iconLeft={
                  <Icon name="chat_bubble_outline" size={18} color={theme.content.primary} />
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="outline"
                size="small"
                borderColor={theme.content.primary}
                labelColor={theme.content.primary}
                label="Revisar relatório"
                accessibilityLabel="Revisar relatório"
                // Abre o form de relatório em modo edição, pré-preenchido.
                // Ao voltar, o useFocusEffect acima refaz o fetch.
                onPress={() =>
                  router.push({
                    pathname: '/(app)/reports/new',
                    params: { edit: report.id },
                  })
                }
                iconLeft={
                  <Icon name="border_color" size={18} color={theme.content.primary} />
                }
              />
            </View>
          </View>
        </View>

        {/* Report summary card */}
        <ReportCard
          status={report.status}
          statusLabel={report.statusLabel}
          title={report.title}
          summary={report.summary}
          creationDate={report.creationDate}
          author={{ name: report.authorName, avatarUri: report.authorAvatarUri }}
          location={report.sector}
          responsibles={report.responsibles.join(', ')}
          fullWidth
        />

        {/* Detalhes do relatório */}
        <Title variant="title.xs" color={theme.content.dark}>
          Detalhes do relatório:
        </Title>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ lineHeight: theme.fontSize.m * 1.4 }}
        >
          {report.details}
        </Text>

        {/* Imagens — horizontal scroll com fotos reais (Figma 364:20304
            mostra imagens de campo / equipamento). Backend slice: URIs vêm
            de report.images (seed espelha as 2 imagens estáticas). Relatório
            recém-criado pode vir sem imagens — esconde a seção inteira pra não
            renderizar um título solto sem conteúdo. */}
        {report.images.length > 0 && (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Imagens
            </Title>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: theme.gap.sm }}
            >
              {report.images.map((uri, i) => (
                <RNImage
                  key={i}
                  source={{ uri }}
                  resizeMode="cover"
                  accessible={false}
                  style={{
                    width: 196,
                    height: 196,
                    borderRadius: theme.border.radius.m,
                  }}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* Atividades — relatório recém-criado tem activities:[]; esconde a
            seção inteira nesse caso (mesmo motivo das Imagens). */}
        {report.activities.length > 0 && (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Atividades
            </Title>
            <View style={{ gap: theme.gap.s }}>
              {report.activities.map((activity) => {
                const barColor =
                  activity.tone === 'success'
                    ? theme.content.primary
                    : activity.tone === 'warning'
                    ? theme.surface.warning
                    : theme.surface.error;
                return (
                  <View
                    key={activity.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: theme.surface.standard,
                      borderRadius: theme.border.radius.m,
                      paddingHorizontal: theme.padding.m,
                      paddingVertical: theme.padding.s,
                      gap: theme.gap.l,
                    }}
                  >
                    {/* Coluna esquerda — width capada pra forçar wrap nos
                        títulos como Figma (cada palavra grande em sua linha). */}
                    <View style={{ gap: theme.gap.xs, width: 140 }}>
                      <Text variant="label.m" color={theme.content.dark}>
                        {activity.title}
                      </Text>
                      <Text variant="body.m" color={theme.content.dark}>
                        {activity.sector}
                      </Text>
                      <View style={{ width: 119 }}>
                        {/* DS ProgressBar usa clamp(value, 0, 100); progress já é
                            percentual (0-100) no Report model — não multiplicar. */}
                        <ProgressBar value={activity.progress} color={barColor} />
                      </View>
                    </View>
                    <AvatarGroup
                      avatars={activity.avatars.map((uri) => ({ uri }))}
                      totalCount={activity.overflowCount}
                      maxVisible={3}
                      size="m"
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Comentários — o Figma 364:20304 não desenha a lista (só o input);
            seção composta com DS primitives (Title/Avatar/Text), seguindo o
            idioma dos cards de Atividades (surface.standard + radius.m).
            Oculta quando vazia (mesmo padrão de Imagens/Atividades). */}
        {report.comments.length > 0 && (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Comentários
            </Title>
            <View style={{ gap: theme.gap.s }}>
              {report.comments.map((c) => (
                <View
                  key={c.id}
                  style={{
                    backgroundColor: theme.surface.standard,
                    borderRadius: theme.border.radius.m,
                    paddingHorizontal: theme.padding.m,
                    paddingVertical: theme.padding.s,
                    gap: theme.gap.s,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.gap.s,
                    }}
                  >
                    <Avatar uri={c.authorAvatarUri || undefined} size="s" />
                    <View style={{ flex: 1 }}>
                      <Text variant="label.m" color={theme.content.dark}>
                        {c.authorName}
                      </Text>
                    </View>
                    <Text variant="body.s" color={theme.content.dark}>
                      {c.date}
                    </Text>
                  </View>
                  <Text
                    variant="body.m"
                    color={theme.content.dark}
                    style={{ lineHeight: theme.fontSize.m * 1.4 }}
                  >
                    {c.text}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Add comment — multiline input + Fazer comentário CTA.
            Figma 364:20304 mostra textarea ~120h, ~6 linhas de altura. */}
        <Input
          ref={commentInputRef}
          label="Adicionar comentário"
          placeholder="Digite aqui o seu comentário"
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={6}
        />

        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Fazer comentário"
          elevation="lg"
          accessibilityLabel="Fazer comentário"
          disabled={!comment.trim() || sendingComment}
          onPress={submitComment}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}
