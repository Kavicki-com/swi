import { useCallback, useEffect, useState } from 'react';
import { Alert, Image as RNImage, ScrollView, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useSubmitOnce } from '../../../lib/forms/useSubmitOnce';
import { errorMessage } from '../../../lib/errors/errorMessage';
import type { Report } from '../../../services/reports/types';

// Figma 364:20304 — report-details. Voltar + actions row (search +
// Fazer comentário + Revisar) + ReportCard + Detalhes + Imagens
// horizontal scroll + Atividades cards + Add comment input + CTA.
// Backend slice: report data via useReports().loadOne(id) (Unit A/B); sem
// persistência de comentário (out of scope).

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

  useEffect(() => {
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
    setStatus('loading');
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
  }, [id, loadOne, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Ate 2026-07-27 este botao era `onPress={() => setComment('')}`: limpava o
  // campo e DESCARTAVA o texto. O comentario do worker nunca saia do aparelho,
  // e por isso tambem nunca aparecia no painel — o backend
  // (POST /reports/:id/comments) sempre funcionou, verificado ao vivo.
  //
  // O campo so e limpo APOS o sucesso; em caso de erro o texto permanece, com
  // o motivo do servidor. Limpar antes fazia a pessoa perder o que escreveu.
  const enviarComentario = async () => {
    const texto = comment.trim();
    if (!texto || !id) return;
    try {
      const criado = await addComment(id, texto);
      setReport((prev) => (prev ? { ...prev, comments: [...prev.comments, criado] } : prev));
      setComment('');
    } catch (e) {
      Alert.alert('Erro', errorMessage(e, 'Nao foi possivel enviar o comentario.'));
    }
  };
  // ESTE HOOK FICA ACIMA DO RETURN ANTECIPADO, e nao junto do botao que ele
  // serve (QA Mobile #9). Quando nasceu, em 2026-07-27, foi parar la embaixo:
  // o primeiro render e 'loading' e sai pelo return, o segundo e 'ready' e
  // chega ate aqui, entao a contagem de hooks mudava de um render pro outro e
  // o React lancava "Rendered more hooks than during the previous render". Em
  // build de release ninguem apara esse erro e o app fecha — era o crash ao
  // abrir QUALQUER relatorio.
  const { run: comentar, busy: comentando } = useSubmitOnce(enviarComentario);

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
        bottomOffset={60}
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
                onPress={() => {}}
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
                onPress={() => {}}
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

        {/* Comentarios ja feitos. A tela nao listava NENHUM — nem os que o
            admin escrevia pelo painel. Mesmo shape que o painel exibe
            (ReportDetails.tsx): autor, avatar e data. */}
        {report.comments.length > 0 ? (
          <View style={{ gap: theme.gap.m }}>
            <Title variant="title.xs" color={theme.content.primary}>
              Comentários
            </Title>
            {report.comments.map((c) => (
              <View
                key={c.id}
                style={{ flexDirection: 'row', gap: theme.gap.sm, alignItems: 'flex-start' }}
              >
                <Avatar customSize={40} uri={c.authorAvatarUri} name={c.authorName} />
                <View style={{ flex: 1, gap: theme.gap.xs }}>
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.gap.sm }}
                  >
                    <Text variant="body.s" color={theme.content.light}>
                      {c.authorName}
                    </Text>
                    <Text variant="caption.s" color={theme.content.medium}>
                      {c.createdAt}
                    </Text>
                  </View>
                  <Text variant="body.s" color={theme.content.dark}>
                    {c.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Add comment — multiline input + Fazer comentário CTA.
            Figma 364:20304 mostra textarea ~120h, ~6 linhas de altura. */}
        <Input
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
          label={comentando ? 'Enviando…' : 'Fazer comentário'}
          elevation="lg"
          accessibilityLabel="Fazer comentário"
          disabled={comment.trim().length === 0 || comentando}
          onPress={comentar}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}
