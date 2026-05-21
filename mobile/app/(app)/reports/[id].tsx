import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AvatarGroup,
  Button,
  Icon,
  Input,
  JourneyTheme,
  ProgressBar,
  ReportCard,
  SearchInput,
  type StatusTagStatus,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 364:20304 — report-details. Voltar + actions row (search +
// Fazer comentário + Revisar) + ReportCard + Detalhes + Imagens
// horizontal scroll + Atividades cards + Add comment input + CTA.
// Demo phase: mock report data keyed by [id]; sem persistência.

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

type ReportData = {
  status: StatusTagStatus;
  statusLabel: string;
  title: string;
  summary: string;
  authorName: string;
};

const REPORTS: Record<string, ReportData> = {
  'inspecao-tecnica': {
    status: 'accept',
    statusLabel: 'Concluído',
    title: 'Inspeção Técnica das Máquinas Pesadas',
    summary: 'Checklist de manutenção preventiva e reparos necessários',
    authorName: 'Alberto Alves Soares',
  },
  'eficiencia-energetica': {
    status: 'accept',
    statusLabel: 'Em Revisão',
    title: 'Relatório de Eficiência Energética da Mina Oeste',
    summary: 'Avaliação dos consumos e propostas de otimização',
    authorName: 'Rafael Gomes Pereira',
  },
};

const FALLBACK = REPORTS['inspecao-tecnica'];

const DETAIL_TEXT = `Este relatório abrange uma análise detalhada da inspeção técnica realizada nas máquinas pesadas da Mina Córrego Seco, com foco especial no equipamento Komatsu 930E. Inclui um checklist abrangente da manutenção preventiva, abordando desde a verificação dos níveis de óleo e filtros até a inspeção de mangueiras e conexões. Além disso, o relatório detalha os reparos necessários identificados durante a inspeção, como a substituição de componentes desgastados, ajustes de sistemas hidráulicos e elétricos, e a correção de soldas defeituosas. O objetivo principal deste relatório é garantir a segurança e a eficiência operacional das máquinas pesadas, minimizando o tempo de inatividade não planejado e prolongando a vida útil dos equipamentos, seguindo as normas de segurança da Vale e as melhores práticas da indústria de mineração.`;

const ACTIVITIES = [
  {
    id: 'oleo-filtros',
    title: 'Verificação de níveis de óleo e filtros',
    sector: 'Setor Noroeste',
    progress: 0.84,
    color: 'primary' as const,
    avatars: [{ uri: avatarUri }, { uri: avatarUri }],
    totalCount: 18,
  },
  {
    id: 'motores',
    title: 'Manutenção de motores',
    sector: 'Setor Noroeste',
    progress: 0.84,
    color: 'warning' as const,
    avatars: [{ uri: avatarUri }, { uri: avatarUri }, { uri: avatarUri }],
    totalCount: 3,
  },
  {
    id: 'eletricos',
    title: 'Ajustes de sistemas elétricos',
    sector: 'Setor Central',
    progress: 0.84,
    color: 'error' as const,
    avatars: [{ uri: avatarUri }, { uri: avatarUri }, { uri: avatarUri }],
    totalCount: 3,
  },
];

export default function ReportDetails() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = (id && REPORTS[id]) || FALLBACK;

  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');

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
        {/* Voltar — ghost button com chevron-left.
            Figma 364:20304 mostra "< Voltar" left-aligned no topo com
            largura natural (não full-width). */}
        <View style={{ alignSelf: 'flex-start' }}>
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
          creationDate="dd/mm/aaaa"
          author={{ name: report.authorName, avatarUri }}
          location="Setor Noroeste"
          responsibles="Ana Clara Mendonça, Antonio Cláudio Silva, Rita Sampaio,"
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
          {DETAIL_TEXT}
        </Text>

        {/* Imagens — horizontal scroll com fotos reais (Figma 364:20304
            mostra imagens de campo / equipamento). Demo phase: 2 imagens
            estáticas; loop pra ocupar a faixa scrollable. */}
        <Title variant="title.xs" color={theme.content.dark}>
          Imagens
        </Title>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.gap.sm }}
        >
          {[
            require('../../../assets/report-image-1.png'),
            require('../../../assets/report-image-2.png'),
            require('../../../assets/report-image-1.png'),
          ].map((src, i) => (
            <RNImage
              key={i}
              source={src}
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

        {/* Atividades */}
        <Title variant="title.xs" color={theme.content.dark}>
          Atividades
        </Title>
        <View style={{ gap: theme.gap.s }}>
          {ACTIVITIES.map((activity) => {
            const barColor =
              activity.color === 'primary'
                ? theme.content.primary
                : activity.color === 'warning'
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
                    {/* DS ProgressBar usa clamp(value, 0, 100); passar
                        percentual (84) e não fração (0.84). */}
                    <ProgressBar value={activity.progress * 100} color={barColor} />
                  </View>
                </View>
                <AvatarGroup
                  avatars={activity.avatars}
                  totalCount={activity.totalCount}
                  maxVisible={3}
                  size="m"
                />
              </View>
            );
          })}
        </View>

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
          label="Fazer comentário"
          elevation="lg"
          accessibilityLabel="Fazer comentário"
          onPress={() => setComment('')}
        />
      </ScrollView>
    </View>
  );
}
